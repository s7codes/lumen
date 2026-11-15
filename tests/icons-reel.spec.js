import { readFileSync } from 'node:fs';
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
  reelProgress,
  reelTime,
} from '../src/lib/icons-reel.js';
import { ICONS_MEDIA, ICONS_SIZE } from '../src/lib/media-manifest.js';
import { collectFailedResponses, collectRuntimeErrors, horizontalOverflow, installCspRecorder, mediaPath, readCspViolations } from './support/runtime-guards.js';

const MEDIA_DIR = fileURLToPath(new URL('../public/media/', import.meta.url));

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

/** Records every icon change on the banner with its time, from inside the page. */
function watchIcons(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="icons-cinema"]');
    window.__iconChanges = [];
    new MutationObserver(() => window.__iconChanges.push({ icon: el.dataset.icon, at: performance.now() })).observe(el, { attributes: true, attributeFilter: ['data-icon'] });
  });
}

/**
 * Grain estimate of the frame on screen in a film, in 8-bit code values: the
 * median absolute 3 x 3 Laplacian, scaled to a Gaussian sigma. Edges are
 * sparse, so the median reads the texture between them: a smooth render sits
 * near 0, film grain or speckle sits well above 1.
 */
function frameGrain(film) {
  return film.evaluate((video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const luma = (x, y) => {
      const i = (y * w + x) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    const values = [];
    for (let y = 2; y < h - 2; y += 3) {
      for (let x = 2; x < w - 2; x += 3) {
        values.push(Math.abs(luma(x - 1, y) + luma(x + 1, y) + luma(x, y - 1) + luma(x, y + 1) - 4 * luma(x, y)));
      }
    }
    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    let mean = 0;
    for (let i = 0; i < data.length; i += 4) mean += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    return { sigma: (1.4826 * median) / Math.sqrt(20), mean: mean / (data.length / 4) / 255, w, h };
  });
}

test.describe('meet our icons reel clock', () => {
  test('three icons hold the banner 3 s each on a 9 s loop, and every film covers its slot and its fade', () => {
    expect(REEL_IDS).toEqual(['monolith', 'suspension', 'column']);
    expect(ICON_REEL.map((icon) => icon.index)).toEqual(['01', '02', '03']);
    expect(REEL_SLOT_SECONDS).toBe(3);
    expect(REEL_LOOP_SECONDS).toBe(9);
    expect(reelIndexAt(0)).toBe(0);
    expect(reelIndexAt(2.999)).toBe(0);
    expect(reelIndexAt(3)).toBe(1);
    expect(reelIndexAt(6)).toBe(2);
    expect(reelIndexAt(9)).toBe(0);
    expect(reelIndexAt(-1)).toBe(2);
    expect(reelTime(Number.NaN)).toBe(0);
    expect(reelProgress(1.5)).toBeCloseTo(0.5, 9);
    expect(reelProgress(4.5)).toBeCloseTo(0.5, 9);
    expect(nextReelIndex(0)).toBe(1);
    expect(nextReelIndex(2)).toBe(0);
    expect(nextReelIndex(7)).toBe(0);
    expect(isReelIndex(1)).toBe(true);
    expect(isReelIndex(3)).toBe(false);
    expect(isReelIndex('1')).toBe(false);
    // A film runs from its first frame through its 3 s and its fade out.
    expect(ICON_FILM_SECONDS).toBeGreaterThanOrEqual(REEL_SLOT_SECONDS + REEL_FADE_MS / 1000);

    // Copy is plain ASCII, like every other line of the storefront.
    for (const icon of ICON_REEL) expect(/^[\x20-\x7e]+$/.test(`${icon.label} ${icon.caption}`), icon.id).toBe(true);

    expect(ICONS_SIZE).toEqual({ width: 1920, height: 800 });
    const bases = { monolith: 'icon-01-monolith', suspension: 'icon-02-suspension', column: 'icon-03-column-spot' };
    for (const id of REEL_IDS) {
      const media = ICONS_MEDIA[id];
      expect(media.base).toBe(bases[id]);
      expect(media.poster).toMatch(new RegExp(`^/media/icons/${bases[id]}\\.webp\\?v=`));
      expect(media.film.webm).toMatch(new RegExp(`^/media/icons/${bases[id]}\\.webm\\?v=`));
      expect(media.film.mp4).toMatch(new RegExp(`^/media/icons/${bases[id]}\\.mp4\\?v=`));
      // The shipped MP4 runs the full film length at 60 fps.
      const mp4 = readFileSync(join(MEDIA_DIR, 'icons', `${bases[id]}.mp4`));
      expect(mp4Duration(mp4), id).toBeCloseTo(ICON_FILM_SECONDS, 1);
    }
  });
});

test.describe('meet our icons reel', () => {
  test('a full-bleed 3-film reel cycles every 3 s on screen, jumps on a key, serves its films from /media/icons and stops off screen', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await expect(cinema).toHaveAttribute('data-icon', 'monolith');

    // Three stacked films, WebM first and MP4 second, muted, inline and looping.
    const films = page.getByTestId('icons-reel').locator('video[data-reel]');
    await expect(films).toHaveCount(3);
    for (const id of REEL_IDS) {
      const film = page.getByTestId(`icons-film-${id}`);
      const sources = await film.locator('source').evaluateAll((els) => els.map((el) => [el.type, new URL(el.src).pathname]));
      expect(sources).toEqual([
        ['video/webm', `/media/icons/${ICONS_MEDIA[id].base}.webm`],
        ['video/mp4', `/media/icons/${ICONS_MEDIA[id].base}.mp4`],
      ]);
      expect(await film.evaluate((el) => ({ muted: el.muted, loop: el.loop, inline: el.playsInline }))).toEqual({ muted: true, loop: true, inline: true });
    }

    await cinema.scrollIntoViewIfNeeded();
    await watchIcons(page);
    await expect(cinema).toHaveAttribute('data-playing', 'true');
    for (const id of REEL_IDS) await expect(page.getByTestId(`icons-film-${id}`)).toHaveAttribute('poster', mediaPath(ICONS_MEDIA[id].poster));

    // The banner, its title and key keep their editorial look over the films.
    const box = await cinema.boundingBox();
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(await page.evaluate(() => document.documentElement.clientWidth));
    // clamp(460px, 76vh, 760px): 76vh of a 900 px viewport.
    expect(Math.round(box.height)).toBe(684);
    const title = cinema.getByRole('heading', { level: 2, name: 'Meet our Icons' });
    await expect(title).toHaveCSS('font-weight', '380');
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
    const titleBox = await title.boundingBox();
    expect(Math.abs(titleBox.x + titleBox.width / 2 - (box.x + box.width / 2))).toBeLessThanOrEqual(1);
    const cta = cinema.getByRole('link', { name: 'Discover More' });
    await expect(cta).toHaveAttribute('href', '/catalog');
    await expect(cta).toHaveCSS('border-left', '1px solid rgba(255, 255, 255, 0.75)');
    await expect(cta).toHaveCSS('border-top-width', '0px');
    expect((await cinema.innerText()).replace(/\s+/g, ' ').trim().toLowerCase()).toBe('meet our icons discover more 01 monolith dome 02 linear pendant 150 03 floor column 140');

    // The first film plays on screen; the other two wait.
    const monolith = page.getByTestId('icons-film-monolith');
    await expect.poll(() => monolith.evaluate((el) => !el.paused && el.currentTime > 0.2), { timeout: 15_000 }).toBe(true);
    expect(await monolith.evaluate((el) => [el.videoWidth, el.videoHeight])).toEqual([ICONS_SIZE.width, ICONS_SIZE.height]);
    for (const id of ['suspension', 'column']) expect(await page.getByTestId(`icons-film-${id}`).evaluate((el) => el.paused)).toBe(true);
    await expect(page.getByTestId('icons-key-monolith')).toHaveAttribute('aria-pressed', 'true');
    // The hairline fill carries the 3 s clock.
    const fill = page.locator('[data-key-fill="monolith"]');
    const scale = () => fill.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    const before = await scale();
    await expect.poll(scale).toBeGreaterThan(before);

    // Zero grain: the decoded frame is smooth between its edges.
    const grain = await frameGrain(monolith);
    expect(grain.sigma, `grain ${grain.sigma.toFixed(3)}`).toBeLessThan(0.8);

    // Every 3 s the next icon takes the banner, its film from the top, and the
    // one before pauses once its fade is over.
    await expect.poll(() => page.evaluate(() => window.__iconChanges.length), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    const changes = await page.evaluate(() => window.__iconChanges.slice(0, 3));
    expect(changes.map((change) => change.icon)).toEqual(['suspension', 'column', 'monolith']);
    for (let i = 1; i < changes.length; i += 1) {
      const gap = changes[i].at - changes[i - 1].at;
      expect(gap, `slot ${i}`).toBeGreaterThan(2600);
      expect(gap, `slot ${i}`).toBeLessThan(4200);
    }
    expect(Number(await cinema.getAttribute('data-cycles'))).toBeGreaterThanOrEqual(3);
    await expect.poll(() => page.getByTestId('icons-film-column').evaluate((el) => el.paused), { timeout: 5_000 }).toBe(true);

    // A key jumps straight to its icon and restarts its 3 s.
    await page.evaluate(() => {
      window.__iconChanges = [];
    });
    const columnKey = page.getByTestId('icons-key-column');
    const pickedAt = await page.evaluate(() => performance.now());
    await columnKey.click();
    await expect(cinema).toHaveAttribute('data-icon', 'column');
    await expect(columnKey).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('icons-film-column')).toHaveAttribute('data-active', 'true');
    await expect.poll(() => page.getByTestId('icons-film-column').evaluate((el) => !el.paused && el.currentTime < 2.5)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__iconChanges.find((change) => change.icon === 'monolith')?.at ?? null), { timeout: 10_000 }).not.toBeNull();
    const handedOn = await page.evaluate(() => window.__iconChanges.find((change) => change.icon === 'monolith').at);
    expect(handedOn - pickedAt).toBeGreaterThan(2600);

    // The films are real files on this origin with their exact types.
    for (const id of REEL_IDS) {
      const base = `/media/icons/${ICONS_MEDIA[id].base}`;
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

  test('under reduced motion the reel rests on its posters, and a key shows that icon without playing it', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    await cinema.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('icons-film-monolith')).toHaveAttribute('poster', mediaPath(ICONS_MEDIA.monolith.poster));
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await expect(cinema).toHaveAttribute('data-icon', 'monolith');
    await page.getByTestId('icons-key-suspension').click();
    await expect(cinema).toHaveAttribute('data-icon', 'suspension');
    await expect(page.getByTestId('icons-film-suspension')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('icons-film-monolith')).not.toHaveAttribute('data-active');
    await page.waitForTimeout(400);
    for (const id of REEL_IDS) expect(await page.getByTestId(`icons-film-${id}`).evaluate((el) => el.paused && el.currentTime === 0)).toBe(true);
    await expect(cinema).toHaveAttribute('data-icon', 'suspension');
    // clamp(460px, 76vh, 760px) on a phone: 76vh of 800 px; the keys keep to their numbers.
    expect(Math.round((await cinema.boundingBox()).height)).toBe(608);
    await expect(page.getByTestId('icons-key-monolith').locator('.cinema__key-label')).toBeHidden();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});
