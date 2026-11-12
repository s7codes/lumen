import { loadSession, loadSessionToken, persistSessionToken, sanitizeSessionToken, sanitizeUser } from '../lib/auth.js';
import {
  MAX_REVISION,
  MAX_STORED_PROJECTS,
  MAX_STORED_QUOTES,
  MAX_STORED_TICKETS,
  normalizeProjects,
  normalizeQuotes,
  normalizeTickets,
  PROJECT_CODECS,
  QUOTE_STATUSES,
  sanitizeProjectRecord,
  sanitizeQuoteRecord,
  sanitizeTicketRecord,
  serializeProjectRecord,
  TICKET_QUEUED,
  TICKET_REF_PATTERN,
} from '../lib/cloud-records.js';
import {
  isProjectId,
  PROJECT_KINDS,
  PROJECT_NAME_MAX,
  PROJECT_NAMES,
  projectIdFor,
  sanitizeProjectName,
} from '../lib/project-library.js';
import { sanitizeProject, validateProject } from '../lib/quote.js';
import { isOneOf, safeJsonParse, safeStorage, sanitizeText } from '../security/sanitize.js';

/**
 * Lumen Cloud client. Calls go over HTTP to the same-origin /api/* server.
 * Signed out, they are scoped to this browser profile by the X-Lumen-Client
 * namespace; with a server session they also carry the Bearer token and the
 * server resolves the account library, so a project saved in one browser
 * opens in any other signed in with the same address.
 *
 * The localStorage mirror stays the offline copy: after every server response
 * it is reconciled to the server list, and a marker records the fingerprint
 * that matched and which library it belongs to. A mirror that no longer
 * matches its marker was changed on this device (offline saves, a v1 library)
 * and is pushed to /api/sync before the next call. A browser-profile mirror
 * replaces its namespace; an account library is shared between devices, so a
 * device only ever merges into it, and a mirror left by another account is
 * never pushed at all. When the API is unreachable, projects fall back to the
 * mirror; requisitions are refused rather than issued offline.
 */

export const PROJECTS_STORAGE_KEY = 'lumen_cloud_projects_v1';
export const QUOTES_STORAGE_KEY = 'lumen_cloud_quotes_v1';
export const CLIENT_STORAGE_KEY = 'lumen_cloud_client_v1';
export const SYNC_STORAGE_KEY = 'lumen_cloud_sync_v1';
export const TICKETS_STORAGE_KEY = 'lumen_cloud_tickets_v1';
export const TICKET_OUTBOX_STORAGE_KEY = 'lumen_cloud_ticket_outbox_v1';
export const CLIENT_HEADER = 'X-Lumen-Client';
export const API_BASE = '/api';
// A floor, not a simulation: saving and syncing states never flash on a fast link.
export const LATENCY_MS = Object.freeze({ min: 500 });
export const REQUEST_TIMEOUT_MS = 8000;
export const TRANSPORT_LABELS = Object.freeze({
  idle: 'Connecting',
  http: 'Lumen Cloud API (HTTP)',
  local: 'Device storage (offline)',
});
export const LIBRARY_LABELS = Object.freeze({
  account: 'Account (session-bound)',
  device: 'This browser profile',
});
export { MAX_STORED_PROJECTS, MAX_STORED_QUOTES, MAX_STORED_TICKETS, PROJECT_KINDS, PROJECT_NAME_MAX, PROJECT_NAMES, QUOTE_STATUSES };

const SYNC_BATCH_CHARS = 48 * 1024;
const MAX_RESPONSE_CHARS = 2_000_000;
const CLIENT_ID_PATTERN = /^[a-f0-9]{32}$/;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

class OfflineError extends Error {}

// The server refused the stored session (expired, revoked, or a rotated key).
class SessionLostError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unreachable() {
  return new ApiError('storage', 'Lumen Cloud is unreachable from this device. Nothing was saved.');
}

/* Transport telemetry */

let transport = Object.freeze({ mode: 'idle', label: TRANSPORT_LABELS.idle, roundTripMs: null });
const transportListeners = new Set();

function setTransport(mode, roundTripMs) {
  if (transport.mode === mode && transport.roundTripMs === roundTripMs) return;
  transport = Object.freeze({ mode, label: TRANSPORT_LABELS[mode], roundTripMs });
  transportListeners.forEach((listener) => listener());
}

/** Last settled transport: `idle` before any call, `http` when the API answered, `local` on fallback. */
export function getCloudTransport() {
  return transport;
}

export function subscribeCloudTransport(listener) {
  transportListeners.add(listener);
  return () => transportListeners.delete(listener);
}

/* Client namespace */

let memoryClientId = null;

function randomHex(bytes) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 128-bit id per browser profile. Without storage it lives for the page only. */
function clientId() {
  const stored = safeStorage.read(CLIENT_STORAGE_KEY, {
    fallback: null,
    validate: (value) => typeof value === 'string' && CLIENT_ID_PATTERN.test(value),
  });
  if (stored) return stored;
  const id = memoryClientId ?? randomHex(16);
  memoryClientId = safeStorage.write(CLIENT_STORAGE_KEY, id) ? null : id;
  return id;
}

/* Library scope */

/** `account` while a server session token is held, otherwise `device` (this browser profile). */
export function getLibraryScope() {
  return loadSessionToken() && loadSession() ? 'account' : 'device';
}

// Which library a mirror marker was reconciled against. Account owners are a
// fingerprint of the address, so markers never store it a second time.
function libraryOwner() {
  const user = loadSessionToken() ? loadSession() : null;
  return user ? `acct.${fingerprint(user.email)}` : 'device';
}

/* HTTP */

// Server fault codes the UI tells apart; every other refusal reads as `invalid`.
const PASSED_FAULTS = new Set(['quota', 'gatekeeper_locked']);

/**
 * One JSON call. With `session` (the default) a stored server session rides
 * along as a Bearer token; a 401 for it drops the token and throws
 * SessionLostError so the round trip reruns on the browser-profile library.
 */
async function request(trip, method, path, body, { headers = {}, session = true } = {}) {
  if (typeof fetch !== 'function') throw new OfflineError();
  const bearer = session ? sanitizeSessionToken(loadSessionToken()) : null;
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      [CLIENT_HEADER]: clientId(),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = now();
  let response;
  let text;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, signal: controller.signal });
    text = await response.text();
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }
  trip.networkMs += now() - started;

  if (response.status === 401 && bearer) {
    // A sign-in from another tab may have replaced the token meanwhile; keep that one.
    if (loadSessionToken() === bearer) persistSessionToken(null);
    throw new SessionLostError();
  }

  // A static host answers /api/* with its HTML fallback: the API is not deployed there.
  const type = response.headers.get('content-type') ?? '';
  if (!type.startsWith('application/json') && !(response.ok && text === '')) throw new OfflineError();
  const payload = text === '' ? {} : safeJsonParse(text, { fallback: null, maxLength: MAX_RESPONSE_CHARS });

  if (response.ok) {
    if (!isRecord(payload)) throw new ApiError('storage', 'Lumen Cloud sent an unreadable response.');
    return payload;
  }
  const fault = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const message =
    sanitizeText(fault.message, { maxLength: 240 }) || `Lumen Cloud refused the request (HTTP ${response.status}).`;
  const code = PASSED_FAULTS.has(fault.code) ? fault.code : response.status >= 500 ? 'storage' : 'invalid';
  throw new ApiError(code, message);
}

/**
 * Runs one client call. Storage writes are queued on the trip and applied
 * when the call settles, never sooner than LATENCY_MS.min after it started,
 * so the mirror changes exactly when the UI leaves its pending state.
 */
async function runWork(work, trip) {
  try {
    return await work(trip);
  } catch (error) {
    if (!(error instanceof SessionLostError)) throw error;
    // The token is gone now, so the rerun resolves the browser-profile library from scratch.
    trip.commits.clear();
    return work(trip);
  }
}

async function roundTrip(work) {
  const started = now();
  const trip = { mode: 'http', networkMs: 0, commits: new Map() };
  let value;
  let failure = null;
  try {
    value = await runWork(work, trip);
  } catch (error) {
    failure = error;
  }
  const remaining = LATENCY_MS.min - (now() - started);
  if (remaining > 0) await delay(remaining);

  try {
    trip.commits.forEach((commit) => commit());
  } catch (error) {
    failure ??= error;
  }
  setTransport(trip.mode, trip.mode === 'http' ? Math.round(trip.networkMs) : null);
  if (failure) throw failure;
  return value;
}

function goOffline(trip, error) {
  if (!(error instanceof OfflineError)) throw error;
  trip.mode = 'local';
  trip.commits.clear();
}

/* Device mirror and sync marker */

const COLLECTIONS = {
  projects: { key: PROJECTS_STORAGE_KEY, normalize: normalizeProjects, serialize: serializeProjectRecord },
  quotes: { key: QUOTES_STORAGE_KEY, normalize: normalizeQuotes, serialize: (quote) => quote },
};

function readMirror(name) {
  const { key, normalize } = COLLECTIONS[name];
  const raw = safeStorage.read(key, { fallback: null });
  return { raw, list: normalize(Array.isArray(raw) ? raw : []) };
}

// FNV-1a over the canonical JSON: cheap change detection, not a security boundary.
function fingerprint(raw) {
  if (raw === null) return null;
  const text = JSON.stringify(raw);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}.${hash.toString(36)}`;
}

const OWNER_PATTERN = /^(?:device|acct\.[a-z0-9]{1,8}\.[a-z0-9]{1,8})$/;

function readMarker(value) {
  // v2 markers were bare fingerprints of a browser-profile mirror.
  if (typeof value === 'string') return { fp: value.length <= 32 ? value : null, owner: 'device' };
  if (!isRecord(value)) return { fp: null, owner: 'device' };
  return {
    fp: typeof value.fp === 'string' && value.fp.length <= 32 ? value.fp : null,
    owner: typeof value.owner === 'string' && OWNER_PATTERN.test(value.owner) ? value.owner : 'device',
  };
}

function readMarkers() {
  const stored = safeStorage.read(SYNC_STORAGE_KEY, { fallback: {}, validate: isRecord });
  return { projects: readMarker(stored.projects), quotes: readMarker(stored.quotes) };
}

function writeMarker(name, fp) {
  safeStorage.write(SYNC_STORAGE_KEY, { ...readMarkers(), [name]: { fp, owner: libraryOwner() } });
}

/** Mirror := server list. A semantically equal mirror is left as written and only re-marked. */
function reconcile(name, serverList) {
  return () => {
    const { key, serialize } = COLLECTIONS[name];
    const { raw, list } = readMirror(name);
    const wire = serverList.map(serialize);
    if (JSON.stringify(list.map(serialize)) === JSON.stringify(wire)) {
      writeMarker(name, fingerprint(raw));
    } else if (safeStorage.write(key, wire)) {
      writeMarker(name, fingerprint(wire));
    } else {
      // Never leave a stale mirror marked as unsynced: it would be pushed over the server copy.
      safeStorage.remove(key);
      writeMarker(name, null);
    }
  };
}

function writeOffline(name, list) {
  const { key, serialize } = COLLECTIONS[name];
  return () => {
    if (!safeStorage.write(key, list.map(serialize))) throw unreachable();
  };
}

function batchBySize(records) {
  const batches = [[]];
  let size = 0;
  for (const record of records) {
    const length = JSON.stringify(record).length;
    if (size + length > SYNC_BATCH_CHARS && batches.at(-1).length > 0) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1).push(record);
    size += length;
  }
  return batches;
}

/**
 * Pushes a diverged mirror and resolves with the server list, or null when
 * there is nothing to push: the mirror is in sync, or it was reconciled
 * against another account and must not leak into this library.
 */
async function syncIfDiverged(trip, name) {
  const { raw, list } = readMirror(name);
  const marker = readMarkers()[name];
  const owner = libraryOwner();
  if (fingerprint(raw) === marker.fp) return null;
  if (marker.owner !== 'device' && marker.owner !== owner) return null;

  let payload;
  if (name === 'quotes') {
    payload = await request(trip, 'POST', '/sync', { quotes: list });
  } else {
    // A full 12-project library can exceed one 64 KB body; later batches merge.
    const first = owner === 'device' ? 'replace' : 'merge';
    const batches = batchBySize(list.map(serializeProjectRecord));
    for (const [i, projects] of batches.entries()) {
      payload = await request(trip, 'POST', '/sync', { mode: i === 0 ? first : 'merge', projects });
    }
  }
  const synced = COLLECTIONS[name].normalize(payload[name]);
  trip.commits.set(name, reconcile(name, synced));
  return synced;
}

async function loadCollection(name) {
  return roundTrip(async (trip) => {
    try {
      const list =
        (await syncIfDiverged(trip, name)) ?? COLLECTIONS[name].normalize((await request(trip, 'GET', `/${name}`))[name]);
      trip.commits.set(name, reconcile(name, list));
      return list;
    } catch (error) {
      goOffline(trip, error);
      return readMirror(name).list;
    }
  });
}

/* Projects */

function requestedName(kind, data, options) {
  if (isRecord(options) && typeof options.name === 'string') return sanitizeProjectName(options.name, kind);
  if (isRecord(data) && typeof data.projectName === 'string') return sanitizeProjectName(data.projectName, kind);
  return PROJECT_NAMES[kind];
}

function assertRoomFor(projects, id) {
  if (!projects.some((project) => project.id === id) && projects.length >= MAX_STORED_PROJECTS) {
    throw new ApiError(
      'quota',
      `Lumen Cloud holds ${MAX_STORED_PROJECTS} projects. Delete one from your account to save a new name.`,
    );
  }
}

/**
 * Saves a wall or room to the cloud library. The default name ("Wall A",
 * "Room") keeps the single-slot id; any other name is its own project with a
 * deterministic id, so saving an existing name bumps its revision. A new name
 * is refused once the library is full, so nothing is evicted silently.
 * Resolves with the stored record; rejects with ApiError.
 */
export function saveProject(kind, data, options = {}) {
  if (!isOneOf(kind, PROJECT_KINDS)) return Promise.reject(new ApiError('invalid', 'Unknown project type.'));
  const codec = PROJECT_CODECS[kind];
  const snapshot = codec.sanitize(codec.serialize(data));
  if (!snapshot || snapshot.items.length === 0) {
    return Promise.reject(new ApiError('invalid', 'Mount at least one module before saving.'));
  }
  const name = requestedName(kind, data, options);
  const id = projectIdFor(kind, name);

  return roundTrip(async (trip) => {
    try {
      // The mirror tracks the server, so a full library is refused before the request.
      assertRoomFor((await syncIfDiverged(trip, 'projects')) ?? readMirror('projects').list, id);
      const payload = await request(trip, 'POST', '/projects', { kind, name, data: codec.serialize(snapshot) });
      const record = sanitizeProjectRecord(payload.project);
      if (!record) throw new ApiError('storage', 'Lumen Cloud sent an unreadable project record.');
      trip.commits.set('projects', reconcile('projects', normalizeProjects(payload.projects)));
      return record;
    } catch (error) {
      goOffline(trip, error);
      const projects = readMirror('projects').list;
      assertRoomFor(projects, id);
      const previous = projects.find((project) => project.id === id);
      const record = {
        id,
        kind,
        name,
        revision: Math.min(MAX_REVISION, (previous?.revision ?? 0) + 1),
        savedAt: new Date().toISOString(),
        data: snapshot,
      };
      trip.commits.set('projects', writeOffline('projects', [record, ...projects.filter((p) => p.id !== id)]));
      return record;
    }
  });
}

/**
 * Removes one project from the cloud library. Idempotent: an id that is
 * already gone resolves too. Resolves with the remaining projects, newest first.
 */
export function deleteProject(id) {
  if (!isProjectId(id)) return Promise.reject(new ApiError('invalid', 'Unknown project.'));
  return roundTrip(async (trip) => {
    try {
      await syncIfDiverged(trip, 'projects');
      const payload = await request(trip, 'DELETE', `/projects/${encodeURIComponent(id)}`);
      const remaining = normalizeProjects(payload.projects);
      trip.commits.set('projects', reconcile('projects', remaining));
      return remaining;
    } catch (error) {
      goOffline(trip, error);
      const remaining = readMirror('projects').list.filter((project) => project.id !== id);
      trip.commits.set('projects', writeOffline('projects', remaining));
      return remaining;
    }
  });
}

/** Resolves with every saved project, newest first. Tampered entries are dropped. */
export function loadProjects() {
  return loadCollection('projects');
}

/* Quotes */

// The server rebuilds totals from these inputs; grossMinor is its cross-check.
function quotePayload(quote) {
  return {
    currency: quote.currency.code,
    promo: quote.promo ? quote.promo.code : null,
    includeDriver: quote.electrical.driverIncluded,
    grossMinor: quote.totals.gross,
    items: quote.lines
      .filter((line) => !line.driver)
      .map((line) => {
        const [id, finish] = line.key.split(':');
        return { id, finish, qty: line.qty };
      }),
  };
}

/**
 * Submits a built quote with its project fields as a requisition. The
 * server prices it again and issues the reference. Resolves with the stored
 * record, whose `ref` is the requisition reference.
 */
export function submitQuote({ quote, project }) {
  const fields = sanitizeProject(project);
  if (Object.keys(validateProject(fields)).length > 0) {
    return Promise.reject(new ApiError('invalid', 'Project reference and client are required.'));
  }
  if (quote.lines.length === 0) {
    return Promise.reject(new ApiError('invalid', 'The quote has no valid lines.'));
  }
  const body = { quote: quotePayload(quote), project: fields };

  return roundTrip(async (trip) => {
    try {
      await syncIfDiverged(trip, 'quotes');
      const payload = await request(trip, 'POST', '/quotes', body);
      const record = sanitizeQuoteRecord(payload.quote);
      if (!record) throw new ApiError('storage', 'Lumen Cloud sent an unreadable requisition.');
      trip.commits.set('quotes', reconcile('quotes', normalizeQuotes(payload.quotes)));
      return record;
    } catch (error) {
      goOffline(trip, error);
      throw new ApiError(
        'storage',
        'Lumen Cloud is unreachable, so the requisition was not submitted. The quote sheet is unchanged.',
      );
    }
  });
}

/** Resolves with submitted requisitions, newest first. */
export function loadQuotes() {
  return loadCollection('quotes');
}

/* Studio AI concierge */

// The engine and the catalog math behind it load only with the concierge,
// never with the entry bundle.
function loadEngine() {
  return import('../lib/concierge-engine.js');
}

/**
 * Asks the Studio AI concierge. The server answers over HTTP; when the API is
 * unreachable the same deterministic engine answers on this device, so the
 * reply is identical either way. Resolves with `{ reply, transport }`.
 */
export function askConcierge(question, workspaceContext) {
  return roundTrip(async (trip) => {
    const engine = await loadEngine();
    try {
      const payload = await request(trip, 'POST', '/concierge/ask', { question, workspaceContext }, { session: false });
      const reply = engine.sanitizeConciergeReply(payload.reply);
      if (!reply) throw new ApiError('storage', 'The concierge sent an unreadable reply.');
      return { reply, transport: 'http' };
    } catch (error) {
      goOffline(trip, error);
      return { reply: engine.evaluateConciergeQuery(question, workspaceContext), transport: 'local' };
    }
  });
}

/* Studio engineering tickets */

// Tickets written while the API was unreachable wait here, with the full
// escalation request, until the server's gatekeeper accepts or refuses them.
const MAX_OUTBOX = 4;

function readTicketMirror() {
  return normalizeTickets(safeStorage.read(TICKETS_STORAGE_KEY, { fallback: [], validate: Array.isArray }));
}

function readOutbox() {
  const stored = safeStorage.read(TICKET_OUTBOX_STORAGE_KEY, { fallback: [], validate: Array.isArray });
  return stored
    .filter(
      (entry) =>
        isRecord(entry) &&
        typeof entry.ref === 'string' &&
        TICKET_REF_PATTERN.test(entry.ref) &&
        typeof entry.owner === 'string' &&
        OWNER_PATTERN.test(entry.owner) &&
        isRecord(entry.payload) &&
        sanitizeTicketRecord(entry.ticket)?.ref === entry.ref,
    )
    .slice(0, MAX_OUTBOX);
}

function writeOutbox(entries) {
  return entries.length === 0 ? safeStorage.remove(TICKET_OUTBOX_STORAGE_KEY) : safeStorage.write(TICKET_OUTBOX_STORAGE_KEY, entries);
}

function outboxFor(owner) {
  return readOutbox().filter((entry) => entry.owner === 'device' || entry.owner === owner);
}

/** Server tickets plus this library's queued device tickets, newest first; queued ones carry `pending: true`. */
function withPending(list) {
  const known = new Set(list.map((ticket) => ticket.ref));
  const queued = outboxFor(libraryOwner())
    .map((entry) => sanitizeTicketRecord(entry.ticket))
    .filter((ticket) => ticket && !known.has(ticket.ref))
    .map((ticket) => ({ ...ticket, pending: true }));
  return [...list.map((ticket) => ({ ...ticket, pending: false })), ...queued]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, MAX_STORED_TICKETS);
}

/**
 * Sends queued device tickets through the server gatekeeper. Each entry leaves
 * the outbox as soon as the server answers it, accepted or refused for good,
 * so a dropped connection later in the trip can never send it twice.
 */
async function flushTicketOutbox(trip) {
  for (const entry of outboxFor(libraryOwner())) {
    try {
      await request(trip, 'POST', '/concierge/escalate', entry.payload);
    } catch (error) {
      if (!(error instanceof ApiError) || error.code === 'storage') throw error;
    }
    writeOutbox(readOutbox().filter((queued) => queued.ref !== entry.ref));
  }
}

function reconcileTickets(list) {
  return () => {
    if (!safeStorage.write(TICKETS_STORAGE_KEY, list)) safeStorage.remove(TICKETS_STORAGE_KEY);
  };
}

/**
 * Transmits an engineering ticket. The server re-verifies the gatekeeper
 * (an unresolved or unhelpful-marked concierge turn) and issues the
 * `LMN-T-` reference. Offline, the same gatekeeper runs on this device and
 * the ticket is queued for the server. Resolves with `{ ticket, transport }`;
 * rejects with ApiError (`gatekeeper_locked`, `invalid` or `storage`).
 */
export function submitSupportTicket(payload) {
  return roundTrip(async (trip) => {
    try {
      await flushTicketOutbox(trip);
      const response = await request(trip, 'POST', '/concierge/escalate', payload);
      const ticket = sanitizeTicketRecord(response.ticket);
      if (!ticket) throw new ApiError('storage', 'Lumen Cloud sent an unreadable ticket.');
      trip.commits.set('tickets', reconcileTickets(normalizeTickets(response.tickets)));
      return { ticket, transport: 'http' };
    } catch (error) {
      goOffline(trip, error);
      const verdict = (await loadEngine()).validateEscalationRequest(payload);
      if (!verdict.ok) throw new ApiError(verdict.code, verdict.message);
      const ticket = sanitizeTicketRecord({
        ...verdict.ticket,
        ref: `LMN-T-${randomHex(4).toUpperCase()}`,
        submittedAt: new Date().toISOString(),
        status: TICKET_QUEUED,
      });
      if (!ticket) throw new ApiError('invalid', 'The ticket could not be encoded.');
      const owner = libraryOwner();
      trip.commits.set('tickets', () => {
        const queued = [...readOutbox(), { ref: ticket.ref, owner, payload, ticket }];
        if (queued.length > MAX_OUTBOX || !writeOutbox(queued)) throw unreachable();
      });
      return { ticket, transport: 'local' };
    }
  });
}

/** Resolves with this library's engineering tickets, newest first, queued device tickets included. */
export function loadSupportTickets() {
  return roundTrip(async (trip) => {
    try {
      await flushTicketOutbox(trip);
      const list = normalizeTickets((await request(trip, 'GET', '/tickets')).tickets);
      trip.commits.set('tickets', reconcileTickets(list));
      return withPending(list);
    } catch (error) {
      goOffline(trip, error);
      return withPending(readTicketMirror());
    }
  });
}

/* Sessions */

function claimedCount(library, key) {
  const value = isRecord(library) && isRecord(library.claimed) ? library.claimed[key] : 0;
  return Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0;
}

/**
 * Opens a server session. The server also moves this browser profile's
 * library into the account; `claimed` counts what moved. Resolves with
 * `{ user, token, expiresAt, claimed }`, or with null when the API is
 * unreachable so the caller can fall back to a device-only guest session.
 * Rejects with ApiError when the server refuses.
 */
export async function openSession({ email, password }) {
  const trip = { mode: 'http', networkMs: 0 };
  try {
    const payload = await request(trip, 'POST', '/auth/session', { email, password }, { session: false });
    const user = sanitizeUser(payload.user);
    const token = sanitizeSessionToken(payload.token);
    if (!user || !token) throw new ApiError('storage', 'Lumen Cloud sent an unreadable session.');
    setTransport('http', Math.round(trip.networkMs));
    return {
      user,
      token,
      expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
      claimed: { projects: claimedCount(payload.library, 'projects'), quotes: claimedCount(payload.library, 'quotes') },
    };
  } catch (error) {
    if (!(error instanceof OfflineError)) throw error;
    setTransport('local', null);
    return null;
  }
}

/** Revokes a server session. Fire and forget: never rejects. */
export async function closeSession(token) {
  const bearer = sanitizeSessionToken(token);
  if (!bearer) return false;
  try {
    await request({ networkMs: 0 }, 'DELETE', '/auth/session', undefined, {
      headers: { Authorization: `Bearer ${bearer}` },
      session: false,
    });
    return true;
  } catch {
    return false;
  }
}
