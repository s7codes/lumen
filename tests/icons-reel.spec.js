import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  ICON_FILM_SECONDS,
  ICON_REEL,
  isReelIndex,
  nextReelIndex,
  REEL_FADE_MS,
  REEL_IDS,
  REEL_LOOP_SECONDS,
  REEL_SLOT_SECONDS,
  reelIndexAt,
  reelTime,
} from '../src/lib/icons-reel.js';
import { ICONS_MEDIA, ICONS_SIZE } from '../src/lib/media-manifest.js';
import { collectFailedResponses, collectRuntimeErrors, horizontalOverflow, installCspRecorder, mediaPath, readCspViolations } from './support/runtime-guards.js';

const MEDIA_DIR = fileURLToPath(new URL('../public/media/', import.meta.url));
const BASES = { pendant: 'icon-01-pendant', plaster: 'icon-02-plaster', stair: 'icon-03-stair' };
// The v9.1 rail of named keys under the films is gone for good.
const RETIRED = /monolith|suspension|column|linear pendant 150|floor column 140/i;

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/** Duration in seconds from an MP4's movie header (mvhd, version 0 or 1). */
function mp4Duration(buf) {
  const at = buf.indexOf(Buffer.from('mvhd'));
  expect(at).toBeGreaterThan(0);
  const version = buf[at + 4];
  if (version === 1) return Number(buf.readBigUInt64BE(at + 4 + 4 + 16 + 4)) / buf.readUInt32BE(at + 4 + 4 + 16);
  return buf.readUInt32BE(at + 4 + 4 + 8 + 4) / buf.readUInt32BE(at + 4 + 4 + 8);
}

/** Records every film change on the banner with its time, from inside the page. */
function watchIcons(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="icons-cinema"]');
    window.__iconChanges = [];
    new MutationObserver(() => window.__iconChanges.push({ icon: el.dataset.icon, at: performance.now() })).observe(el, { attributes: true, attributeFilter: ['data-icon'] });
  });
}

/** Luma mean and spread of the frame on screen in a film, in 8-bit code values. */
function frameTone(film) {
  return film.evaluate((video) => {
    const w = 480;
    const h = 270;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    let sq = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      sq += l * l;
    }
    const mean = sum / n;
    return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  });
}

test.describe('meet our icons reel clock', () => {
  test('three camera films hold the banner 3 s each on a 9 s loop, each covering its slot and fade, credited to their authors', () => {
    expect(REEL_IDS).toEqual(['pendant', 'plaster', 'stair']);
    expect(ICON_REEL.map((icon) => icon.index)).toEqual(['01', '02', '03']);
    expect(REEL_SLOT_SECONDS).toBe(3);
    expect(REEL_LOOP_SECONDS).toBe(9);
    expect([0, 2.999, 3, 6, 9, -1].map(reelIndexAt)).toEqual([0, 0, 1, 2, 0, 2]);
    expect(reelTime(Number.NaN)).toBe(0);
    expect([0, 1, 2, 7].map(nextReelIndex)).toEqual([1, 2, 0, 0]);
    expect([1, 3, '1'].map(isReelIndex)).toEqual([true, false, false]);
    // A film runs from its first frame through its 3 s and its fade out, with room to spare.
    expect(ICON_FILM_SECONDS).toBeGreaterThanOrEqual(REEL_SLOT_SECONDS + REEL_FADE_MS / 1000 + 0.5);
    for (const icon of ICON_REEL) expect(/^[\x20-\x7e]+$/.test(icon.caption), icon.id).toBe(true);

    expect(ICONS_SIZE).toEqual({ width: 1920, height: 1080 });
    for (const id of REEL_IDS) {
      const media = ICONS_MEDIA[id];
      expect(media.base).toBe(BASES[id]);
      expect(media.poster).toMatch(new RegExp(`^/media/icons/${BASES[id]}\\.webp\\?v=`));
      expect(media.film.webm).toMatch(new RegExp(`^/media/icons/${BASES[id]}\\.webm\\?v=`));
      expect(media.film.mp4).toMatch(new RegExp(`^/media/icons/${BASES[id]}\\.mp4\\?v=`));
      // Real footage under the Pexels License, each clip named with its author and page.
      expect(media.credit).toMatchObject({ source: 'Pexels', license: 'Pexels License' });
      expect(media.credit.url).toMatch(/^https:\/\/www\.pexels\.com\/video\/[a-z0-9-]+-\d+\/$/);
      for (const text of [media.credit.title, media.credit.author]) expect(/^[\x20-\x7e]{3,}$/.test(text), text).toBe(true);
      const mp4 = readFileSync(join(MEDIA_DIR, 'icons', `${BASES[id]}.mp4`));
      expect(Math.abs(mp4Duration(mp4) - ICON_FILM_SECONDS), id).toBeLessThan(0.05);
    }
    // The three films and their posters are the whole folder: nothing of the CGI reel is left.
    const shipped = readdirSync(join(MEDIA_DIR, 'icons')).sort();
    expect(shipped).toEqual(Object.values(BASES).flatMap((base) => [`${base}.mp4`, `${base}.webm`, `${base}.webp`]).sort());
    expect(existsSync(join(MEDIA_DIR, 'showcase'))).toBe(false);
  });
});

test.describe('meet our icons reel', () => {
  test('the camera films cycle every 3 s in a continuous loop under nothing but the title and Discover More, and stop off screen', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await expect(cinema).toHaveAttribute('data-icon', 'pendant');

    // Three stacked films, WebM first and MP4 second, muted, inline and looping.
    const films = page.getByTestId('icons-reel').locator('video[data-reel]');
    await expect(films).toHaveCount(3);
    for (const id of REEL_IDS) {
      const film = page.getByTestId(`icons-film-${id}`);
      const sources = await film.locator('source').evaluateAll((els) => els.map((el) => [el.type, new URL(el.src).pathname]));
      expect(sources).toEqual([
        ['video/webm', `/media/icons/${BASES[id]}.webm`],
        ['video/mp4', `/media/icons/${BASES[id]}.mp4`],
      ]);
      expect(await film.evaluate((el) => ({ muted: el.muted, loop: el.loop, inline: el.playsInline }))).toEqual({ muted: true, loop: true, inline: true });
    }

    // The only overlay: the centred title and its bracketed Discover More key. No rail, no
    // labels, no progress bars, no buttons.
    expect((await cinema.innerText()).replace(/\s+/g, ' ').trim().toLowerCase()).toBe('meet our icons discover more');
    expect(await cinema.textContent()).not.toMatch(RETIRED);
    await expect(cinema.locator('button, [role="group"], [data-testid^="icons-key"], [data-key-fill], .cinema__keys')).toHaveCount(0);
    await expect(cinema.getByRole('link')).toHaveCount(1);
    const cta = cinema.getByRole('link', { name: 'Discover More' });
    await expect(cta).toHaveAttribute('href', '/catalog');
    await expect(cta).toHaveCSS('text-transform', 'uppercase');
    await expect(cta).toHaveCSS('border-left', '1px solid rgba(255, 255, 255, 0.75)');
    await expect(cta).toHaveCSS('border-top-width', '0px');
    const title = cinema.getByRole('heading', { level: 2, name: 'Meet our Icons' });
    await expect(title).toHaveCSS('font-weight', '380');
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');

    await cinema.scrollIntoViewIfNeeded();
    await watchIcons(page);
    await expect(cinema).toHaveAttribute('data-playing', 'true');
    for (const id of REEL_IDS) await expect(page.getByTestId(`icons-film-${id}`)).toHaveAttribute('poster', mediaPath(ICONS_MEDIA[id].poster));

    // Full bleed and centred, at clamp(460px, 76vh, 760px): 76vh of a 900 px viewport.
    const box = await cinema.boundingBox();
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(await page.evaluate(() => document.documentElement.clientWidth));
    expect(Math.round(box.height)).toBe(684);
    const titleBox = await title.boundingBox();
    const ctaBox = await cta.boundingBox();
    expect(Math.abs(titleBox.x + titleBox.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(ctaBox.x + ctaBox.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    expect(ctaBox.y).toBeGreaterThan(titleBox.y + titleBox.height);

    // The first film plays on screen at 1920 x 1080; the other two wait.
    const pendant = page.getByTestId('icons-film-pendant');
    await expect.poll(() => pendant.evaluate((el) => !el.paused && el.currentTime > 0.2), { timeout: 15_000 }).toBe(true);
    expect(await pendant.evaluate((el) => [el.videoWidth, el.videoHeight])).toEqual([ICONS_SIZE.width, ICONS_SIZE.height]);
    for (const id of ['plaster', 'stair']) expect(await page.getByTestId(`icons-film-${id}`).evaluate((el) => el.paused)).toBe(true);
    // A photographed room, not a blank or a flat field: real tone and real contrast in the frame.
    const tone = await frameTone(pendant);
    expect(tone.mean, JSON.stringify(tone)).toBeGreaterThan(25);
    expect(tone.mean, JSON.stringify(tone)).toBeLessThan(215);
    expect(tone.spread, JSON.stringify(tone)).toBeGreaterThan(12);

    // Every 3 s the next film takes the banner from its first frame and crossfades in; after
    // the stair it is the pendant again, round and round.
    await expect.poll(() => page.evaluate(() => window.__iconChanges.length), { timeout: 20_000 }).toBeGreaterThanOrEqual(4);
    const changes = await page.evaluate(() => window.__iconChanges.slice(0, 4));
    expect(changes.map((change) => change.icon)).toEqual(['plaster', 'stair', 'pendant', 'plaster']);
    for (let i = 1; i < changes.length; i += 1) {
      const gap = changes[i].at - changes[i - 1].at;
      expect(gap, `slot ${i}`).toBeGreaterThan(2600);
      expect(gap, `slot ${i}`).toBeLessThan(4200);
    }
    expect(Number(await cinema.getAttribute('data-cycles'))).toBeGreaterThanOrEqual(4);
    // One film on screen at a time, fully faded in; the one before pauses once its fade is over.
    const current = await cinema.getAttribute('data-icon');
    await expect(cinema.locator('video[data-active]')).toHaveCount(1);
    await expect(page.getByTestId(`icons-film-${current}`)).toHaveAttribute('data-active', 'true');
    await expect.poll(() => page.getByTestId(`icons-film-${current}`).evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    const before = REEL_IDS[(REEL_IDS.indexOf(current) + REEL_IDS.length - 1) % REEL_IDS.length];
    await expect.poll(() => page.getByTestId(`icons-film-${before}`).evaluate((el) => el.paused), { timeout: 5_000 }).toBe(true);

    // The films are real files on this origin with their exact types.
    for (const id of REEL_IDS) {
      const base = `/media/icons/${BASES[id]}`;
      const webm = await page.request.get(`${base}.webm`);
      expect(webm.status()).toBe(200);
      expect(webm.headers()['content-type']).toBe('video/webm');
      expect((await webm.body()).readUInt32BE(0)).toBe(0x1a45dfa3);
      const mp4 = await page.request.get(`${base}.mp4`);
      expect(mp4.status()).toBe(200);
      expect(mp4.headers()['content-type']).toBe('video/mp4');
      expect((await mp4.body()).toString('ascii', 4, 8)).toBe('ftyp');
      const poster = await page.request.get(`${base}.webp`);
      expect(poster.headers()['content-type']).toBe('image/webp');
    }

    // Scrolled away, the reel stops and every film pauses.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    for (const id of REEL_IDS) await expect.poll(() => page.getByTestId(`icons-film-${id}`).evaluate((el) => el.paused)).toBe(true);
    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion a phone rests on the first poster under the same two lines, and nothing plays', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    await cinema.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('icons-film-pendant')).toHaveAttribute('poster', mediaPath(ICONS_MEDIA.pendant.poster));
    await expect(page.getByTestId('icons-film-pendant')).toHaveAttribute('data-active', 'true');
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await expect(cinema).toHaveAttribute('data-icon', 'pendant');
    await expect(cinema).toHaveAttribute('data-cycles', '0');
    for (const id of REEL_IDS) expect(await page.getByTestId(`icons-film-${id}`).evaluate((el) => el.paused && el.currentTime === 0)).toBe(true);
    expect((await cinema.innerText()).replace(/\s+/g, ' ').trim().toLowerCase()).toBe('meet our icons discover more');
    await expect(cinema.locator('button')).toHaveCount(0);
    // clamp(460px, 76vh, 760px) on a phone: 76vh of 844 px.
    expect(Math.round((await cinema.boundingBox()).height)).toBe(641);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
