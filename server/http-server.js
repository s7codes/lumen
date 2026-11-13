import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { isApiPath } from './app.js';
import { createStaticHandler } from './static.js';

/** Longest a draining server waits for open connections (an SSE stream, a slow upload) before cutting them. */
export const SHUTDOWN_GRACE_MS = 10_000;

/**
 * The production HTTP server: Lumen Cloud on /api and, when `staticDir` holds
 * a build, the app itself on every other path, so the strict
 * `connect-src 'self'` CSP covers the API on one origin.
 *
 * `shutdown()` drains instead of dropping: it stops accepting connections,
 * closes idle keep-alive sockets, marks every response still in flight
 * `Connection: close`, waits for those to finish (at most `graceMs`, then cuts
 * them), and finally awaits the store's queued writes. A second call stops
 * waiting for slow clients but still flushes the store.
 */
export function createLumenServer({ cloud, staticDir = null, logger = console }) {
  const serveStatic = staticDir && existsSync(join(staticDir, 'index.html')) ? createStaticHandler({ root: staticDir }) : null;
  const inFlight = new Set();
  let closing = null;

  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, (req, res) => {
    inFlight.add(res);
    res.on('close', () => inFlight.delete(res));
    if (closing) res.setHeader('Connection', 'close');
    if (serveStatic && !isApiPath(req.url)) {
      serveStatic(req, res);
      return;
    }
    // Without a build every path reaches the API, which answers 404 off /api.
    cloud.handler(req, res);
  });

  function shutdown({ reason = 'shutdown', graceMs = SHUTDOWN_GRACE_MS } = {}) {
    if (closing) {
      server.closeAllConnections();
      return closing;
    }
    // close() releases the listening socket synchronously: from here a connect is refused by the OS.
    const closed = new Promise((resolve) => {
      server.close(() => resolve());
    });
    server.closeIdleConnections();
    for (const res of inFlight) {
      if (!res.headersSent) res.setHeader('Connection', 'close');
    }
    logger.log(`[lumen-cloud] ${reason}: draining ${inFlight.size} open request(s), refusing new connections`);
    const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
    deadline.unref();
    closing = closed
      .then(() => {
        clearTimeout(deadline);
        return cloud.store?.flush?.();
      })
      .then(() => {
        logger.log('[lumen-cloud] drained; every write is on disk');
      });
    return closing;
  }

  return { server, serveStatic, shutdown };
}
