// Shoots the cinema stage (scripts/media/cinema) frame by frame: the Meet our
// Icons films and the 3D Spatial Studio showcase acts. A Vite server serves
// the stage, Chromium renders it on the GPU at device scale 1 (every frame
// is already supersampled by the accumulation renderer) and each frame goes
// to a lossless FFV1 master in .work/cinema, tagged BT.709.
//
//   node cinema.mjs still <film> <seconds> [samples]   one PNG for review
//   node cinema.mjs film <film[,film...]> [samples]    the masters
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work', 'cinema');
const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('@playwright/test');
const { createServer } = await import('vite');
const FF = process.env.FFMPEG ?? 'ffmpeg';
const ANGLE = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl');
mkdirSync(WORK, { recursive: true });

const [mode = 'still', which = 'icon-monolith', arg3, arg4] = process.argv.slice(2);

const server = await createServer({
  configFile: false,
  root: ROOT,
  logLevel: 'warn',
  // No HMR and no watcher: an edit while a film is being shot must never reload the stage mid-film.
  server: { host: '127.0.0.1', port: 5199, strictPort: false, hmr: false, watch: { ignored: ['**'] } },
  optimizeDeps: { entries: ['scripts/media/cinema/index.html'], include: ['three'] },
});
await server.listen();
const origin = server.resolvedUrls?.local?.[0]?.replace(/\/$/, '') ?? 'http://127.0.0.1:5199';

const browser = await chromium.launch({ args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 400));
});
await page.goto(`${origin}/scripts/media/cinema/index.html`);
await page.waitForFunction(() => window.cinemaReady === true, null, { timeout: 120000 });

async function load(id) {
  const info = await page.evaluate((film) => window.cinema.load(film), id);
  await page.setViewportSize({ width: info.width, height: info.height });
  return info;
}

async function shoot(info, t, samples, extra = {}) {
  await page.evaluate(([time, n, more]) => window.cinema.render(time, { ...(n ? { samples: n } : {}), ...more }), [t, samples, extra]);
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: info.width, height: info.height }, animations: 'disabled', caret: 'hide' });
}

try {
  if (mode === 'still') {
    const info = await load(which);
    const t = Number(arg3 ?? 0);
    const samples = arg4 ? Number(arg4) : undefined;
    const extra = process.env.DENSITY ? { density: Number(process.env.DENSITY) } : {};
    const t0 = Date.now();
    const png = await shoot(info, t, samples, extra);
    const out = join(WORK, `${which}-${t.toFixed(2)}.png`);
    writeFileSync(out, png);
    console.log(`still ${which} t=${t} -> ${out} in ${Date.now() - t0} ms`);
  } else {
    const samples = arg3 ? Number(arg3) : undefined;
    for (const id of which.split(',')) {
      const info = await load(id);
      const frames = Math.round(info.seconds * info.fps);
      const file = join(WORK, `${id}.mkv`);
      const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(info.fps), '-i', '-', '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv444p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', file], { stdio: ['pipe', 'inherit', 'inherit'] });
      const t0 = Date.now();
      for (let i = 0; i < frames; i += 1) {
        // Frame 0 is the poster: shot with the shutter closed, so the still is crisp.
        const png = await shoot(info, i / info.fps, samples, i === 0 ? { shutter: 0 } : {});
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % 60 === 0) console.log(`${id} ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      await new Promise((resolve) => {
        ff.on('close', resolve);
        ff.stdin.end();
      });
      console.log(`filmed ${id} (${frames} frames) -> ${file} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
} finally {
  await browser.close();
  await server.close();
}
