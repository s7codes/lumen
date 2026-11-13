import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLumenCloud } from './config.js';
import { createLumenServer } from './http-server.js';

const ROOT_URL = new URL('..', import.meta.url);
const HOST = process.env.HOST || '127.0.0.1';
// PORT=0 asks the OS for a free port; the bound one is logged below.
const PORT = /^\d{1,5}$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : 8787;

const cloud = createLumenCloud(ROOT_URL);
const { server, serveStatic, shutdown } = createLumenServer({ cloud, staticDir: cloud.staticDir });

server.listen(PORT, HOST, () => {
  const { address, family, port } = server.address();
  const host = family === 'IPv6' ? `[${address}]` : address;
  const app = serveStatic ? relative(fileURLToPath(ROOT_URL), serveStatic.root) || '.' : 'off';
  const storage = cloud.file ? cloud.file : 'memory';
  console.log(`Lumen Cloud v${cloud.version} on http://${host}:${port} (api: /api, app: ${app}, store: ${storage}, Lumen AI: ${cloud.agent.provider})`);
  serveStatic?.warm().catch((error) => console.warn('[lumen-cloud] static precompression stopped:', error?.message ?? error));
});

function stop(reason) {
  shutdown({ reason }).then(
    () => process.exit(0),
    (error) => {
      console.error('[lumen-cloud] shutdown failed', error);
      process.exit(1);
    },
  );
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
// Windows has no SIGTERM: PM2 and similar supervisors send "shutdown" over the IPC channel instead.
process.on('message', (message) => {
  if (message === 'shutdown') stop('shutdown message');
});
