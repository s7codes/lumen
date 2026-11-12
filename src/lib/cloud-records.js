import { isOneOf, sanitizeMultilineText, sanitizeText } from '../security/sanitize.js';
import { sanitizeEmail } from './auth.js';
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
export const MAX_STORED_TICKETS = 12;
export const MAX_REVISION = 9999;
export const QUOTE_STATUSES = Object.freeze(['Pending review', 'In production', 'Delivered', 'Quote expired']);
export const REQUISITION_PATTERN = /^LMN-R-[0-9A-F]{8}$/;
export const QUOTE_ID_PATTERN = /^LMN-Q-\d{8}-[0-9A-Z]{6}$/;

/*
 * Studio engineering tickets. A ticket only exists once the Studio AI
 * concierge could not settle an inquiry (`unresolved_query`) or the visitor
 * marked its answer as not resolving the issue (`marked_unhelpful`).
 */
export const TICKET_REF_PATTERN = /^LMN-T-[0-9A-F]{8}$/;
export const TICKET_QUEUED = 'Queued for Engineering Review';
export const TICKET_STATUSES = Object.freeze([TICKET_QUEUED, 'In Engineering Review', 'Closed']);
export const ESCALATION_REASONS = Object.freeze(['unresolved_query', 'marked_unhelpful']);
export const TICKET_LIMITS = Object.freeze({
  subject: Object.freeze({ min: 2, max: 120 }),
  message: Object.freeze({ min: 10, max: 2000 }),
  summary: 600,
  inquiry: 500,
  turns: 24,
});

const MAX_SCANNED_PROJECTS = 64;
const MAX_SCANNED_QUOTES = 64;
const MAX_SCANNED_TICKETS = 64;
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

/** Ticket subject: one line, 2 to 120 characters, or '' when out of range. */
export function sanitizeTicketSubject(value) {
  const text = sanitizeText(value, { maxLength: TICKET_LIMITS.subject.max + 1 });
  return text.length >= TICKET_LIMITS.subject.min && text.length <= TICKET_LIMITS.subject.max ? text : '';
}

/** Ticket brief: multi-line, 10 to 2000 characters, or '' when out of range. */
export function sanitizeTicketMessage(value) {
  const text = sanitizeMultilineText(value, { maxLength: TICKET_LIMITS.message.max + 1 });
  return text.length >= TICKET_LIMITS.message.min && text.length <= TICKET_LIMITS.message.max ? text : '';
}

export function sanitizeTicketRecord(entry) {
  if (!isRecord(entry)) return null;
  const { ref, reason, status, turns } = entry;
  const submittedAt = sanitizeTimestamp(entry.submittedAt);
  const email = sanitizeEmail(entry.email);
  const subject = sanitizeTicketSubject(entry.subject);
  const message = sanitizeTicketMessage(entry.message);
  const inquiry = sanitizeText(entry.inquiry, { maxLength: TICKET_LIMITS.inquiry });
  if (
    !submittedAt ||
    !email ||
    !subject ||
    !message ||
    !inquiry ||
    typeof ref !== 'string' ||
    !TICKET_REF_PATTERN.test(ref) ||
    !isOneOf(reason, ESCALATION_REASONS) ||
    !isOneOf(status, TICKET_STATUSES) ||
    !isBoundedInt(turns, 1, TICKET_LIMITS.turns)
  ) {
    return null;
  }
  const workspaceSummary = sanitizeMultilineText(entry.workspaceSummary, { maxLength: TICKET_LIMITS.summary });
  return { ref, submittedAt, email, subject, message, reason, status, inquiry, turns, workspaceSummary };
}

/** Sanitizes, de-duplicates by ticket reference and orders newest first. */
export function normalizeTickets(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const tickets = [];
  for (const entry of entries.slice(0, MAX_SCANNED_TICKETS)) {
    const ticket = sanitizeTicketRecord(entry);
    if (!ticket || seen.has(ticket.ref)) continue;
    seen.add(ticket.ref);
    tickets.push(ticket);
  }
  return tickets.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, MAX_STORED_TICKETS);
}
