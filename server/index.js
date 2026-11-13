import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLumenCloud, resolveListenAddress } from './config.js';
import { createLumenServer } from './http-server.js';

const ROOT_URL = new URL('..', import.meta.url);
// HOST=0.0.0.0 in the container image; PORT=0 asks the OS for a free port and the bound one is logged below.
const { host: HOST, port: PORT } = resolveListenAddress(process.env);

const cloud = createLumenCloud(ROOT_URL);
const { server, serveStatic, shutdown } = createLumenServer({ cloud, staticDir: cloud.staticDir });

server.listen(PORT, HOST, () => {
  const { address, family, port } = server.address();
  const host = family === 'IPv6' ? `[${address}]` : address;
  const app = serveStatic ? relative(fileURLToPath(ROOT_URL), serveStatic.root) || '.' : 'off';
  const storage = cloud.file ? cloud.file : 'memory';
  const hops = cloud.handler.trustHops;
  const proxy = hops > 0 ? `${hops} trusted proxy hop${hops === 1 ? '' : 's'}` : 'direct clients';
  console.log(`Lumen Cloud v${cloud.version} on http://${host}:${port} (api: /api, app: ${app}, store: ${storage}, ${proxy}, Lumen AI: ${cloud.agent.provider})`);
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
