import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The media studio page: served from this folder with its own dependencies,
// reading the app's parts and data through @lumen. HMR is off so an edit can
// never reload a page in the middle of a long render; render.mjs listens on
// 5199 for the passes the page posts to /__upload.
const studio = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('../../../', import.meta.url));

export default {
  root: studio,
  resolve: { alias: { '@lumen': join(project, 'src') } },
  server: {
    host: '127.0.0.1',
    port: 5196,
    strictPort: true,
    hmr: false,
    fs: { allow: [studio, project] },
    proxy: { '/__upload': { target: 'http://127.0.0.1:5199', changeOrigin: true } },
  },
  optimizeDeps: { include: ['three', 'three-gpu-pathtracer', 'three-mesh-bvh'] },
};
