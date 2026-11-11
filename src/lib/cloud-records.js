import { isOneOf, sanitizeText } from '../security/sanitize.js';
import { PROJECT_KINDS, projectIdKind, sanitizeProjectName } from './project-library.js';
import { CURRENCY_CODES } from './quote.js';
import { sanitizeRoomState, serializeRoomState } from './room-3d.js';
import { sanitizeLayout, serializeLayout } from './wall-studio.js';

/**
 * Canonical Lumen Cloud record rules, shared by the browser client and the
 * server/ API so both sides accept, reject and order records identically.
 */

export const MAX_STORED_PROJECTS = 12;
export const MAX_STORED_QUOTES = 24;
export const MAX_REVISION = 9999;
export const QUOTE_STATUSES = Object.freeze(['Pending review', 'In production', 'Delivered', 'Quote expired']);
export const REQUISITION_PATTERN = /^LMN-R-[0-9A-F]{8}$/;
export const QUOTE_ID_PATTERN = /^LMN-Q-\d{8}-[0-9A-Z]{6}$/;

const MAX_SCANNED_PROJECTS = 64;
const MAX_SCANNED_QUOTES = 64;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const PROJECT_CODECS = Object.freeze({
  wall: Object.freeze({ sanitize: sanitizeLayout, serialize: serializeLayout }),
  room: Object.freeze({ sanitize: sanitizeRoomState, serialize: serializeRoomState }),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isBoundedInt(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function sanitizeTimestamp(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Sanitized, in-memory snapshot of a wall or room, or null when the envelope is not one. */
export function sanitizeProjectData(kind, data) {
  if (!isOneOf(kind, PROJECT_KINDS)) return null;
  return PROJECT_CODECS[kind].sanitize(data);
}

/**
 * Rebuilds one stored project. Legacy single-slot records carry no id or
 * name and read as the kind's default project. An id that does not belong
 * to the record's kind is treated as tampered.
 */
export function sanitizeProjectRecord(entry) {
  if (!isRecord(entry) || !isOneOf(entry.kind, PROJECT_KINDS)) return null;
  const { kind } = entry;
  const id = entry.id === undefined ? kind : entry.id;
  if (projectIdKind(id) !== kind) return null;
  const savedAt = sanitizeTimestamp(entry.savedAt);
  if (!savedAt || !isBoundedInt(entry.revision, 1, MAX_REVISION)) return null;
  const data = PROJECT_CODECS[kind].sanitize(entry.data);
  if (!data) return null;
  return { id, kind, name: sanitizeProjectName(entry.name, kind), revision: entry.revision, savedAt, data };
}

/** Wire and storage form: the project data travels as its serialized envelope. */
export function serializeProjectRecord({ id, kind, name, revision, savedAt, data }) {
  return { id, kind, name, revision, savedAt, data: PROJECT_CODECS[kind].serialize(data) };
}

/** Sanitizes, de-duplicates by id and orders newest first, capped at the library size. */
export function normalizeProjects(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const projects = [];
  for (const entry of entries.slice(0, MAX_SCANNED_PROJECTS)) {
    const project = sanitizeProjectRecord(entry);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return projects.sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, MAX_STORED_PROJECTS);
}

export function sanitizeQuoteRecord(entry) {
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

/** Sanitizes, de-duplicates by requisition reference and orders newest first. */
export function normalizeQuotes(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const quotes = [];
  for (const entry of entries.slice(0, MAX_SCANNED_QUOTES)) {
    const quote = sanitizeQuoteRecord(entry);
    if (!quote || seen.has(quote.ref)) continue;
    seen.add(quote.ref);
    quotes.push(quote);
  }
  return quotes.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, MAX_STORED_QUOTES);
}
