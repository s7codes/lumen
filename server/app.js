import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GUEST_NAME, sanitizeEmail, validateCredentials } from '../src/lib/auth.js';
import { sanitizeBagItems } from '../src/lib/bag.js';
import {
  MAX_REVISION,
  MAX_STORED_PROJECTS,
  MAX_STORED_QUOTES,
  normalizeProjects,
  normalizeQuotes,
  sanitizeProjectData,
  sanitizeQuoteRecord,
  serializeProjectRecord,
} from '../src/lib/cloud-records.js';
import { isProjectId, PROJECT_KINDS, projectIdFor, sanitizeProjectName } from '../src/lib/project-library.js';
import { buildQuote, CURRENCY_CODES, resolvePromo, sanitizeProject, validateProject } from '../src/lib/quote.js';
import { isOneOf, safeJsonParse } from '../src/security/sanitize.js';
import { isNamespace } from './store.js';

export const MAX_BODY_BYTES = 64 * 1024;
export const CLIENT_HEADER = 'x-lumen-client';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const DRAIN_LIMIT_BYTES = 1024 * 1024;
const MAX_QUOTE_ITEMS = 64;
const MAX_SYNC_RECORDS = 64;
const MAX_REVOKED_SESSIONS = 10_000;
const SYNC_MODES = Object.freeze(['replace', 'merge']);
const MALFORMED = Symbol('malformed');
const JSON_CONTENT_TYPE = /^application\/json\s*(?:;\s*charset\s*=\s*"?utf-8"?\s*)?$/i;
const TOKEN_PATTERN = /^lmn1\.([A-Za-z0-9_-]{16,512})\.([A-Za-z0-9_-]{43})$/;
const BEARER_PATTERN = /^Bearer ([^\s]{1,700})$/;

const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
});

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const invalid = (message, extra) => new HttpError(400, 'invalid', message, extra);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isApiPath(url) {
  return typeof url === 'string' && (url === '/api' || url.startsWith('/api/') || url.startsWith('/api?'));
}

function send(res, status, payload, headers = {}) {
  if (payload === undefined) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end();
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

/* Request body: strict JSON, 64 KB, prototype keys stripped by safeJsonParse. */

function readJsonBody(req) {
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !JSON_CONTENT_TYPE.test(type.trim())) {
    return Promise.reject(new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json.'));
  }
  const declared = req.headers['content-length'];
  if (declared !== undefined && !/^\d{1,12}$/.test(declared)) {
    return Promise.reject(invalid('Content-Length is not a byte count.'));
  }
  let size = 0;
  // Past the cap the body is drained without buffering, so the 413 still
  // reaches a client that is mid-upload; a runaway upload is cut.
  const drain = (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES + DRAIN_LIMIT_BYTES) req.destroy();
  };
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) {
    req.on('data', drain);
    return Promise.reject(new HttpError(413, 'payload_too_large', `Request bodies are limited to ${MAX_BODY_BYTES / 1024} KB.`));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const collect = (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk);
        return;
      }
      chunks.length = 0;
      req.off('data', collect);
      req.on('data', drain);
      settle(reject, new HttpError(413, 'payload_too_large', `Request bodies are limited to ${MAX_BODY_BYTES / 1024} KB.`));
    };

    req.on('data', collect);
    req.on('error', () => settle(reject, invalid('The request body could not be read.')));
    req.on('end', () => {
      if (settled) return;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
      } catch {
        settle(reject, invalid('Request body is not valid UTF-8.'));
        return;
      }
      if (text.length === 0) {
        settle(reject, invalid('Request body is empty.'));
        return;
      }
      const body = safeJsonParse(text, { fallback: MALFORMED, maxLength: MAX_BODY_BYTES });
      if (body === MALFORMED) settle(reject, invalid('Request body is not valid JSON, or nests deeper than 32 levels.'));
      else if (!isRecord(body)) settle(reject, invalid('Request body must be a JSON object.'));
      else settle(resolve, body);
    });
  });
}

function requireNamespace(req) {
  const id = req.headers[CLIENT_HEADER];
  if (!isNamespace(id)) {
    throw invalid('Send an X-Lumen-Client header: 16 to 64 characters of A-Z, a-z, 0-9, - or _.');
  }
  return id;
}

/* Sessions: HMAC-SHA256 signed, stateless, revocable until expiry. */

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function createSessions(secret) {
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

function bearerToken(req) {
  const header = req.headers.authorization;
  const match = typeof header === 'string' ? BEARER_PATTERN.exec(header) : null;
  return match ? match[1] : null;
}

function sessionView(claims) {
  return { user: { name: GUEST_NAME, email: claims.sub }, expiresAt: new Date(claims.exp).toISOString() };
}

/* Handlers */

function publicQuote({ origin: _origin, ...quote }) {
  return quote;
}

function byNewest(field) {
  return (a, b) => b[field].localeCompare(a[field]);
}

function issueRef(taken) {
  for (;;) {
    const ref = `LMN-R-${randomBytes(4).toString('hex').toUpperCase()}`;
    if (!taken.has(ref)) return ref;
  }
}

function quoteItems(quote) {
  if (!Array.isArray(quote.items) || quote.items.length === 0) throw invalid('The quote has no valid lines.');
  if (quote.items.length > MAX_QUOTE_ITEMS) throw invalid(`A quote carries at most ${MAX_QUOTE_ITEMS} lines.`);
  const items = sanitizeBagItems(quote.items);
  if (items.length !== quote.items.length) {
    throw invalid('The quote references unknown products, unsupported finishes or invalid quantities.');
  }
  return items;
}

function createHandlers({ store, version, sessions }) {
  const projectsOf = (id) => store.read(id).projects;
  const quotesOf = (id) => store.read(id).quotes.map(publicQuote);

  return {
    health: () => [200, { ok: true, version, storage: 'server' }],

    async openSession(req) {
      const body = await readJsonBody(req);
      // The password is only length-checked; it is never stored, logged or echoed.
      const fields = validateCredentials({ email: body.email, password: body.password });
      if (Object.keys(fields).length > 0) throw invalid(fields.email ?? fields.password, { fields });
      const { token, claims } = sessions.issue(sanitizeEmail(body.email));
      return [201, { token, ...sessionView(claims) }];
    },

    readSession(req) {
      const claims = sessions.verify(bearerToken(req));
      if (!claims) throw new HttpError(401, 'unauthorized', 'Session token is missing, expired or revoked.');
      return [200, sessionView(claims)];
    },

    closeSession(req) {
      const claims = sessions.verify(bearerToken(req));
      if (claims) sessions.revoke(claims);
      return [204];
    },

    listProjects(req) {
      return [200, { projects: projectsOf(requireNamespace(req)) }];
    },

    async saveProject(req) {
      const id = requireNamespace(req);
      const body = await readJsonBody(req);
      const { kind } = body;
      if (!isOneOf(kind, PROJECT_KINDS)) throw invalid('Unknown project type. Send kind "wall" or "room".');
      if (body.name !== undefined && typeof body.name !== 'string') throw invalid('Project name must be text.');
      const data = sanitizeProjectData(kind, body.data);
      if (!data) throw invalid(`Project data is not a Lumen ${kind} envelope.`);
      // The shared sanitizer drops bad modules silently; the API refuses them instead.
      if (data.items.length !== body.data.items.length) {
        throw invalid('The layout references unknown modules, unsupported finishes or invalid positions.');
      }
      if (data.items.length === 0) throw invalid('Mount at least one module before saving.');
      const name = sanitizeProjectName(body.name, kind);
      const projectId = projectIdFor(kind, name);

      const { record, created } = await store.transact(id, (draft) => {
        const previous = draft.projects.find((project) => project.id === projectId);
        if (!previous && draft.projects.length >= MAX_STORED_PROJECTS) {
          throw new HttpError(
            409,
            'quota',
            `Lumen Cloud holds ${MAX_STORED_PROJECTS} projects. Delete one from your account to save a new name.`,
          );
        }
        const next = serializeProjectRecord({
          id: projectId,
          kind,
          name,
          revision: Math.min(MAX_REVISION, (previous?.revision ?? 0) + 1),
          savedAt: new Date().toISOString(),
          data,
        });
        draft.projects = [next, ...draft.projects.filter((project) => project.id !== projectId)].sort(byNewest('savedAt'));
        return { record: next, created: !previous };
      });
      return [created ? 201 : 200, { project: record, projects: projectsOf(id) }];
    },

    async deleteProject(req, projectId) {
      const id = requireNamespace(req);
      if (!isProjectId(projectId)) throw invalid('Unknown project.');
      if (projectsOf(id).some((project) => project.id === projectId)) {
        await store.transact(id, (draft) => {
          draft.projects = draft.projects.filter((project) => project.id !== projectId);
        });
      }
      return [200, { projects: projectsOf(id) }];
    },

    listQuotes(req) {
      return [200, { quotes: quotesOf(requireNamespace(req)) }];
    },

    async submitQuote(req) {
      const id = requireNamespace(req);
      const body = await readJsonBody(req);
      const { quote, project } = body;
      if (!isRecord(quote) || !isRecord(project)) throw invalid('Send { quote, project } objects.');

      const fields = sanitizeProject(project);
      const fieldErrors = validateProject(fields);
      if (Object.keys(fieldErrors).length > 0) {
        throw invalid('Project reference and client are required.', { fields: fieldErrors });
      }
      const items = quoteItems(quote);
      if (!isOneOf(quote.currency, CURRENCY_CODES)) throw invalid(`Currency must be one of ${CURRENCY_CODES.join(', ')}.`);
      let promo = null;
      if (quote.promo !== undefined && quote.promo !== null) {
        promo = resolvePromo(quote.promo);
        if (!promo) throw invalid('Unknown promo code.');
      }
      if (quote.includeDriver !== undefined && typeof quote.includeDriver !== 'boolean') {
        throw invalid('includeDriver must be true or false.');
      }

      // Totals are rebuilt from the catalog; the client's figure is only a cross-check.
      const built = buildQuote({ items, currencyCode: quote.currency, promo, includeDriver: quote.includeDriver !== false });
      if (quote.grossMinor !== undefined && quote.grossMinor !== built.totals.gross) {
        throw new HttpError(409, 'stale', 'Pricing changed since this sheet was built. Review the quote and submit again.');
      }

      const record = await store.transact(id, (draft) => {
        const next = sanitizeQuoteRecord({
          ref: issueRef(new Set(draft.quotes.map((entry) => entry.ref))),
          quoteId: built.quoteId,
          submittedAt: new Date().toISOString(),
          reference: fields.reference,
          preparedFor: fields.preparedFor,
          currency: built.currency.code,
          grossMinor: built.totals.gross,
          lines: built.lines.length,
          loadW: built.electrical.loadW,
          status: 'Pending review',
        });
        if (!next) throw invalid('The quote could not be encoded.');
        draft.quotes = [{ ...next, origin: 'api' }, ...draft.quotes].sort(byNewest('submittedAt')).slice(0, MAX_STORED_QUOTES);
        return next;
      });
      return [201, { quote: record, quotes: quotesOf(id) }];
    },

    /**
     * Reconciles a device library with the server. Projects replace (or, for
     * follow-up batches, merge into) the namespace library. Quotes only ever
     * merge: a requisition the API issued is never altered or removed by a
     * device, and device-only records are kept with origin "device".
     */
    async sync(req) {
      const id = requireNamespace(req);
      const body = await readJsonBody(req);
      const hasProjects = body.projects !== undefined;
      const hasQuotes = body.quotes !== undefined;
      if (!hasProjects && !hasQuotes) throw invalid('Send projects, quotes or both.');
      if (hasProjects && (!Array.isArray(body.projects) || body.projects.length > MAX_SYNC_RECORDS)) {
        throw invalid(`projects must be an array of at most ${MAX_SYNC_RECORDS} records.`);
      }
      if (hasQuotes && (!Array.isArray(body.quotes) || body.quotes.length > MAX_SYNC_RECORDS)) {
        throw invalid(`quotes must be an array of at most ${MAX_SYNC_RECORDS} records.`);
      }
      const mode = body.mode ?? 'replace';
      if (!isOneOf(mode, SYNC_MODES)) throw invalid('mode must be "replace" or "merge".');

      await store.transact(id, (draft) => {
        if (hasProjects) {
          const incoming = mode === 'replace' ? body.projects : [...body.projects, ...draft.projects];
          draft.projects = normalizeProjects(incoming).map(serializeProjectRecord);
        }
        if (hasQuotes) {
          const known = new Set(draft.quotes.map((quote) => quote.ref));
          const imported = normalizeQuotes(body.quotes)
            .filter((quote) => !known.has(quote.ref))
            .map((quote) => ({ ...quote, origin: 'device' }));
          draft.quotes = [...draft.quotes, ...imported].sort(byNewest('submittedAt')).slice(0, MAX_STORED_QUOTES);
        }
      });
      return [200, { projects: projectsOf(id), quotes: quotesOf(id) }];
    },

    async reset(req) {
      const removed = await store.remove(requireNamespace(req));
      return [200, { ok: true, reset: removed }];
    },
  };
}

function buildRoutes(handlers, testReset) {
  const routes = [
    { path: '/api/health', methods: { GET: handlers.health } },
    {
      path: '/api/auth/session',
      methods: { POST: handlers.openSession, GET: handlers.readSession, DELETE: handlers.closeSession },
    },
    {
      path: '/api/projects',
      methods: { GET: handlers.listProjects, POST: handlers.saveProject, PUT: handlers.saveProject },
    },
    { pattern: /^\/api\/projects\/([^/]{1,256})$/, methods: { DELETE: handlers.deleteProject } },
    { path: '/api/quotes', methods: { GET: handlers.listQuotes, POST: handlers.submitQuote } },
    { path: '/api/sync', methods: { POST: handlers.sync } },
  ];
  if (testReset) routes.push({ path: '/api/test/reset', methods: { POST: handlers.reset } });
  return routes;
}

function matchRoute(routes, pathname) {
  for (const route of routes) {
    if (route.path === pathname) return { route, params: [] };
    const match = route.pattern?.exec(pathname);
    if (match) {
      try {
        return { route, params: match.slice(1).map((value) => decodeURIComponent(value)) };
      } catch {
        throw invalid('The request path is not valid percent-encoding.');
      }
    }
  }
  return null;
}

function resolveSecret(secret) {
  if (secret) return Buffer.from(secret);
  const fromEnv = process.env.LUMEN_SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return Buffer.from(fromEnv);
  return randomBytes(32);
}

/**
 * Lumen Cloud request handler: `(req, res) => Promise<void>` for node:http,
 * Vite (dev and preview) or any connect-style host. Every response is JSON
 * with nosniff and no-store, including errors.
 */
export function createApp({ store, version, testReset = false, sessionSecret } = {}) {
  const sessions = createSessions(resolveSecret(sessionSecret));
  const routes = buildRoutes(createHandlers({ store, version, sessions }), testReset);

  return async function lumenCloud(req, res) {
    try {
      let pathname;
      try {
        pathname = new URL(req.url, 'http://lumen.invalid').pathname;
      } catch {
        throw invalid('The request URL is not valid.');
      }
      const matched = matchRoute(routes, pathname);
      if (!matched) throw new HttpError(404, 'not_found', 'No Lumen Cloud endpoint at this path.');
      const handler = matched.route.methods[req.method];
      if (!handler) {
        const allow = Object.keys(matched.route.methods).join(', ');
        throw new HttpError(405, 'method_not_allowed', `Use ${allow} on this endpoint.`, { allow });
      }
      const [status, payload] = await handler(req, ...matched.params);
      send(res, status, payload);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        const { allow, ...extra } = error.extra;
        const headers = allow ? { Allow: allow } : {};
        send(res, error.status, { error: { code: error.code, message: error.message, ...extra } }, headers);
        return;
      }
      if (error?.code === 'LUMEN_STORAGE') {
        send(res, 503, { error: { code: 'storage', message: 'Lumen Cloud could not persist the change. Nothing was saved.' } });
        return;
      }
      console.error('[lumen-cloud]', error);
      send(res, 500, { error: { code: 'internal', message: 'Lumen Cloud hit an unexpected fault.' } });
    }
  };
}
