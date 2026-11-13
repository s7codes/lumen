# server/

Lumen Cloud HTTP API. Node only, no dependencies: `node:http`, `node:fs`, `node:path`,
`node:crypto`, and the global `fetch` for an optional LLM provider.

| File | Role |
| ---- | ---- |
| `app.js` | Request handler `(req, res)`: routes, per-route rate-limit tiers, 64 KB JSON bodies, Brotli or gzip JSON over 1 KB, signed sessions, session-bound library resolution and guest claim, Studio AI concierge, SSE stream and escalation gatekeeper, `POST /api/mcp`, security headers |
| `rate-limit.js` | Memory-bounded GCRA rate limiter (one timestamp per bucket, idle sweep, LRU eviction at `maxEntries`), client address resolution with trusted proxy hops, IPv6 keyed by /64 |
| `compress.js` | `Accept-Encoding` negotiation with q-values, synchronous JSON compression, threadpool compression for static files |
| `static.js` | Build server for production: immutable `/assets/*`, `no-cache` shell and SPA fallback with strong ETags and `304`, precompressed text, traversal-proof path resolution |
| `http-server.js` | Production composition (API on `/api`, the build everywhere else) and graceful shutdown |
| `llm-agent.js` | Lumen AI agent: `.env` loading, provider choice, streaming LLM tool-use loop over the MCP tools (Claude Messages API, OpenAI-compatible, Gemini, Ollama), deterministic MCP orchestrator fallback |
| `store.js` | Projects, quotes and engineering tickets per `X-Lumen-Client` or `acct-` account namespace, FIFO mutex with a bounded write queue, atomic two-namespace claims, atomic temp-file + rename writes |
| `config.js` | Environment, data file path (dev or test store), static directory, one store and handler per process |
| `index.js` | Standalone server for `npm run server`: listen, precompress the build, drain on `SIGTERM`, `SIGINT` or an IPC `shutdown` message |

The same handler runs in three places:

- `npm run dev` and `npm run preview`: mounted on `/api` by the `lumen:cloud-api` plugin
  in `vite.config.js`, same origin as the app, so `connect-src 'self'` covers it.
- `npm run server`: standalone on `http://127.0.0.1:8787`, the API on `/api` and the
  production build from `dist/` on every other path (`LUMEN_STATIC_DIR=off` serves the
  API only).

Validation is not duplicated here. The handler imports the browser's own rules from
`src/lib/` (`cloud-records`, `wall-studio`, `room-3d`, `quote`, `bag`,
`project-library`, `auth`, `concierge-engine`) and `src/security/sanitize.js`.

Studio AI: `POST /api/concierge/ask` asks the Lumen AI agent, which answers through the
MCP pipeline: an LLM tool-use loop when a provider is configured, otherwise the
deterministic orchestrator in `src/lib/mcp-orchestrator.js`, the same code the browser
falls back to offline. Replies carry `toolCalls` and `clientActions`.
`POST /api/concierge/stream` returns the same answer as Server-Sent Events (`tool_call`,
`tool_result`, `delta`, `complete`): the handler writes its own headers and frames, and
`createApp` sends nothing after it. `POST /api/mcp` is the Model Context Protocol
endpoint (JSON-RPC 2.0, one message per request, revision `2025-06-18`) over
`src/lib/mcp-server.js`; notifications answer `202`, unparseable or non-JSON-RPC input
`400` (a batch of any size or a message nested deeper than 12 levels is `-32600`), a
fault inside a tool `-32603` rather than an HTTP `500`, and a browser call from another
origin `403`.
`POST /api/concierge/escalate` is the support gatekeeper: it replays every transcript
turn through that engine and issues an `LMN-T-` ticket only for a turn the engine itself
answers as unresolved, or a resolved answer the visitor marked as not resolving the
issue; anything else is `400 gatekeeper_locked`. `GET /api/tickets` lists the library's
tickets (12 at most). Stores written before v6 carry no tickets array and read as empty.

Environment:

| Variable | Effect |
| -------- | ------ |
| `HOST`, `PORT` | Standalone bind address, default `127.0.0.1:8787`; `PORT=0` takes a free port and logs it |
| `LUMEN_TRUST_PROXY` | Reverse-proxy hops in front of the server: `1` behind Caddy or Nginx, `2` behind a CDN and a proxy, unset or `0` when clients connect directly |
| `LUMEN_RATE_LIMIT_MAX` | Read budget per client per minute, default `600`; auth, AI and write budgets scale with it; `off` disables the limiter |
| `LUMEN_STATIC_DIR` | Build the standalone server serves beside `/api`, default `dist`; `off` serves the API only |
| `LUMEN_DATA_FILE` | Store path relative to the repository root, default `server/.data/lumen-cloud.json`, or `server/.data/lumen-cloud.test.json` with `LUMEN_TEST_RESET=1` |
| `LUMEN_STORAGE=memory` | Keep state in memory only |
| `LUMEN_SESSION_SECRET` | 32+ characters; otherwise each process signs with a random key |
| `LUMEN_TEST_RESET=1` | Expose `POST /api/test/reset` and default to the test store (the Playwright web server sets it, with an explicit `LUMEN_DATA_FILE`) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Lumen AI provider key; the first one set wins under `LUMEN_LLM_PROVIDER=auto` |
| `LUMEN_LLM_BASE_URL` | Ollama or another OpenAI-compatible server, no key needed |
| `LUMEN_LLM_MODEL` | Model id override |
| `LUMEN_LLM_PROVIDER` | `auto` (default), `deterministic`, `anthropic`, `openai`, `gemini` or `ollama`; the Playwright web server pins `deterministic` |

The LLM variables are read from the process environment first, then from an optional
`.env` in the repository root (git-ignored; only these keys are read).

Libraries: without a session a request reads and writes its `X-Lumen-Client` namespace. With
`Authorization: Bearer <token>` the verified address selects `acct-<sha256 prefix>`, and any
records left in the caller's `X-Lumen-Client` namespace are claimed into it atomically (on
`POST /api/auth/session` and on every authenticated call). Client ids starting with `acct-`
are refused; an unverifiable Bearer token answers `401`.

`server/.data/` is git-ignored. Run one process per data file: `npm run dev` uses
`lumen-cloud.json`, the Playwright preview `lumen-cloud.test.json`, so both can run at once.

## Rate limiting

Every `/api` request except `GET /api/health` spends one unit from a per-client budget
before its body is read or any handler runs:

| Tier | Routes | Default per minute |
| ---- | ------ | ------------------ |
| `auth` | `POST` and `DELETE /api/auth/session` | 20 |
| `ai` | `POST /api/concierge/ask`, `/api/concierge/stream`, `/api/mcp` | 30 |
| `write` | every other non-GET route: projects, quotes, sync, escalation | 120 |
| `read` | every GET, including unknown paths | 600 |

The limiter is GCRA: a token bucket stored as one timestamp per client and tier. A fresh
client may spend its whole budget at once, then one request every `60 s / limit`; a
denied request spends nothing, so a flood never pushes its own wait further out. Answers
carry `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (epoch seconds
at which the bucket is full again); an empty bucket answers `429` with `Retry-After` and
`{ error: { code: 'RATE_LIMITED', message, retryAfterSec } }`. The bucket table holds at
most 4096 entries: refilled buckets are swept first, then the least recently used one is
evicted, so 5,000 spoofed addresses cost the same memory as 4096.

Clients are keyed by IPv4 address or IPv6 /64. A caller on loopback (`npm run dev`,
`vite preview` under parallel Playwright workers, a probe on the host) gets 50 times the
default budgets. `createApp({ rateLimit })` takes `false`, or an explicit
`{ tiers, maxEntries, loopbackScale, now }` policy, which grants loopback no headroom
unless `loopbackScale` asks for it.

Client addresses: without `LUMEN_TRUST_PROXY` the socket peer is the client and
`X-Forwarded-For` is ignored, so a direct caller cannot pick its own bucket. With it,
`X-Forwarded-For` is read from the right, one entry per trusted hop: Caddy and Nginx
append the address they saw, so a client that prepends a fake address changes nothing.
`X-Real-IP` is the fallback when no `X-Forwarded-For` arrives, and forwarding headers are
honoured only when the peer itself is on loopback or a private network. A proxy on the
host that forwards addresses while `LUMEN_TRUST_PROXY` is unset is logged once.

## Production

`npm run build && LUMEN_TRUST_PROXY=1 LUMEN_SESSION_SECRET=... npm run server` behind
Caddy or Nginx serves the whole platform from one process and one origin:

- Hashed bundles under `/assets/*`: `Cache-Control: public, max-age=31536000, immutable`.
  `index.html`, the SPA fallback (any extensionless path) and the unhashed root files:
  `no-cache` with a strong ETag (SHA-256 of the bytes, one per coding) and `304` on an
  `If-None-Match` hit. A missing asset is a plain `404`, never the HTML shell.
- Text over 1 KB goes out as Brotli or gzip by `Accept-Encoding` q-values, with
  `Vary: Accept-Encoding`. Static files are compressed once on the libuv threadpool
  (Brotli 11, gzip 9) and precompressed in the background after start; API JSON is
  compressed per response (Brotli 5, gzip 6). The SSE stream is never compressed and
  sends `Cache-Control: no-cache, no-store, no-transform` and `X-Accel-Buffering: no`, so
  Caddy and Nginx flush every frame.
- Paths over 1 KB or 16 segments are refused before any decoding work. The rest are
  decoded once; dot segments, dotfiles, backslashes, colons and NUL are refused, and the
  resolved file must sit inside the build.
- `SIGTERM`, `SIGINT` or an IPC `shutdown` message (PM2 on Windows) stops accepting
  connections, closes idle keep-alive sockets, marks responses still in flight
  `Connection: close`, waits for them (at most 10 s, then cuts them), awaits the store's
  queued writes and exits `0`. A second signal stops waiting for slow clients.

Store writes run through one FIFO mutex: each transaction reads the snapshot its
predecessor committed, so 50 concurrent saves never lose an update or overrun the 12
project, 24 quote and 12 ticket caps. At most 256 writes may wait; past that a write is
refused at once with `503 busy` and `Retry-After: 1`. When the 512-namespace cap is
reached, browser-profile libraries are evicted before signed-in account libraries.
