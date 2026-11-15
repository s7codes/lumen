import { expect, test } from '@playwright/test';
import { FILM_FILES, FILM_SECONDS } from '../src/lib/showcase-film.js';
import { SHOWCASE_MEDIA, SHOWCASE_SIZE } from '../src/lib/media-manifest.js';
import { ACT_IDS } from '../src/lib/showcase-scene.js';
import { collectFailedResponses, collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/**
 * Tone statistics of the frame on screen in a film: mean luminance, the share
 * of near-black (obsidian) pixels, the share lit warm 2700K, the share in the
 * iso-lux false colour (saturated gold to copper) and a grain estimate (the
 * median absolute 3 x 3 Laplacian as a Gaussian sigma, in 8-bit codes).
 */
function frameStats(film) {
  return film.evaluate((video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const lumaAt = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    let sum = 0;
    let black = 0;
    let warm = 0;
    let falseColour = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 3) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = lumaAt(i);
      sum += l;
      n += 1;
      if (l < 22) black += 1;
      if (r > 70 && r - b > 40 && r >= g) warm += 1;
      // The iso-lux ramp: deep bronze through copper and amber to gold, saturated and lit.
      if (r > 120 && g > 60 && r - b > 80 && b < 0.5 * r) falseColour += 1;
    }
    const lap = [];
    for (let y = 2; y < h - 2; y += 3) {
      for (let x = 2; x < w - 2; x += 3) {
        const at = (dx, dy) => lumaAt(((y + dy) * w + (x + dx)) * 4);
        lap.push(Math.abs(at(-1, 0) + at(1, 0) + at(0, -1) + at(0, 1) - 4 * at(0, 0)));
      }
    }
    lap.sort((a, b) => a - b);
    return {
      mean: sum / n / 255,
      black: black / n,
      warm: warm / n,
      falseColour: falseColour / n,
      grain: (1.4826 * lap[Math.floor(lap.length / 2)]) / Math.sqrt(20),
      size: [w, h],
    };
  });
}

test.describe('showcase cad films', () => {
  test('every act plays its dark CAD film: an obsidian chamber in warm 2700K light, the iso-lux act in false colour, all free of grain', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const stage = page.getByTestId('showcase-stage');
    await stage.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('showcase-stage-screen')).toBeVisible();

    const stats = {};
    for (const id of ACT_IDS) {
      const key = page.getByTestId(`showcase-act-${id}`);
      // A key holds its act, so its film keeps the stage while it is read.
      if ((await key.getAttribute('aria-pressed')) !== 'true') await key.click();
      await expect(stage).toHaveAttribute('data-act', id);
      const film = page.getByTestId(`showcase-film-${id}`);
      const sources = await film.locator('source').evaluateAll((els) => els.map((el) => new URL(el.src).pathname));
      expect(sources).toEqual([`/media/showcase/${FILM_FILES[id]}.webm`, `/media/showcase/${FILM_FILES[id]}.mp4`]);
      await expect.poll(() => film.evaluate((el) => !el.paused && el.readyState >= 2 && el.currentTime > 1.2), { timeout: 30_000 }).toBe(true);
      expect(await film.evaluate((el) => [el.videoWidth, el.videoHeight])).toEqual([SHOWCASE_SIZE.width, SHOWCASE_SIZE.height]);
      expect(await film.evaluate((el) => Math.round(el.duration))).toBe(FILM_SECONDS[id]);
      stats[id] = await frameStats(film);
    }

    for (const id of ACT_IDS) {
      const s = stats[id];
      const label = `${id} ${JSON.stringify(s)}`;
      // Obsidian: a dark frame, much of it near black, never the old tan room.
      expect(s.mean, label).toBeLessThan(0.2);
      expect(s.black, label).toBeGreaterThan(0.22);
      // Warm 2700K light carries the picture.
      expect(s.warm, label).toBeGreaterThan(0.04);
      // Tack-sharp and smooth: no grain between the edges.
      expect(s.grain, label).toBeLessThan(0.8);
    }
    // The iso-lux act paints the floor in false colour; the others do not.
    expect(stats.isolux.falseColour, JSON.stringify(stats.isolux)).toBeGreaterThan(0.04);
    expect(stats.isolux.falseColour, JSON.stringify({ isolux: stats.isolux.falseColour, orbit: stats.orbit.falseColour })).toBeGreaterThan(stats.orbit.falseColour * 4);
    expect(SHOWCASE_MEDIA.isolux.poster).toMatch(/^\/media\/showcase\/04-iso-lux\.webp\?v=/);

    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });
});
