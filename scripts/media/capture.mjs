// Films the showcase acts from the planner's own WebGL canvas: Chromium on
// the GPU with reduced motion (every rig snaps), one frame per 1/60 s of
// film time, captured at 2x and scaled down into a lossless intermediate.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work');
const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('@playwright/test');
const FF = process.env.FFMPEG ?? 'ffmpeg';
const OUT = `${WORK}/films`;
mkdirSync(OUT, { recursive: true });
// ANGLE backend for the GPU: Direct3D 11 on Windows, desktop GL elsewhere.
const ANGLE = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl');
const { FILM_SECONDS, FILM_FPS, FILM_FILES } = await import(new URL('../../src/lib/showcase-film.js', import.meta.url));

const acts = (process.argv[2] ?? 'orbit,inside,gizmo,isolux').split(',');
const limit = Number(process.argv[3] ?? 0);
const browser = await chromium.launch({ args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 200)); });
await page.goto(`${process.env.CAPTURE_URL ?? 'http://127.0.0.1:5173'}/scripts/media/capture/index.html`);
await page.waitForFunction(() => window.capture?.ready(), null, { timeout: 120000 });
for (const act of acts) {
  const frames = limit || Math.round(FILM_SECONDS[act] * FILM_FPS);
  const file = `${OUT}/${FILM_FILES[act]}.mkv`;
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(FILM_FPS), '-i', '-', '-vf', 'scale=1440:960:flags=lanczos+accurate_rnd:out_color_matrix=bt709:out_range=tv', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv444p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  // Warm the stage on the first pose so shaders and the environment are compiled.
  await page.evaluate(([a]) => window.capture.set(a, 0), [act]);
  await page.waitForTimeout(1500);
  for (let i = 0; i < frames; i += 1) {
    await page.evaluate(([a, t]) => window.capture.set(a, t), [act, i / FILM_FPS]);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: 960 }, animations: 'disabled', caret: 'hide' });
    if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 60 === 0) console.log(`${act} ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await new Promise((resolve) => { ff.on('close', resolve); ff.stdin.end(); });
  console.log(`filmed ${act} -> ${file} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
