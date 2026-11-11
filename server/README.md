# server/

Lumen Cloud HTTP API. Node only, no dependencies: `node:http`, `node:fs`, `node:path`,
`node:crypto`.

| File | Role |
| ---- | ---- |
| `app.js` | Request handler `(req, res)`: routes, 64 KB JSON bodies, signed sessions, security headers |
| `store.js` | State per `X-Lumen-Client` namespace, serialized transactions, atomic temp-file + rename writes |
| `config.js` | Environment, data file path, one store and handler per process |
| `index.js` | Standalone server for `npm run server` |

The same handler runs in three places:

- `npm run dev` and `npm run preview`: mounted on `/api` by the `lumen:cloud-api` plugin
  in `vite.config.js`, same origin as the app, so `connect-src 'self'` covers it.
- `npm run server`: standalone on `http://127.0.0.1:8787/api`.

Validation is not duplicated here. The handler imports the browser's own rules from
`src/lib/` (`cloud-records`, `wall-studio`, `room-3d`, `quote`, `bag`,
`project-library`, `auth`) and `src/security/sanitize.js`.

Environment:

| Variable | Effect |
| -------- | ------ |
| `HOST`, `PORT` | Standalone bind address, default `127.0.0.1:8787` |
| `LUMEN_DATA_FILE` | Store path relative to the repository root, default `server/.data/lumen-cloud.json` |
| `LUMEN_STORAGE=memory` | Keep state in memory only |
| `LUMEN_SESSION_SECRET` | 32+ characters; otherwise each process signs with a random key |
| `LUMEN_TEST_RESET=1` | Expose `POST /api/test/reset` (the Playwright web server sets it) |

`server/.data/` is git-ignored. Run one process per data file.
