import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createApp } from '../server/app.js';
import { createLumenServer } from '../server/http-server.js';
import { createConciergeAgent } from '../server/llm-agent.js';
import { IMMUTABLE_CACHE_CONTROL, parseRange, SHELL_CSP, SHELL_CSP_META } from '../server/static.js';
import { createStore } from '../server/store.js';
import { PRODUCTS } from '../src/data/products.js';
import { CATALOG_SIZE, HERO_SIZES, ICONS_SIZE, mediaFiles, ROOM_SIZE } from '../src/lib/media-manifest.js';
import { shouldPlay } from '../src/lib/viewport-video.js';
import { collectFailedResponses, collectRuntimeErrors, decodedWidth, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const REPO_DIR = fileURLToPath(new URL('../', import.meta.url));
const MEDIA_DIR = join(REPO_DIR, 'public', 'media');
const DIST_DIR = join(REPO_DIR, 'dist');
const SILENT = { log() {}, warn() {}, error() {} };
const AGENT = createConciergeAgent({ version: 'media', env: { LUMEN_LLM_PROVIDER: 'deterministic' }, logger: SILENT });

/** Width and height from a WebP's RIFF header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(buf) {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WEBP');
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  expect(chunk).toBe('VP8 ');
  return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
}

/** Top-level MP4 boxes in file order. */
function mp4Boxes(buf) {
  const boxes = [];
  for (let at = 0; at + 8 <= buf.length; ) {
    const size = buf.readUInt32BE(at);
    boxes.push(buf.toString('ascii', at + 4, at + 8));
    if (size < 8) break;
    at += size;
  }
  return boxes;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

function rawRequest(origin, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), { method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

test.describe('media library', () => {
  test('every promised photograph and film ships under public/media, sized and encoded for the web', () => {
    const promised = mediaFiles(PRODUCTS);
    // Two hero scenes (2 stills, 2 films), three rooms (still, 2 films), three
    // camera films for Meet our Icons (poster, 2 films) and every catalog
    // finish. The synthetic showcase films are gone with their folder.
    const finishes = PRODUCTS.reduce((sum, product) => sum + product.finishes.length, 0);
    expect(finishes).toBe(42);
    expect(promised).toHaveLength(8 + 9 + 9 + finishes);
    expect(promised.filter((path) => path.startsWith('showcase/'))).toEqual([]);
    expect(existsSync(join(MEDIA_DIR, 'showcase'))).toBe(false);
    const shipped = walk(MEDIA_DIR).map((file) => relative(MEDIA_DIR, file).split('\\').join('/'));
    // Nothing missing, nothing stray: the manifest is the whole library.
    expect([...shipped].sort()).toEqual([...promised].sort());

    let total = 0;
    for (const path of promised) {
      const file = join(MEDIA_DIR, path);
      const buf = readFileSync(file);
      total += buf.length;
      if (path.endsWith('.webp')) {
        const [w, h] = webpSize(buf);
        const expected = path.startsWith('hero/')
          ? path.endsWith('-2560.webp')
            ? HERO_SIZES.full
            : HERO_SIZES.half
          : path.startsWith('rooms/')
            ? ROOM_SIZE
            : path.startsWith('icons/')
              ? ICONS_SIZE
              : CATALOG_SIZE;
        expect([w, h], path).toEqual([expected.width, expected.height]);
        // Tack-sharp 2K, yet light: no still over 420 KB, and never a blank frame
        // (a smooth studio wall compresses hard, an empty 1600 px WebP to under 2 KB).
        expect(buf.length, path).toBeLessThan(420 * 1024);
        expect(buf.length, path).toBeGreaterThan(8 * 1024);
      } else if (path.endsWith('.webm')) {
        // EBML magic and the webm doctype.
        expect(buf.readUInt32BE(0), path).toBe(0x1a45dfa3);
        expect(buf.subarray(0, 64).includes(Buffer.from('webm')), path).toBe(true);
        expect(buf.length, path).toBeLessThan(4 * 1024 * 1024);
      } else if (path.endsWith('.mp4')) {
        const boxes = mp4Boxes(buf);
        expect(boxes[0], path).toBe('ftyp');
        // Fast start: the index precedes the media, so playback begins on the first bytes.
        expect(boxes.indexOf('moov'), path).toBeGreaterThan(-1);
        expect(boxes.indexOf('moov'), path).toBeLessThan(boxes.indexOf('mdat'));
        expect(buf.length, path).toBeLessThan(5 * 1024 * 1024);
      }
    }
    // The whole library stays lean enough for a fast clone and a fast image build.
    expect(total).toBeLessThan(60 * 1024 * 1024);
  });

  test('the production server streams media: exact types, byte ranges and a one-year immutable policy', async () => {
    expect(existsSync(join(DIST_DIR, 'media', 'hero', 'daylight.webm')), 'npm run build must copy public/media into dist').toBe(true);
    expect(existsSync(join(DIST_DIR, 'media', 'showcase')), 'a fresh build ships no showcase films').toBe(false);
    const store = createStore({ file: null });
    const handler = createApp({ store, version: 'media', agent: AGENT, env: {}, logger: SILENT });
    const { server, shutdown } = createLumenServer({ cloud: { handler, store }, staticDir: DIST_DIR, logger: SILENT });
    const origin = await listen(server);
    try {
      const filmPath = '/media/hero/daylight.webm';
      const film = readFileSync(join(DIST_DIR, filmPath));
      const full = await rawRequest(origin, `${filmPath}?v=9.2.0`);
      expect(full.status).toBe(200);
      expect(full.headers['content-type']).toBe('video/webm');
      expect(full.headers['accept-ranges']).toBe('bytes');
      expect(full.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(full.headers['content-encoding']).toBeUndefined();
      expect(Number(full.headers['content-length'])).toBe(film.length);
      expect(full.body.equals(film)).toBe(true);

      // A seek: the first kilobyte, a middle slice and the last 500 bytes.
      const head = await rawRequest(origin, filmPath, { headers: { Range: 'bytes=0-1023' } });
      expect(head.status).toBe(206);
      expect(head.headers['content-range']).toBe(`bytes 0-1023/${film.length}`);
      expect(head.headers['content-length']).toBe('1024');
      expect(head.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(head.body.equals(film.subarray(0, 1024))).toBe(true);
      const mid = Math.floor(film.length / 2);
      const middle = await rawRequest(origin, filmPath, { headers: { Range: `bytes=${mid}-` } });
      expect(middle.status).toBe(206);
      expect(middle.body.equals(film.subarray(mid))).toBe(true);
      const tail = await rawRequest(origin, filmPath, { headers: { Range: 'bytes=-500' } });
      expect(tail.headers['content-range']).toBe(`bytes ${film.length - 500}-${film.length - 1}/${film.length}`);
      expect(tail.body.equals(film.subarray(film.length - 500))).toBe(true);
      // Past the end is 416 with the size; an If-Range for another version gets the whole film.
      const past = await rawRequest(origin, filmPath, { headers: { Range: `bytes=${film.length}-` } });
      expect(past.status).toBe(416);
      expect(past.headers['content-range']).toBe(`bytes */${film.length}`);
      const stale = await rawRequest(origin, filmPath, { headers: { Range: 'bytes=0-9', 'If-Range': '"stale"' } });
      expect(stale.status).toBe(200);
      expect(stale.body.length).toBe(film.length);
      const fresh = await rawRequest(origin, filmPath, { headers: { Range: 'bytes=0-9', 'If-Range': full.headers.etag } });
      expect(fresh.status).toBe(206);
      expect(fresh.body.length).toBe(10);
      const probe = await rawRequest(origin, filmPath, { method: 'HEAD', headers: { Range: 'bytes=0-99' } });
      expect(probe.status).toBe(206);
      expect(probe.body.length).toBe(0);
      expect((await rawRequest(origin, filmPath, { headers: { 'If-None-Match': full.headers.etag } })).status).toBe(304);

      // MP4 and WebP keep their exact types and the same policy; a missing film is a 404, never the app shell.
      const mp4 = await rawRequest(origin, '/media/hero/daylight.mp4', { headers: { Range: 'bytes=0-15' } });
      expect(mp4.status).toBe(206);
      expect(mp4.headers['content-type']).toBe('video/mp4');
      expect(mp4.body.toString('ascii', 4, 8)).toBe('ftyp');
      const photo = await rawRequest(origin, '/media/catalog/floating-shelf-110-walnut.webp', { headers: { 'Accept-Encoding': 'br' } });
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toBe('image/webp');
      expect(photo.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(photo.headers['content-encoding']).toBeUndefined();
      const missing = await rawRequest(origin, '/media/icons/missing.webm');
      expect(missing.status).toBe(404);
      expect(missing.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect((await rawRequest(origin, '/media/hero')).status).toBe(404);

      // The shell carries its document policy as a header too: the films' media-src included.
      const shell = await rawRequest(origin, '/');
      expect(shell.headers['content-security-policy']).toBe(SHELL_CSP);
      expect(SHELL_CSP).toContain("img-src 'self' data: blob:");
      expect(SHELL_CSP).toContain("media-src 'self' blob:");
      expect(SHELL_CSP).toContain("frame-ancestors 'none'");
      expect(readFileSync(join(REPO_DIR, 'index.html'), 'utf8')).toContain(`content="${SHELL_CSP_META}"`);

      // Range parsing: one range only, the rest is ignored rather than refused.
      expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
      expect(parseRange('bytes=5-2', 1000)).toBeNull();
      expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull();
      expect(parseRange('items=0-1', 1000)).toBeNull();
      expect(parseRange('bytes=-0', 1000)).toBe('unsatisfiable');
      expect(parseRange(`bytes=${'9'.repeat(400)}-`, 1000)).toBeNull();
    } finally {
      await shutdown({ reason: 'test' });
    }
  });

  test('the viewport rule plays a film only while someone can see it, and reduced motion waits to be asked', () => {
    const base = { inView: true, engaged: false, docVisible: true, reduced: false, saveData: false };
    expect(shouldPlay({ ...base, mode: 'auto' })).toBe(true);
    expect(shouldPlay({ ...base, mode: 'auto', inView: false })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'auto', docVisible: false })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'auto', reduced: true })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'auto', saveData: true })).toBe(false);
    // Hover films wait for the pointer or focus, and then play even under reduced motion.
    expect(shouldPlay({ ...base, mode: 'hover' })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'hover', engaged: true })).toBe(true);
    expect(shouldPlay({ ...base, mode: 'hover', engaged: true, reduced: true })).toBe(true);
    expect(shouldPlay({ ...base, mode: 'hover', engaged: true, inView: false })).toBe(false);
    expect(shouldPlay({ ...base, mode: 'auto', engaged: true, reduced: true })).toBe(true);
    expect(shouldPlay({})).toBe(false);
  });

  test('the core modules wear 2K studio photographs and every swatch puts its finish on the plinth', async ({ page }) => {
    await installCspRecorder(page);
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const modules = page.getByTestId('core-modules');
    await modules.scrollIntoViewIfNeeded();
    const cards = modules.getByRole('article');
    await expect(cards).toHaveCount(3);
    for (const name of ['Floating Shelf 110', 'Corner Floor Column 140', 'Acoustic Art Frame 50x70']) {
      const card = modules.getByRole('article', { name });
      const visual = card.getByTestId('product-visual');
      const product = PRODUCTS.find((p) => p.name === name);
      await expect(visual).toHaveAttribute('data-shown', product.defaultFinish, { timeout: 15_000 });
      expect(await decodedWidth(visual.locator(`img[data-finish="${product.defaultFinish}"]`))).toBeGreaterThanOrEqual(1200);
      // Every finish the part ships in has its own photograph.
      for (const finish of product.finishes) {
        await card.locator(`input[type="radio"][value="${finish}"]`).check();
        await expect(card).toHaveAttribute('data-finish', finish);
        await expect(visual).toHaveAttribute('data-shown', finish, { timeout: 15_000 });
        expect(await decodedWidth(visual.locator(`img[data-finish="${finish}"]`)), `${name} ${finish}`).toBe(CATALOG_SIZE.width);
      }
    }
    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test('the media library is plain files: no stray formats or oversize originals', () => {
  for (const file of walk(MEDIA_DIR)) {
    expect(/\.(webp|webm|mp4)$/.test(file), file).toBe(true);
    expect(statSync(file).size, file).toBeLessThan(5 * 1024 * 1024);
  }
});
