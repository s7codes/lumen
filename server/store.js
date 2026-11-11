import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { normalizeProjects, normalizeQuotes, serializeProjectRecord } from '../src/lib/cloud-records.js';
import { isOneOf, safeJsonParse } from '../src/security/sanitize.js';

export const STORE_FORMAT = 'lumen.cloud';
export const STORE_VERSION = 1;
export const NAMESPACE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const QUOTE_ORIGINS = Object.freeze(['api', 'device']);

const MAX_NAMESPACES = 512;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const RENAME_RETRIES = 8;
const RETRYABLE_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNamespace(value) {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

function emptyNamespace() {
  return { touchedAt: 0, projects: [], quotes: [] };
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
  const touchedAt = Number.isSafeInteger(entry.touchedAt) && entry.touchedAt > 0 ? entry.touchedAt : 0;
  return { touchedAt, projects, quotes };
}

function evictOldest(namespaces, keep) {
  if (namespaces.size <= MAX_NAMESPACES) return;
  const ordered = [...namespaces.entries()]
    .filter(([id]) => id !== keep)
    .sort((a, b) => a[1].touchedAt - b[1].touchedAt);
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
 * store in memory only. Mutations run one at a time against a draft and are
 * committed to memory only after the snapshot containing them is on disk, so
 * a failed write leaves both the file and the served state untouched.
 */
export function createStore({ file = null } = {}) {
  let namespaces = loadSnapshot(file);
  let queue = Promise.resolve();

  function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
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
      return { projects: entry.projects, quotes: entry.quotes };
    },

    /** Runs `mutate(draft)` and persists the result. A throw inside `mutate` discards the draft. */
    transact(id, mutate) {
      return serialized(async () => {
        const current = namespaces.get(id) ?? emptyNamespace();
        const draft = { touchedAt: Date.now(), projects: [...current.projects], quotes: [...current.quotes] };
        const result = mutate(draft);
        const next = new Map(namespaces);
        next.set(id, draft);
        evictOldest(next, id);
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

    /** Resolves once every queued mutation has settled. */
    flush() {
      return serialized(() => undefined);
    },
  };
}
