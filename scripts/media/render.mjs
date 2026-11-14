// Drives the media studio: headless Chromium on the GPU renders each job's
// light passes; an upload server stores them as float RGB for the grade.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JOBS } from './jobs.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORK = join(ROOT, 'scripts', 'media', '.work');

const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('@playwright/test');
const OUT = `${WORK}/passes`;
// ANGLE backend for the GPU: Direct3D 11 on Windows, desktop GL elsewhere.
const ANGLE = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl');

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith('--'));
const sppScale = Number((args.find((a) => a.startsWith('--spp=')) ?? '--spp=1').slice(6));
const skipDone = args.includes('--skip-done');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const guidesOnly = args.includes('--guides');
const jobs = JOBS.filter((job) => !filter || new RegExp(filter).test(job.id));

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'POST' || url.pathname !== '/__upload') {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const shot = url.searchParams.get('shot');
    const pass = url.searchParams.get('pass');
    const dir = `${OUT}/${shot}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${pass}.f32`, Buffer.concat(chunks));
    writeFileSync(`${dir}/${pass}.json`, JSON.stringify({ w: Number(url.searchParams.get('w')), h: Number(url.searchParams.get('h')) }));
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
  });
});
// The studio's Vite proxies /__upload here (studio/vite.config.js).
const PORT = 5199;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({ args: [`--use-angle=${ANGLE}`, '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[studio]') || m.type() === 'error') console.log(t.slice(0, 240));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(process.env.STUDIO_URL ?? 'http://127.0.0.1:5196/');
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
for (const job of jobs) {
  if (skipDone && existsSync(`${OUT}/${job.id}/meta.json`)) continue;
  if (guidesOnly && existsSync(`${OUT}/${job.id}/aux-depth.f32`)) continue;
  const t0 = Date.now();
  const result = await page.evaluate((j) => window.studio.run(j), { ...job, sppScale, guidesOnly, only: only.length ? only : undefined });
  mkdirSync(`${OUT}/${job.id}`, { recursive: true });
  if (!guidesOnly) writeFileSync(`${OUT}/${job.id}/meta.json`, JSON.stringify({ job, ...result }, null, 2));
  console.log(`done ${job.id} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, result.results.map((r) => `${r.name}:${r.spp}@${r.ms}ms`).join(' '));
}
await browser.close();
server.close();
