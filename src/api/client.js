import { sanitizeRoomState, serializeRoomState } from '../lib/room-3d.js';
import { CURRENCY_CODES, requisitionRef, sanitizeProject, validateProject } from '../lib/quote.js';
import { sanitizeLayout, serializeLayout } from '../lib/wall-studio.js';
import { isOneOf, safeStorage, sanitizeText } from '../security/sanitize.js';

/**
 * Lumen Cloud client. Every call resolves after a simulated round trip so the
 * UI is built against real network timing. Until the server/ API ships, the
 * transport is safeStorage: records are snapshotted at call time, written
 * after the delay, and sanitized again on every read.
 */

export const PROJECTS_STORAGE_KEY = 'lumen_cloud_projects_v1';
export const QUOTES_STORAGE_KEY = 'lumen_cloud_quotes_v1';
export const LATENCY_MS = Object.freeze({ min: 500, max: 1200 });
export const PROJECT_KINDS = Object.freeze(['wall', 'room']);
export const PROJECT_NAMES = Object.freeze({ wall: 'Wall A', room: 'Room' });
export const QUOTE_STATUSES = Object.freeze(['Pending review', 'In production', 'Delivered', 'Quote expired']);
export const MAX_STORED_QUOTES = 24;

const MAX_REVISION = 9999;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REQUISITION_PATTERN = /^LMN-R-[0-9A-F]{8}$/;
const QUOTE_ID_PATTERN = /^LMN-Q-\d{8}-[0-9A-Z]{6}$/;

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function sanitizeTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function latency() {
  return LATENCY_MS.min + Math.round(Math.random() * (LATENCY_MS.max - LATENCY_MS.min));
}

function roundTrip(work) {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      try {
        resolve(work());
      } catch (error) {
        reject(error);
      }
    }, latency());
  });
}

function unreachable() {
  return new ApiError('storage', 'Lumen Cloud is unreachable from this device. Nothing was saved.');
}

/* Projects */

const PROJECT_CODECS = {
  wall: { sanitize: sanitizeLayout, serialize: serializeLayout },
  room: { sanitize: sanitizeRoomState, serialize: serializeRoomState },
};

function sanitizeProjectRecord(entry) {
  if (!isRecord(entry) || !isOneOf(entry.kind, PROJECT_KINDS)) return null;
  const savedAt = sanitizeTimestamp(entry.savedAt);
  if (!savedAt || !isBoundedInt(entry.revision, 1, MAX_REVISION)) return null;
  const data = PROJECT_CODECS[entry.kind].sanitize(entry.data);
  if (!data) return null;
  return { id: entry.kind, kind: entry.kind, name: PROJECT_NAMES[entry.kind], revision: entry.revision, savedAt, data };
}

function readProjects() {
  const stored = safeStorage.read(PROJECTS_STORAGE_KEY, { fallback: [], validate: Array.isArray });
  const seen = new Set();
  const projects = [];
  for (const entry of stored) {
    const project = sanitizeProjectRecord(entry);
    if (!project || seen.has(project.kind)) continue;
    seen.add(project.kind);
    projects.push(project);
  }
  return projects.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

function toStoredProject({ kind, revision, savedAt, data }) {
  return { kind, revision, savedAt, data: PROJECT_CODECS[kind].serialize(data) };
}

/**
 * Saves the wall or room as its cloud project, one slot per kind, bumping the
 * revision. Resolves with the stored record; rejects with ApiError when the
 * kind or payload is invalid or storage refuses the write.
 */
export function saveProject(kind, data) {
  if (!isOneOf(kind, PROJECT_KINDS)) return Promise.reject(new ApiError('invalid', 'Unknown project type.'));
  const codec = PROJECT_CODECS[kind];
  const snapshot = codec.sanitize(codec.serialize(data));
  if (!snapshot || snapshot.items.length === 0) {
    return Promise.reject(new ApiError('invalid', 'Mount at least one module before saving.'));
  }

  return roundTrip(() => {
    const projects = readProjects();
    const previous = projects.find((project) => project.kind === kind);
    const record = {
      id: kind,
      kind,
      name: PROJECT_NAMES[kind],
      revision: Math.min(MAX_REVISION, (previous?.revision ?? 0) + 1),
      savedAt: new Date().toISOString(),
      data: snapshot,
    };
    const next = [record, ...projects.filter((project) => project.kind !== kind)];
    if (!safeStorage.write(PROJECTS_STORAGE_KEY, next.map(toStoredProject))) throw unreachable();
    return record;
  });
}

/** Resolves with every saved project, newest first. Tampered entries are dropped. */
export function loadProjects() {
  return roundTrip(readProjects);
}

/* Quotes */

function sanitizeQuoteRecord(entry) {
  if (!isRecord(entry)) return null;
  const { ref, quoteId, currency, grossMinor, lines, loadW, status } = entry;
  const submittedAt = sanitizeTimestamp(entry.submittedAt);
  const reference = sanitizeText(entry.reference, { maxLength: 96 });
  const preparedFor = sanitizeText(entry.preparedFor, { maxLength: 96 });
  if (
    !submittedAt ||
    !reference ||
    !preparedFor ||
    typeof ref !== 'string' ||
    !REQUISITION_PATTERN.test(ref) ||
    typeof quoteId !== 'string' ||
    !QUOTE_ID_PATTERN.test(quoteId) ||
    !isOneOf(currency, CURRENCY_CODES) ||
    !isOneOf(status, QUOTE_STATUSES) ||
    !isBoundedInt(grossMinor, 0, 1e12) ||
    !isBoundedInt(lines, 1, 999) ||
    !isBoundedInt(loadW, 0, 100_000)
  ) {
    return null;
  }
  return { ref, quoteId, submittedAt, reference, preparedFor, currency, grossMinor, lines, loadW, status };
}

function readQuotes() {
  const stored = safeStorage.read(QUOTES_STORAGE_KEY, { fallback: [], validate: Array.isArray });
  return stored
    .slice(0, MAX_STORED_QUOTES)
    .map(sanitizeQuoteRecord)
    .filter(Boolean)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/**
 * Submits a built quote with its project fields as a requisition. Resolves
 * with the stored record, whose `ref` is the requisition reference.
 */
export function submitQuote({ quote, project }) {
  const fields = sanitizeProject(project);
  if (Object.keys(validateProject(fields)).length > 0) {
    return Promise.reject(new ApiError('invalid', 'Project reference and client are required.'));
  }
  if (quote.lines.length === 0) {
    return Promise.reject(new ApiError('invalid', 'The quote has no valid lines.'));
  }

  const record = sanitizeQuoteRecord({
    ref: requisitionRef(),
    quoteId: quote.quoteId,
    submittedAt: new Date().toISOString(),
    reference: fields.reference,
    preparedFor: fields.preparedFor,
    currency: quote.currency.code,
    grossMinor: quote.totals.gross,
    lines: quote.lines.length,
    loadW: quote.electrical.loadW,
    status: 'Pending review',
  });
  if (!record) return Promise.reject(new ApiError('invalid', 'The quote could not be encoded.'));

  return roundTrip(() => {
    const next = [record, ...readQuotes()].slice(0, MAX_STORED_QUOTES);
    if (!safeStorage.write(QUOTES_STORAGE_KEY, next)) throw unreachable();
    return record;
  });
}

/** Resolves with submitted requisitions, newest first. */
export function loadQuotes() {
  return roundTrip(readQuotes);
}
