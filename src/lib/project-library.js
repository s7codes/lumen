import { isOneOf, safeStorage, sanitizeText } from '../security/sanitize.js';

export const PROJECT_KINDS = Object.freeze(['wall', 'room']);
export const PROJECT_NAMES = Object.freeze({ wall: 'Wall A', room: 'Room' });
export const PROJECT_NAME_MAX = 48;
export const ACTIVE_NAMES_STORAGE_KEY = 'lumen_project_names_v1';

const SLUG_MAX = 40;
const PROJECT_ID_MAX = 64;
const PROJECT_ID_PATTERN = /^(wall|room)(?:-[a-z0-9]+)*$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** One line, no control characters, at most 48 characters. Blank falls back to the kind's default. */
export function sanitizeProjectName(value, kind) {
  return sanitizeText(value, { maxLength: PROJECT_NAME_MAX }) || PROJECT_NAMES[kind] || '';
}

function slugify(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

// FNV-1a over code points: a stable key for names with no Latin letters or digits to slug.
function hashName(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Deterministic cloud id for a named project. The default name keeps the
 * original single-slot id ("wall" or "room"); any other name becomes
 * "<kind>-<slug>", so saving the same name again revises the same project.
 */
export function projectIdFor(kind, name) {
  const clean = sanitizeProjectName(name, kind);
  const slug = slugify(clean);
  if (slug === slugify(PROJECT_NAMES[kind])) return kind;
  return `${kind}-${slug || `n${hashName(clean)}`}`;
}

export function isProjectId(value) {
  return typeof value === 'string' && value.length <= PROJECT_ID_MAX && PROJECT_ID_PATTERN.test(value);
}

export function projectIdKind(id) {
  return isProjectId(id) ? id.split('-')[0] : null;
}

/* Active project name per planner, kept beside the local draft. */

function readActiveNames() {
  return safeStorage.read(ACTIVE_NAMES_STORAGE_KEY, { fallback: {}, validate: isRecord });
}

export function loadProjectName(kind) {
  if (!isOneOf(kind, PROJECT_KINDS)) return '';
  return sanitizeProjectName(readActiveNames()[kind], kind);
}

export function persistProjectName(kind, name) {
  if (!isOneOf(kind, PROJECT_KINDS)) return false;
  const stored = readActiveNames();
  const next = {};
  for (const entry of PROJECT_KINDS) {
    next[entry] = sanitizeProjectName(entry === kind ? name : stored[entry], entry);
  }
  return safeStorage.write(ACTIVE_NAMES_STORAGE_KEY, next);
}
