# server/

Lumen Cloud HTTP API. Node only, no dependencies: `node:http`, `node:fs`, `node:path`,
`node:crypto`.

| File | Role |
| ---- | ---- |
| `app.js` | Request handler `(req, res)`: routes, 64 KB JSON bodies, signed sessions, session-bound library resolution and guest claim, Studio AI concierge and escalation gatekeeper, security headers |
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

Studio AI: `POST /api/concierge/ask` runs `evaluateConciergeQuery` from
`src/lib/concierge-engine.js`, the same engine the browser falls back to offline.
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

Libraries: without a session a request reads and writes its `X-Lumen-Client` namespace. With
`Authorization: Bearer <token>` the verified address selects `acct-<sha256 prefix>`, and any
records left in the caller's `X-Lumen-Client` namespace are claimed into it atomically (on
`POST /api/auth/session` and on every authenticated call). Client ids starting with `acct-`
are refused; an unverifiable Bearer token answers `401`.

`server/.data/` is git-ignored. Run one process per data file: `npm run dev` uses
`lumen-cloud.json`, the Playwright preview `lumen-cloud.test.json`, so both can run at once.
