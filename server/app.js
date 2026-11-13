import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GUEST_NAME, sanitizeEmail, validateCredentials } from '../src/lib/auth.js';
import { sanitizeBagItems } from '../src/lib/bag.js';
import {
  MAX_REVISION,
  MAX_STORED_PROJECTS,
  MAX_STORED_QUOTES,
  MAX_STORED_TICKETS,
  normalizeProjects,
  normalizeQuotes,
  sanitizeProjectData,
  sanitizeQuoteRecord,
  sanitizeTicketRecord,
  serializeProjectRecord,
  TICKET_QUEUED,
} from '../src/lib/cloud-records.js';
import { validateConciergeAsk, validateEscalationRequest } from '../src/lib/concierge-engine.js';
import { handleMcpRequest, JSONRPC_ERRORS, MCP_PROTOCOL_VERSION } from '../src/lib/mcp-server.js';
import { isProjectId, PROJECT_KINDS, projectIdFor, sanitizeProjectName } from '../src/lib/project-library.js';
import { buildQuote, CURRENCY_CODES, resolvePromo, sanitizeProject, validateProject } from '../src/lib/quote.js';
import { isOneOf, safeJsonParse } from '../src/security/sanitize.js';
import { createConciergeAgent } from './llm-agent.js';
import { ACCOUNT_PREFIX, accountNamespace, isClientNamespace } from './store.js';

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
const BEARER_SCHEME = /^Bearer\s/i;
const NOTHING_CLAIMED = Object.freeze({ projects: 0, quotes: 0 });
// MCP revisions this endpoint speaks; a client that names another gets a 400.
const MCP_PROTOCOL_HEADERS = Object.freeze([MCP_PROTOCOL_VERSION, '2025-03-26']);

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

// A body that is not JSON at all: JSON-RPC answers it with a parse error, REST with a 400.
class MalformedJsonError extends HttpError {
  constructor() {
    super(400, 'invalid', 'Request body is not valid JSON, or nests deeper than 32 levels.');
  }
}

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
  return readJsonValue(req).then((body) => {
    if (!isRecord(body)) throw invalid('Request body must be a JSON object.');
    return body;
  });
}

function readJsonValue(req) {
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
      if (body === MALFORMED) settle(reject, new MalformedJsonError());
      else settle(resolve, body);
    });
  });
}

/**
 * DNS-rebinding guard for the MCP and streaming endpoints: a browser call
 * must come from this origin. Callers without an Origin header (curl, an
 * MCP client, server to server) are unaffected.
 */
function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin === undefined) return;
  let host = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (!host || host !== req.headers.host) {
    throw new HttpError(403, 'forbidden_origin', 'Cross-origin calls to this endpoint are refused.');
  }
}

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function requireNamespace(req) {
  const id = req.headers[CLIENT_HEADER];
  if (typeof id === 'string' && id.startsWith(ACCOUNT_PREFIX)) {
    throw invalid(`X-Lumen-Client ids starting with "${ACCOUNT_PREFIX}" are reserved for signed-in libraries.`);
  }
  if (!isClientNamespace(id)) {
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

// Only the Bearer scheme selects a session; other schemes (a staging proxy's Basic auth) stay anonymous.
function presentsBearer(req) {
  const header = req.headers.authorization;
  return typeof header === 'string' && BEARER_SCHEME.test(header);
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

/** Server-issued reference: `LMN-R-` requisitions, `LMN-T-` engineering tickets, 32 random bits each. */
function issueRef(prefix, taken) {
  for (;;) {
    const ref = `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;
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

/** Moves guest records keyed by `key` into the account list, up to `cap`; the rest stay with the guest. */
function mergeByRef(accountList, guestList, key, cap) {
  const merged = new Map(accountList.map((record) => [record[key], record]));
  const kept = [];
  let moved = 0;
  for (const record of guestList) {
    if (merged.has(record[key]) || merged.size < cap) {
      if (!merged.has(record[key])) merged.set(record[key], record);
      moved += 1;
    } else {
      kept.push(record);
    }
  }
  return { merged: [...merged.values()].sort(byNewest('submittedAt')), kept, moved };
}

/**
 * Moves a browser-profile library into an account library. Projects match by
 * id, quotes by requisition ref and tickets by ticket ref; on a project clash
 * the newer save wins and the revision never goes backwards. Records past the
 * library caps stay in the guest namespace rather than being dropped.
 */
function mergeLibraries(account, guest) {
  const projects = new Map(account.projects.map((project) => [project.id, project]));
  const keptProjects = [];
  let movedProjects = 0;
  for (const record of guest.projects) {
    const current = projects.get(record.id);
    if (current) {
      const newer = record.savedAt > current.savedAt ? record : current;
      projects.set(record.id, { ...newer, revision: Math.max(record.revision, current.revision) });
      movedProjects += 1;
    } else if (projects.size < MAX_STORED_PROJECTS) {
      projects.set(record.id, record);
      movedProjects += 1;
    } else {
      keptProjects.push(record);
    }
  }

  const quotes = mergeByRef(account.quotes, guest.quotes, 'ref', MAX_STORED_QUOTES);
  const tickets = mergeByRef(account.tickets, guest.tickets, 'ref', MAX_STORED_TICKETS);

  account.projects = [...projects.values()].sort(byNewest('savedAt'));
  account.quotes = quotes.merged;
  account.tickets = tickets.merged;
  guest.projects = keptProjects;
  guest.quotes = quotes.kept;
  guest.tickets = tickets.kept;
  return {
    changed: movedProjects + quotes.moved + tickets.moved > 0,
    projects: movedProjects,
    quotes: quotes.moved,
    tickets: tickets.moved,
  };
}

function createHandlers({ store, version, sessions, agent }) {
  const projectsOf = (id) => store.read(id).projects;
  const quotesOf = (id) => store.read(id).quotes.map(publicQuote);
  const ticketsOf = (id) => store.read(id).tickets;

  // The session response keeps its v3 shape ({ projects, quotes }); tickets move silently.
  async function claimGuest(guest, account) {
    const pending = store.read(guest);
    if (pending.projects.length === 0 && pending.quotes.length === 0 && pending.tickets.length === 0) {
      return NOTHING_CLAIMED;
    }
    const result = await store.claim(guest, account, mergeLibraries);
    return result ? { projects: result.projects, quotes: result.quotes } : NOTHING_CLAIMED;
  }

  /**
   * Library namespace for one request. A Bearer session resolves the account
   * library and first claims any records left in this browser profile's
   * namespace; without one, X-Lumen-Client is used exactly as in v2. A
   * presented but unverifiable session is refused, never silently downgraded.
   */
  async function libraryOf(req) {
    if (!presentsBearer(req)) return requireNamespace(req);
    const claims = sessions.verify(bearerToken(req));
    if (!claims) throw new HttpError(401, 'unauthorized', 'Session token is missing, expired or revoked.');
    const account = accountNamespace(claims.sub);
    if (req.headers[CLIENT_HEADER] !== undefined) await claimGuest(requireNamespace(req), account);
    return account;
  }

  return {
    health: () => [200, { ok: true, version, storage: 'server' }],

    async openSession(req) {
      const body = await readJsonBody(req);
      // The password is only length-checked; it is never stored, logged or echoed.
      const fields = validateCredentials({ email: body.email, password: body.password });
      if (Object.keys(fields).length > 0) throw invalid(fields.email ?? fields.password, { fields });
      const { token, claims } = sessions.issue(sanitizeEmail(body.email));
      const guest = req.headers[CLIENT_HEADER];
      let claimed = NOTHING_CLAIMED;
      if (isClientNamespace(guest)) {
        // A failed claim never blocks sign-in: the next authenticated call retries it.
        claimed = await claimGuest(guest, accountNamespace(claims.sub)).catch((error) => {
          if (error?.code !== 'LUMEN_STORAGE') throw error;
          return NOTHING_CLAIMED;
        });
      }
      return [201, { token, ...sessionView(claims), library: { scope: 'account', claimed } }];
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

    async listProjects(req) {
      return [200, { projects: projectsOf(await libraryOf(req)) }];
    },

    async saveProject(req) {
      const id = await libraryOf(req);
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
      const id = await libraryOf(req);
      if (!isProjectId(projectId)) throw invalid('Unknown project.');
      if (projectsOf(id).some((project) => project.id === projectId)) {
        await store.transact(id, (draft) => {
          draft.projects = draft.projects.filter((project) => project.id !== projectId);
        });
      }
      return [200, { projects: projectsOf(id) }];
    },

    async listQuotes(req) {
      return [200, { quotes: quotesOf(await libraryOf(req)) }];
    },

    async submitQuote(req) {
      const id = await libraryOf(req);
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
          ref: issueRef('LMN-R', new Set(draft.quotes.map((entry) => entry.ref))),
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
      const id = await libraryOf(req);
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

    /**
     * Stateless: the Lumen AI agent answers through the MCP pipeline (an LLM
     * when one is configured, else the deterministic orchestrator the browser
     * also falls back to offline). The reply carries toolCalls and clientActions.
     */
    async askConcierge(req) {
      const body = await readJsonBody(req);
      const { question, context, error } = validateConciergeAsk(body);
      if (error) throw invalid(error);
      return [200, { reply: await agent.ask(question, context) }];
    },

    /**
     * Same answer as /ask, streamed as Server-Sent Events: tool_call and
     * tool_result as each MCP tool runs, delta chunks of the answer text,
     * then complete with the full reply. Validation faults are plain JSON
     * errors, sent before the stream opens.
     */
    async streamConcierge(req, res) {
      requireSameOrigin(req);
      const body = await readJsonBody(req);
      const { question, context, error } = validateConciergeAsk(body);
      if (error) throw invalid(error);
      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      });
      const write = (event, data) => {
        if (!res.writableEnded && !res.destroyed) res.write(sseFrame(event, data));
      };
      res.write(': lumen-mcp-stream\n\n');
      try {
        const reply = await agent.ask(question, context, { onEvent: write, signal: controller.signal });
        write('complete', { reply });
      } catch (fault) {
        if (!controller.signal.aborted) {
          console.error('[lumen-cloud]', fault);
          write('error', { code: 'internal', message: 'Lumen AI could not finish this answer.' });
        }
      }
      res.end();
      return null;
    },

    /**
     * Model Context Protocol over HTTP (JSON-RPC 2.0, one message per POST).
     * Requests get 200 with the JSON-RPC response, notifications 202 with no
     * body; input the server cannot accept (not JSON, not one JSON-RPC
     * object, an unknown protocol revision) gets 400 with an id-less error.
     */
    async mcp(req) {
      requireSameOrigin(req);
      const revision = req.headers['mcp-protocol-version'];
      if (revision !== undefined && !MCP_PROTOCOL_HEADERS.includes(revision)) {
        return [400, { jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.invalidRequest, message: 'Unsupported MCP-Protocol-Version.' } }];
      }
      let message;
      try {
        message = await readJsonValue(req);
      } catch (error) {
        if (error instanceof MalformedJsonError) {
          return [400, { jsonrpc: '2.0', id: null, error: { code: JSONRPC_ERRORS.parse, message: 'Parse error: the body is not valid JSON.' } }];
        }
        throw error;
      }
      const response = handleMcpRequest(message, { version });
      if (response === null) return [202];
      const refused = response.error && (response.error.code === JSONRPC_ERRORS.invalidRequest || response.error.code === JSONRPC_ERRORS.parse);
      return [refused ? 400 : 200, response];
    },

    /**
     * Gatekeeper: a ticket is issued only when the transcript holds a turn the
     * engine itself replays as unresolved, or a resolved answer the visitor
     * marked as not resolving the issue. Anything else is gatekeeper_locked.
     */
    async escalate(req) {
      const id = await libraryOf(req);
      const body = await readJsonBody(req);
      const verdict = validateEscalationRequest(body);
      if (!verdict.ok) {
        throw new HttpError(400, verdict.code, verdict.message, verdict.fields ? { fields: verdict.fields } : {});
      }
      const ticket = await store.transact(id, (draft) => {
        const next = sanitizeTicketRecord({
          ...verdict.ticket,
          ref: issueRef('LMN-T', new Set(draft.tickets.map((entry) => entry.ref))),
          submittedAt: new Date().toISOString(),
          status: TICKET_QUEUED,
        });
        if (!next) throw invalid('The ticket could not be encoded.');
        draft.tickets = [next, ...draft.tickets].sort(byNewest('submittedAt')).slice(0, MAX_STORED_TICKETS);
        return next;
      });
      return [201, { ticket, tickets: ticketsOf(id) }];
    },

    async listTickets(req) {
      return [200, { tickets: ticketsOf(await libraryOf(req)) }];
    },

    async reset(req) {
      const removed = await store.remove(await libraryOf(req));
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
    { path: '/api/concierge/ask', methods: { POST: handlers.askConcierge } },
    { path: '/api/concierge/stream', methods: { POST: handlers.streamConcierge } },
    { path: '/api/mcp', methods: { POST: handlers.mcp } },
    { path: '/api/concierge/escalate', methods: { POST: handlers.escalate } },
    { path: '/api/tickets', methods: { GET: handlers.listTickets } },
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
 * with nosniff and no-store, including errors, except the Server-Sent Events
 * of POST /api/concierge/stream.
 */
export function createApp({ store, version, testReset = false, sessionSecret, agent = createConciergeAgent({ version }) } = {}) {
  const sessions = createSessions(resolveSecret(sessionSecret));
  const routes = buildRoutes(createHandlers({ store, version, sessions, agent }), testReset);

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
      const result = await handler(req, ...matched.params, res);
      // A streaming handler wrote its own headers and frames and ended the response.
      if (res.headersSent) return;
      const [status, payload] = result;
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
