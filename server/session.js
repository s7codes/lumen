import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GUEST_NAME, sanitizeEmail } from '../src/lib/auth.js';
import { safeJsonParse } from '../src/security/sanitize.js';

/**
 * Lumen Cloud sessions: stateless HMAC-SHA256 tokens, `lmn1.<claims>.<mac>`,
 * revocable until they expire.
 *
 * A token travels only as `Authorization: Bearer`, never as a cookie. The
 * browser never attaches a header on its own, so a page on another site has
 * no session to ride (no CSRF surface), and the credential is the same on
 * Caddy's internal HTTP hop as it was over TLS: there is no Secure flag that
 * the app would have to infer from X-Forwarded-Proto. The API sets no cookies
 * at all.
 */

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MIN_SECRET_CHARS = 32;

const MAX_REVOKED_SESSIONS = 10_000;
const TOKEN_PATTERN = /^lmn1\.([A-Za-z0-9_-]{16,512})\.([A-Za-z0-9_-]{43})$/;
const BEARER_PATTERN = /^Bearer ([^\s]{1,700})$/;
const BEARER_SCHEME = /^Bearer\s/i;
// Template values (docker-compose.yml defaults to one) must never sign a token anyone could forge.
const PLACEHOLDER_SECRET = /change-?me/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** `{ issue(email), verify(token), revoke(claims) }` signing with `secret`. */
export function createSessions(secret) {
  const revoked = new Map();

  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');

  function prune(now) {
    for (const [jti, exp] of revoked) if (exp <= now) revoked.delete(jti);
    while (revoked.size > MAX_REVOKED_SESSIONS) revoked.delete(revoked.keys().next().value);
  }

  return {
    issue(email) {
      const iat = Date.now();
      const claims = { sub: email, name: GUEST_NAME, iat, exp: iat + SESSION_TTL_MS, jti: randomBytes(12).toString('base64url') };
      const payload = base64url(JSON.stringify(claims));
      return { token: `lmn1.${payload}.${sign(payload)}`, claims };
    },

    verify(token) {
      const match = typeof token === 'string' ? TOKEN_PATTERN.exec(token) : null;
      if (!match) return null;
      const [, payload, signature] = match;
      const expected = Buffer.from(sign(payload));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      const claims = safeJsonParse(Buffer.from(payload, 'base64url').toString('utf8'), { fallback: null, maxDepth: 2 });
      if (!isRecord(claims) || !sanitizeEmail(claims.sub) || typeof claims.jti !== 'string') return null;
      if (!Number.isSafeInteger(claims.exp) || claims.exp <= Date.now() || revoked.has(claims.jti)) return null;
      return claims;
    },

    revoke(claims) {
      prune(Date.now());
      revoked.set(claims.jti, claims.exp);
    },
  };
}

/**
 * The HMAC key: `secret` when given (the dev server pins one per process),
 * else LUMEN_SESSION_SECRET when it has 32 or more characters and is not a
 * template placeholder, else a random per-process key. A key that is set but
 * unusable is reported once, since every restart then signs visitors out.
 */
export function resolveSessionSecret(secret, env = process.env, logger = console) {
  if (secret) return Buffer.from(secret);
  const fromEnv = typeof env?.LUMEN_SESSION_SECRET === 'string' ? env.LUMEN_SESSION_SECRET : '';
  if (fromEnv.length >= MIN_SECRET_CHARS && !PLACEHOLDER_SECRET.test(fromEnv)) return Buffer.from(fromEnv);
  if (fromEnv !== '') {
    const reason = PLACEHOLDER_SECRET.test(fromEnv) ? 'is a template placeholder' : `has fewer than ${MIN_SECRET_CHARS} characters`;
    logger.warn(
      `[lumen-cloud] LUMEN_SESSION_SECRET ${reason}: sessions are signed with a per-process key and end on every restart. Generate one with: openssl rand -hex 32`,
    );
  }
  return randomBytes(32);
}

export function bearerToken(req) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
  return match ? match[1] : null;
}

/** Only the Bearer scheme selects a session; other schemes (a staging proxy's Basic auth) stay anonymous. */
export function presentsBearer(req) {
  const header = req.headers.authorization;
  return typeof header === 'string' && BEARER_SCHEME.test(header);
}

export function sessionView(claims) {
  return { user: { name: GUEST_NAME, email: claims.sub }, expiresAt: new Date(claims.exp).toISOString() };
}
