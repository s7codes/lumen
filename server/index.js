import { createServer } from 'node:http';
import { createLumenCloud } from './config.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || 8787;

const cloud = createLumenCloud(new URL('..', import.meta.url));
const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, cloud.handler);

server.listen(PORT, HOST, () => {
  const storage = cloud.file ? cloud.file : 'memory';
  console.log(`Lumen Cloud API v${cloud.version} on http://${HOST}:${PORT}/api (store: ${storage})`);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => {
    cloud.store.flush().finally(() => process.exit(0));
  });
  server.closeIdleConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
