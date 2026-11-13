import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeProjects, normalizeQuotes, normalizeTickets, serializeProjectRecord } from '../src/lib/cloud-records.js';
import { isOneOf, safeJsonParse } from '../src/security/sanitize.js';

export const STORE_FORMAT = 'lumen.cloud';
export const STORE_VERSION = 1;
export const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const QUOTE_ORIGINS = Object.freeze(['api', 'device']);
// Account libraries live under this prefix and are reachable only through a verified session.
export const ACCOUNT_PREFIX = 'acct-';

const MAX_NAMESPACES = 512;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const RENAME_RETRIES = 8;
const RETRYABLE_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
/**
 * Writes waiting for the store lock before new ones are refused with
 * LUMEN_BUSY (the API answers 503 busy with Retry-After). Each waiting write
 * holds its request open, so the queue must not grow without bound.
 */
export const MAX_PENDING_WRITES = 256;

/**
 * FIFO async mutex. `run(task)` starts `task` only after every task queued
 * before it has settled, so critical sections never interleave across an
 * `await`, and resolves or rejects with the task's own outcome. A rejected
 * task never blocks the queue. Past `maxPending` queued or running tasks, new
 * ones are refused at once with an error coded LUMEN_BUSY.
 */
export function createMutex({ maxPending = Infinity } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    get pending() {
      return pending;
    },

    run(task) {
      if (pending >= maxPending) {
        return Promise.reject(Object.assign(new Error('Lumen Cloud store queue is full.'), { code: 'LUMEN_BUSY' }));
      }
      pending += 1;
      const result = tail.then(() => task()).finally(() => {
        pending -= 1;
      });
      tail = result.catch(() => {});
      return result;
    },

    /** Resolves once the queue is empty, including tasks queued while it waits. */
    async idle() {
      while (pending > 0) await tail;
    },
  };
}

function isThenable(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNamespace(value) {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

/** A browser-profile namespace a client may name in X-Lumen-Client. The account prefix is reserved. */
export function isClientNamespace(value) {
  return isNamespace(value) && !value.startsWith(ACCOUNT_PREFIX);
}

/**
 * Deterministic library namespace for a signed-in address: 160 bits of a
 * domain-separated SHA-256, stable across processes and session keys.
 */
export function accountNamespace(email) {
  const digest = createHash('sha256').update(`lumen.account.v1:${email}`).digest('hex');
  return `${ACCOUNT_PREFIX}${digest.slice(0, 40)}`;
}

function emptyNamespace() {
  return { touchedAt: 0, projects: [], quotes: [], tickets: [] };
}

/** Mutable copy of a namespace's collections, stamped with the time of the change. */
function draftOf(entry, touchedAt) {
  return { touchedAt, projects: [...entry.projects], quotes: [...entry.quotes], tickets: [...entry.tickets] };
}

function isEmpty(entry) {
  return entry.projects.length === 0 && entry.quotes.length === 0 && entry.tickets.length === 0;
}

/** Every record read from disk passes the same validators as a request body. */
function reviveNamespace(entry) {
  if (!isRecord(entry)) return null;
  const projects = normalizeProjects(entry.projects).map(serializeProjectRecord);
  const origins = new Map(
    (Array.isArray(entry.quotes) ? entry.quotes : [])
      .filter((quote) => isRecord(quote) && typeof quote.ref === 'string')
      .map((quote) => [quote.ref, isOneOf(quote.origin, QUOTE_ORIGINS) ? quote.origin : 'device']),
  );
  const quotes = normalizeQuotes(entry.quotes).map((quote) => ({ ...quote, origin: origins.get(quote.ref) }));
  // Stores written before v6 carry no tickets array; it reads as empty.
  const tickets = normalizeTickets(entry.tickets);
  const touchedAt = Number.isSafeInteger(entry.touchedAt) && entry.touchedAt > 0 ? entry.touchedAt : 0;
  return { touchedAt, projects, quotes, tickets };
}

/**
 * Keeps at most MAX_NAMESPACES. Browser-profile namespaces go before signed-in
 * account libraries, least recently written first, so a flood of throwaway
 * X-Lumen-Client ids can only push out other guest libraries.
 */
function evictOldest(namespaces, keep) {
  if (namespaces.size <= MAX_NAMESPACES) return;
  const ordered = [...namespaces.entries()]
    .filter(([id]) => id !== keep)
    .sort((a, b) => {
      const accountA = a[0].startsWith(ACCOUNT_PREFIX);
      const accountB = b[0].startsWith(ACCOUNT_PREFIX);
      if (accountA !== accountB) return accountA ? 1 : -1;
      return a[1].touchedAt - b[1].touchedAt;
    });
  for (const [id] of ordered.slice(0, namespaces.size - MAX_NAMESPACES)) namespaces.delete(id);
}

function loadSnapshot(file) {
  const namespaces = new Map();
  if (!file || !existsSync(file)) return namespaces;

  const parsed =
    statSync(file).size <= MAX_FILE_BYTES
      ? safeJsonParse(readFileSync(file, 'utf8'), { fallback: null, maxLength: MAX_FILE_BYTES })
      : null;
  if (!isRecord(parsed) || parsed.format !== STORE_FORMAT || parsed.version !== STORE_VERSION || !isRecord(parsed.namespaces)) {
    // Never overwrite an unreadable store in place: park it beside the live file.
    const parked = `${file}.corrupt-${Date.now()}`;
    renameSync(file, parked);
    console.warn(`[lumen-cloud] unreadable store moved to ${parked}`);
    return namespaces;
  }

  for (const [id, entry] of Object.entries(parsed.namespaces)) {
    if (!isNamespace(id)) continue;
    const revived = reviveNamespace(entry);
    if (revived) namespaces.set(id, revived);
  }
  evictOldest(namespaces, null);
  return namespaces;
}

function serializeSnapshot(namespaces) {
  return JSON.stringify({
    format: STORE_FORMAT,
    version: STORE_VERSION,
    namespaces: Object.fromEntries(namespaces),
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Windows (and OneDrive or antivirus scanners on it) can briefly hold the
// target open; the rename succeeds once the handle is released.
async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (attempt >= RENAME_RETRIES || !RETRYABLE_FS_CODES.has(error.code)) throw error;
      await wait(attempt * 15);
    }
  }
}

/** Write to a sibling temp file, flush it, then rename over the live file. Readers never see a partial store. */
async function writeAtomic(file, text) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(temp, 'w', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Lumen Cloud state, isolated per client namespace. `file: null` keeps the
 * store in memory only.
 *
 * Every mutation (transact, claim, remove) runs inside one FIFO mutex, so each
 * one reads the snapshot its predecessor committed: no lost update, no quota
 * checked against a stale count, however many requests arrive at once. A
 * mutation works on a draft and is committed to memory only after the
 * snapshot containing it is on disk, so a failed write leaves both the file
 * and the served state untouched. Reads take no lock: they see the last
 * committed snapshot, which is replaced whole, never mutated in place.
 */
export function createStore({ file = null, maxPendingWrites = MAX_PENDING_WRITES } = {}) {
  let namespaces = loadSnapshot(file);
  const lock = createMutex({ maxPending: maxPendingWrites });

  function serialized(task) {
    return lock.run(task);
  }

  /** A mutator must finish inside the lock; one that returns a promise would commit a half-built draft. */
  function runMutator(mutate, ...drafts) {
    const result = mutate(...drafts);
    if (isThenable(result)) {
      result.then(undefined, () => {});
      throw new TypeError('Store mutators must be synchronous: make every change to the draft before returning.');
    }
    return result;
  }

  async function commit(next) {
    if (file) {
      try {
        await writeAtomic(file, serializeSnapshot(next));
      } catch (cause) {
        console.error('[lumen-cloud] store write failed', cause);
        throw Object.assign(new Error('Lumen Cloud store write failed.', { cause }), { code: 'LUMEN_STORAGE' });
      }
    }
    namespaces = next;
  }

  return {
    file,

    read(id) {
      const entry = namespaces.get(id) ?? emptyNamespace();
      return { projects: entry.projects, quotes: entry.quotes, tickets: entry.tickets };
    },

    /** Runs `mutate(draft)` and persists the result. A throw inside `mutate` discards the draft. */
    transact(id, mutate) {
      return serialized(async () => {
        const draft = draftOf(namespaces.get(id) ?? emptyNamespace(), Date.now());
        const result = runMutator(mutate, draft);
        const next = new Map(namespaces);
        next.set(id, draft);
        evictOldest(next, id);
        await commit(next);
        return result;
      });
    },

    /**
     * Moves records from one namespace into another in a single atomic write.
     * `merge(target, source)` mutates both drafts and returns a result; nothing
     * is written unless it reports `changed`. An emptied source is deleted.
     */
    claim(fromId, toId, merge) {
      return serialized(async () => {
        const source = namespaces.get(fromId);
        if (!source || fromId === toId) return null;
        const now = Date.now();
        const into = draftOf(namespaces.get(toId) ?? emptyNamespace(), now);
        const from = draftOf(source, now);
        const result = runMutator(merge, into, from);
        if (!result?.changed) return result ?? null;
        const next = new Map(namespaces);
        next.set(toId, into);
        if (isEmpty(from)) next.delete(fromId);
        else next.set(fromId, from);
        evictOldest(next, toId);
        await commit(next);
        return result;
      });
    },

    remove(id) {
      return serialized(async () => {
        if (!namespaces.has(id)) return false;
        const next = new Map(namespaces);
        next.delete(id);
        await commit(next);
        return true;
      });
    },

    /** Writes queued or running right now; never above `maxPendingWrites`. */
    get pendingWrites() {
      return lock.pending;
    },

    /**
     * Resolves once every queued mutation has settled, including any queued
     * while it waits. Never refused for a full queue, so a graceful shutdown
     * can always drain.
     */
    flush() {
      return lock.idle();
    },
  };
}
