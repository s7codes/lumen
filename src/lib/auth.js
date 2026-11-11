import { safeStorage, sanitizeText } from '../security/sanitize.js';

export const SESSION_STORAGE_KEY = 'lumen_session_v1';
export const SESSION_TOKEN_STORAGE_KEY = 'lumen_session_token_v1';
export const GUEST_NAME = 'Studio Guest';
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const SESSION_TOKEN_PATTERN = /^lmn1\.[A-Za-z0-9_-]{16,512}\.[A-Za-z0-9_-]{43}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Lower-cased address, or null when it is not a plausible email. */
export function sanitizeEmail(value) {
  const email = sanitizeText(value, { maxLength: EMAIL_MAX + 1 }).toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL_PATTERN.test(email) ? email : null;
}

export function sanitizeUser(value) {
  if (!isRecord(value)) return null;
  const email = sanitizeEmail(value.email);
  const name = sanitizeText(value.name, { maxLength: 64 });
  return email && name ? { name, email } : null;
}

/** Field errors for the sign-in form; an empty object means valid. Shared with the server. */
export function validateCredentials({ email, password }) {
  const errors = {};
  if (!sanitizeEmail(email)) errors.email = 'Enter an email address such as guest@lumen.com.';
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    errors.password = `Password needs at least ${PASSWORD_MIN} characters.`;
  } else if (password.length > PASSWORD_MAX) {
    errors.password = `Password is limited to ${PASSWORD_MAX} characters.`;
  }
  return errors;
}

/**
 * Device-only guest session, used when the Lumen Cloud API is unreachable.
 * It holds a display name and the sanitized address; the password is never stored.
 */
export function createSession(email) {
  const address = sanitizeEmail(email);
  return address ? { name: GUEST_NAME, email: address } : null;
}

export function loadSession() {
  return sanitizeUser(safeStorage.read(SESSION_STORAGE_KEY, { fallback: null, validate: isRecord }));
}

export function persistSession(user) {
  return user ? safeStorage.write(SESSION_STORAGE_KEY, user) : safeStorage.remove(SESSION_STORAGE_KEY);
}

/** The signed server token is opaque to the browser: only its shape is checked here. */
export function sanitizeSessionToken(value) {
  return typeof value === 'string' && SESSION_TOKEN_PATTERN.test(value) ? value : null;
}

export function loadSessionToken() {
  return safeStorage.read(SESSION_TOKEN_STORAGE_KEY, { fallback: null, validate: (value) => sanitizeSessionToken(value) !== null });
}

export function persistSessionToken(token) {
  const clean = sanitizeSessionToken(token);
  return clean ? safeStorage.write(SESSION_TOKEN_STORAGE_KEY, clean) : safeStorage.remove(SESSION_TOKEN_STORAGE_KEY);
}
