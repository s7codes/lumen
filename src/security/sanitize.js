const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_LENGTH = 1_000_000;

const STORAGE_NAMESPACE = 'lumen:';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ANY_CONTROL_CHAR = /[\u0000-\u001F\u007F]/;

class DepthExceededError extends Error {}

function rebuild(value, depth, maxDepth) {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= maxDepth) throw new DepthExceededError();

  if (Array.isArray(value)) {
    return value.map((item) => rebuild(item, depth + 1, maxDepth));
  }

  // JSON.parse defines "__proto__" as an own key, so it never pollutes on its own.
  // The risk is a later merge or spread. Rebuilding into a fresh object and
  // dropping the forbidden keys removes that risk at the boundary.
  const out = {};
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = rebuild(value[key], depth + 1, maxDepth);
  }
  return out;
}

/**
 * Parses untrusted JSON. Never throws. Returns `fallback` for non-string input,
 * oversized input, malformed JSON, or structures nested deeper than `maxDepth`.
 * Strips `__proto__`, `constructor` and `prototype` keys at every level.
 */
export function safeJsonParse(input, options = {}) {
  const {
    fallback = null,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxLength = DEFAULT_MAX_LENGTH,
  } = options;

  if (typeof input !== 'string' || input.length === 0 || input.length > maxLength) {
    return fallback;
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    return fallback;
  }

  try {
    return rebuild(parsed, 0, maxDepth);
  } catch (error) {
    if (error instanceof DepthExceededError || error instanceof RangeError) return fallback;
    throw error;
  }
}

export function hasForbiddenKey(key) {
  return FORBIDDEN_KEYS.has(key);
}

export function isSafeId(value, { maxLength = 64 } = {}) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    SAFE_ID_PATTERN.test(value) &&
    !FORBIDDEN_KEYS.has(value)
  );
}

export function isOneOf(value, allowed) {
  return typeof value === 'string' && allowed.includes(value);
}

/**
 * Normalises free text for display or storage: NFC, no control characters,
 * collapsed whitespace, hard length cap. React still escapes on render;
 * this keeps stored and logged values predictable.
 */
export function sanitizeText(value, { maxLength = 256 } = {}) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function clampNumber(value, min, max, fallback = min) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Accepts only same-origin app paths such as "/catalog?finish=walnut".
 * Rejects protocol-relative URLs, backslash tricks, schemes like "javascript:"
 * and anything with control characters, which closes open-redirect and
 * URL-based XSS vectors when a path comes from a query string or storage.
 */
export function isSafeInternalPath(value, { maxLength = 2048 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return false;
  if (value[0] !== '/' || value[1] === '/' || value[1] === '\\') return false;
  if (value.includes('\\') || ANY_CONTROL_CHAR.test(value)) return false;

  try {
    const base = 'https://lumen.invalid';
    const url = new URL(value, base);
    return url.origin === base;
  } catch {
    return false;
  }
}

function resolveStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = `${STORAGE_NAMESPACE}__probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    // Private mode, disabled cookies, or a sandboxed frame.
    return null;
  }
}

function namespacedKey(key) {
  return isSafeId(key) ? `${STORAGE_NAMESPACE}${key}` : null;
}

/**
 * Namespaced localStorage wrapper. All reads go through safeJsonParse and an
 * optional validator, so a tampered or stale value falls back instead of
 * reaching application state. Every method is a no-op when storage is unavailable.
 */
export const safeStorage = {
  read(key, { fallback = null, validate } = {}) {
    const storage = resolveStorage();
    const fullKey = namespacedKey(key);
    if (!storage || !fullKey) return fallback;

    let raw;
    try {
      raw = storage.getItem(fullKey);
    } catch {
      return fallback;
    }
    if (raw === null) return fallback;

    const value = safeJsonParse(raw, { fallback: undefined, maxLength: 100_000 });
    if (value === undefined) return fallback;
    if (typeof validate === 'function' && !validate(value)) return fallback;
    return value;
  },

  write(key, value) {
    const storage = resolveStorage();
    const fullKey = namespacedKey(key);
    if (!storage || !fullKey) return false;
    try {
      storage.setItem(fullKey, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    const storage = resolveStorage();
    const fullKey = namespacedKey(key);
    if (!storage || !fullKey) return false;
    try {
      storage.removeItem(fullKey);
      return true;
    } catch {
      return false;
    }
  },
};
