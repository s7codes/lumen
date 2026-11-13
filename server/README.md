# server/

Lumen Cloud HTTP API. Node only, no dependencies: `node:http`, `node:fs`, `node:path`,
`node:crypto`, and the global `fetch` for an optional LLM provider.

| File | Role |
| ---- | ---- |
| `app.js` | Request handler `(req, res)`: routes, 64 KB JSON bodies, signed sessions, session-bound library resolution and guest claim, Studio AI concierge, SSE stream and escalation gatekeeper, `POST /api/mcp`, security headers |
| `llm-agent.js` | Lumen AI agent: `.env` loading, provider choice, streaming LLM tool-use loop over the MCP tools (Claude Messages API, OpenAI-compatible, Gemini, Ollama), deterministic MCP orchestrator fallback |
| `store.js` | Projects, quotes and engineering tickets per `X-Lumen-Client` or `acct-` account namespace, serialized transactions, atomic two-namespace claims, atomic temp-file + rename writes |
| `config.js` | Environment, data file path (dev or test store), one store and handler per process |
| `index.js` | Standalone server for `npm run server` |

The same handler runs in three places:

- `npm run dev` and `npm run preview`: mounted on `/api` by the `lumen:cloud-api` plugin
  in `vite.config.js`, same origin as the app, so `connect-src 'self'` covers it.
- `npm run server`: standalone on `http://127.0.0.1:8787/api`.

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
`400`, and a browser call from another origin `403`.
`POST /api/concierge/escalate` is the support gatekeeper: it replays every transcript
turn through that engine and issues an `LMN-T-` ticket only for a turn the engine itself
answers as unresolved, or a resolved answer the visitor marked as not resolving the
issue; anything else is `400 gatekeeper_locked`. `GET /api/tickets` lists the library's
tickets (12 at most). Stores written before v6 carry no tickets array and read as empty.

Environment:

| Variable | Effect |
| -------- | ------ |
| `HOST`, `PORT` | Standalone bind address, default `127.0.0.1:8787` |
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
