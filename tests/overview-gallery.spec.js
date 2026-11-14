import { expect, test } from '@playwright/test';
import {
  breathe,
  CINEMA_ACT_IDS,
  CINEMA_ACT_SECONDS,
  CINEMA_DISSOLVE_SECONDS,
  CINEMA_LOOP_SECONDS,
  cinemaCamera,
  cinemaLayers,
  dominantAct,
  loopTime,
} from '../src/lib/icons-cinema.js';
import {
  HERO_CROSSFADE_SECONDS,
  HERO_CYCLE_SECONDS,
  HERO_FRAME,
  HERO_HOLD_SECONDS,
  HERO_HOTSPOTS,
  HERO_SCENE_IDS,
  heroSceneAt,
  isHeroSceneId,
  warmWeight,
} from '../src/lib/hero-scenes.js';
import { INTERIOR_SCENE_IDS, INTERIOR_SCENES, INTERIOR_VIEW, interiorScene } from '../src/lib/interior-painter.js';
import { HERO_MEDIA, ROOM_MEDIA } from '../src/lib/media-manifest.js';
import { getProduct } from '../src/data/products.js';
import {
  collectFailedResponses,
  collectRuntimeErrors,
  decodedWidth,
  horizontalOverflow,
  installCspRecorder,
  mediaPath,
  playhead,
  readCspViolations,
} from './support/runtime-guards.js';

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

function nextFrames(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** A cheap fingerprint of the canvas pixels: changes whenever the frame does. */
function canvasPrint(canvas) {
  return canvas.evaluate((el) => {
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4 * 97) sum += data[i] + data[i + 1] * 3 + data[i + 2] * 7;
    return sum;
  });
}

function edgeToEdge(page, locator) {
  return Promise.all([locator.boundingBox(), page.evaluate(() => document.documentElement.clientWidth)]).then(([box, width]) => ({
    left: Math.round(box.x),
    gap: Math.abs(box.width - width),
  }));
}

test.describe('meet our icons clock', () => {
  test('three 4.5 s acts cross-dissolve on a 13.5 s loop and every camera hands over without a jump', () => {
    expect(CINEMA_ACT_IDS).toEqual(['obsidian', 'aperture', 'track']);
    expect(CINEMA_ACT_SECONDS).toBe(4.5);
    expect(CINEMA_LOOP_SECONDS).toBe(13.5);
    expect(loopTime(-1)).toBeCloseTo(12.5, 9);
    expect(loopTime(27.25)).toBeCloseTo(0.25, 9);
    expect(loopTime(Number.NaN)).toBe(0);

    // Mid-act a single opaque layer owns the frame.
    expect(cinemaLayers(1)).toHaveLength(1);
    expect(cinemaLayers(1)[0]).toMatchObject({ index: 0, id: 'obsidian', weight: 1 });

    for (let act = 0; act < 3; act += 1) {
      const end = (act + 1) * CINEMA_ACT_SECONDS;
      const start = end - CINEMA_DISSOLVE_SECONDS;
      let last = 0;
      for (let k = 1; k < 24; k += 1) {
        const layers = cinemaLayers(start + (k / 24) * CINEMA_DISSOLVE_SECONDS);
        expect(layers).toHaveLength(2);
        expect(layers[0]).toMatchObject({ index: act, weight: 1 });
        expect(layers[1].index).toBe((act + 1) % 3);
        // The incoming act fades in on a monotonic, smooth weight.
        expect(layers[1].weight).toBeGreaterThanOrEqual(last);
        expect(layers[1].weight).toBeLessThanOrEqual(1);
        last = layers[1].weight;
      }
      expect(last).toBeGreaterThan(0.95);
      expect(dominantAct(start + CINEMA_DISSOLVE_SECONDS * 0.25)).toBe(act);
      expect(dominantAct(start + CINEMA_DISSOLVE_SECONDS * 0.75)).toBe((act + 1) % 3);

      // The camera the incoming act used while dissolving is the one it keeps.
      const before = cinemaLayers(end - 1e-6)[1];
      const after = cinemaLayers(end + 1e-6)[0];
      expect(after.index).toBe(before.index);
      expect(after.progress).toBeCloseTo(before.progress, 5);
      const a = cinemaCamera(before.id, before.progress);
      const b = cinemaCamera(after.id, after.progress);
      for (const key of ['x', 'y', 'scale', 'rot']) expect(b[key]).toBeCloseTo(a[key], 4);
    }

    // Light sources swell gently, never below 1 - depth and never above 1.
    for (let t = 0; t < 20; t += 0.37) {
      const level = breathe(t, 4.2, 0.1);
      expect(level).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(level).toBeLessThanOrEqual(1 + 1e-9);
    }

    // The three rooms: 4:5 photographs, each with its luminaire placed in the
    // frame for the hover glow, and a film of its light.
    expect(INTERIOR_SCENE_IDS).toEqual(['dining', 'bedroom', 'studio']);
    expect(INTERIOR_VIEW).toEqual({ width: 1600, height: 2000 });
    expect(INTERIOR_VIEW.width / INTERIOR_VIEW.height).toBe(0.8);
    for (const id of INTERIOR_SCENE_IDS) {
      const art = interiorScene(id);
      expect(art.id).toBe(id);
      expect(art.label).toBe(INTERIOR_SCENES[id].label);
      expect(art.glow.x).toBeGreaterThan(0);
      expect(art.glow.x).toBeLessThan(1);
      expect(art.glow.y).toBeGreaterThan(0);
      expect(art.glow.y).toBeLessThan(1);
      const media = ROOM_MEDIA[id];
      expect(media.still).toMatch(new RegExp(`^/media/rooms/${media.slug}-1600\\.webp\\?v=`));
      expect(media.film.webm).toMatch(new RegExp(`^/media/rooms/${media.slug}\\.webm\\?v=`));
      expect(media.film.mp4).toMatch(new RegExp(`^/media/rooms/${media.slug}\\.mp4\\?v=`));
    }
    expect(Object.values(ROOM_MEDIA).map((media) => media.slug)).toEqual(['dining-living', 'bedroom-sanctuary', 'studio-wall']);
    expect(interiorScene('unknown').id).toBe('dining');
  });

  test('the hero clock holds each scene 5 s and crossfades 1.1 s, and every fixture key sits on its fixture', () => {
    expect(HERO_SCENE_IDS).toEqual(['daylight', 'warm']);
    expect(isHeroSceneId('warm')).toBe(true);
    expect(isHeroSceneId('gallery')).toBe(false);
    expect(HERO_HOLD_SECONDS).toBe(5);
    expect(HERO_CROSSFADE_SECONDS).toBe(1.1);
    expect(HERO_CYCLE_SECONDS).toBeCloseTo(12.2, 9);
    expect(warmWeight(0)).toBe(0);
    expect(warmWeight(4.99)).toBe(0);
    expect(warmWeight(5.55)).toBeCloseTo(0.5, 6);
    expect(warmWeight(6.1)).toBe(1);
    expect(warmWeight(11.09)).toBe(1);
    expect(warmWeight(11.65)).toBeCloseTo(0.5, 6);
    expect(warmWeight(12.2 + 2)).toBe(0);
    expect(warmWeight(Number.NaN)).toBe(0);
    let last = -1;
    for (let t = 5; t <= 6.1; t += 0.05) {
      expect(warmWeight(t)).toBeGreaterThanOrEqual(last);
      last = warmWeight(t);
    }
    expect(heroSceneAt(1)).toBe('daylight');
    expect(heroSceneAt(8)).toBe('warm');

    // Two 2K scenes, each a 1280w and a 2560w WebP and a WebM and MP4 film.
    expect(HERO_FRAME).toEqual({ width: 2560, height: 1440 });
    for (const id of HERO_SCENE_IDS) {
      const media = HERO_MEDIA[id];
      expect(media.srcSet).toMatch(new RegExp(`^/media/hero/${id}-1280\\.webp\\?v=\\S+ 1280w, /media/hero/${id}-2560\\.webp\\?v=\\S+ 2560w$`));
      expect(media.film.webm).toMatch(new RegExp(`^/media/hero/${id}\\.webm\\?v=`));
      expect(media.film.mp4).toMatch(new RegExp(`^/media/hero/${id}\\.mp4\\?v=`));
    }

    // Fixture keys: projected anchors, inside the frame and on the right-hand
    // set, clear of the copy; each names a real lit catalog part.
    expect(HERO_HOTSPOTS.map((spot) => spot.id)).toEqual(['track', 'pendant', 'shelf', 'column']);
    for (const spot of HERO_HOTSPOTS) {
      expect(spot.x, spot.id).toBeGreaterThan(0.5);
      expect(spot.x, spot.id).toBeLessThan(1);
      expect(spot.y, spot.id).toBeGreaterThan(0);
      expect(spot.y, spot.id).toBeLessThan(1);
      const product = getProduct(spot.productId);
      expect(product, spot.id).toBeTruthy();
      expect(product.watts, spot.id).toBeGreaterThan(0);
      expect(/^[\x20-\x7e]+$/.test(spot.detail), spot.id).toBe(true);
    }
  });
});

test.describe('light architectural hero', () => {
  test('daylight and warm 2700K crossfade over one room: 2K photographs under live films, fixture keys and a held switch', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    await expect(hero).toHaveAttribute('data-scenes', 'daylight warm');
    expect(await edgeToEdge(page, hero)).toEqual({ left: 0, gap: 0 });
    // Warm sand-stone under the photographs while they load, never a dark chamber.
    await expect(hero).toHaveCSS('background-color', 'rgb(198, 185, 165)');
    await expect(hero).not.toHaveClass(/(^|\s)optical(\s|$)/);

    // Two 2K photographs: the daylight still is the eager, high-priority LCP picture.
    for (const id of HERO_SCENE_IDS) {
      const still = hero.locator(`[data-testid="hero-scene-${id}"] img`);
      await expect(still).toHaveAttribute('srcset', /-1280\.webp\?v=\S+ 1280w, .+-2560\.webp\?v=\S+ 2560w$/);
      await expect(still).toHaveAttribute('width', '2560');
      await expect(still).toHaveAttribute('height', '1440');
      await expect.poll(() => decodedWidth(still), { timeout: 15_000 }).toBeGreaterThanOrEqual(1200);
    }
    const daylightStill = hero.locator('[data-testid="hero-scene-daylight"] img');
    await expect(daylightStill).toHaveAttribute('fetchpriority', 'high');
    await expect(daylightStill).toHaveAttribute('loading', 'eager');
    // At 1440 px the browser takes the 2560 w photograph.
    expect(await daylightStill.evaluate((el) => new URL(el.currentSrc).pathname)).toBe('/media/hero/daylight-2560.webp');

    // Each still carries its film: WebM first, MP4 second, muted, looped,
    // inline, with the still it covers as its poster.
    for (const id of HERO_SCENE_IDS) {
      const film = hero.locator(`[data-testid="hero-scene-${id}"] video`);
      const sources = await film.locator('source').evaluateAll((els) => els.map((el) => [el.type, new URL(el.src).pathname]));
      expect(sources).toEqual([
        ['video/webm', `/media/hero/${id}.webm`],
        ['video/mp4', `/media/hero/${id}.mp4`],
      ]);
      expect(await film.evaluate((el) => ({ muted: el.muted, loop: el.loop, inline: el.playsInline }))).toEqual({ muted: true, loop: true, inline: true });
      await expect(film).toHaveAttribute('poster', new RegExp(`/media/hero/${id}-\\d+\\.webp\\?v=`));
    }

    // On screen the daylight film plays and fades in over its still.
    const daylight = hero.getByTestId('hero-scene-daylight');
    const daylightFilm = daylight.locator('video');
    await expect(daylight).toHaveAttribute('data-video', 'playing', { timeout: 15_000 });
    const t0 = await playhead(daylightFilm);
    await expect.poll(() => playhead(daylightFilm)).toBeGreaterThan(t0);
    await expect.poll(() => daylightFilm.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);

    // The warm scene crossfades over daylight on the CSS clock: 5 s hold,
    // 1.1 s crossfade, 5 s hold, 1.1 s back.
    const warm = hero.locator('.hero-scene--warm');
    const motion = await warm.evaluate((el) => {
      const style = getComputedStyle(el);
      return { name: style.animationName, duration: style.animationDuration, count: style.animationIterationCount, timing: style.animationTimingFunction, state: style.animationPlayState };
    });
    expect(motion).toEqual({ name: 'hero-scene-cycle', duration: '12.2s', count: 'infinite', timing: 'cubic-bezier(0.45, 0, 0.55, 1)', state: 'running' });
    const opacityAt = (ms) =>
      warm.evaluate((el, at) => {
        const [animation] = el.getAnimations().filter((a) => a.animationName === 'hero-scene-cycle');
        animation.pause();
        animation.currentTime = at;
        return Number(getComputedStyle(el).opacity);
      }, ms);
    expect(await opacityAt(2500)).toBe(0);
    expect(await opacityAt(4990)).toBe(0);
    const rising = await opacityAt(5550);
    expect(rising).toBeGreaterThan(0.1);
    expect(rising).toBeLessThan(0.9);
    expect(await opacityAt(6150)).toBe(1);
    expect(await opacityAt(11000)).toBe(1);
    const falling = await opacityAt(11650);
    expect(falling).toBeGreaterThan(0.1);
    expect(falling).toBeLessThan(0.9);
    await warm.evaluate((el) => el.getAnimations().forEach((a) => a.play()));

    // No words on the photographs: the stage is pictures only.
    await expect(hero.locator('.hero__tag, .hero__readout, .hero__atmosphere')).toHaveCount(0);
    expect(await hero.locator('.hero__stage').evaluate((el) => el.textContent.trim())).toBe('');
    expect(await hero.locator('.hero__stage').evaluate((el) => el.querySelectorAll('svg, canvas, filter').length)).toBe(0);

    // Fixture keys sit on their fixtures at this crop and open a hairline callout.
    const frameBox = await hero.locator('.hero__hotspots .hero__frame').boundingBox();
    for (const spot of HERO_HOTSPOTS) {
      const key = hero.getByTestId(`hero-hotspot-${spot.id}`).locator('.hero-hotspot__key');
      const box = await key.boundingBox();
      expect(Math.abs(box.x + box.width / 2 - (frameBox.x + spot.x * frameBox.width)), spot.id).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - (frameBox.y + spot.y * frameBox.height)), spot.id).toBeLessThan(2);
      await expect(key, spot.id).toHaveCSS('border-top-left-radius', '0px');
    }
    const pendantKey = hero.getByTestId('hero-hotspot-pendant');
    const callout = pendantKey.getByRole('tooltip');
    await expect(callout).toBeHidden();
    await pendantKey.locator('.hero-hotspot__key').hover();
    await expect(callout).toBeVisible();
    await expect(callout).toContainText('Linear Suspension Pendant 150');
    await expect(pendantKey.getByRole('link', { name: 'Linear Suspension Pendant 150' })).toHaveAttribute('href', '/catalog/linear-pendant-150');
    await page.mouse.move(frameBox.x + 20, 5);

    // The switch holds a scene: one crossfade lands it, the clock stops.
    const switcher = page.getByTestId('hero-scene-switch');
    await expect(switcher.getByRole('button')).toHaveText(['Daylight', 'Warm 2700K']);
    await switcher.getByRole('button', { name: 'Warm 2700K' }).click();
    await expect(hero).toHaveAttribute('data-scene-hold', 'warm');
    await expect(switcher.getByRole('button', { name: 'Warm 2700K' })).toHaveAttribute('aria-pressed', 'true');
    await expect(warm).toHaveCSS('animation-name', 'none');
    await expect.poll(() => warm.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    await expect(hero.getByTestId('hero-scene-warm')).toHaveAttribute('data-video', 'playing', { timeout: 15_000 });
    await switcher.getByRole('button', { name: 'Daylight' }).click();
    await expect(hero).toHaveAttribute('data-scene-hold', 'daylight');
    await expect.poll(() => warm.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(0);
    await switcher.getByRole('button', { name: 'Daylight' }).click();
    await expect(hero).not.toHaveAttribute('data-scene-hold');
    await expect(warm).toHaveCSS('animation-name', 'hero-scene-cycle');

    // Cursor parallax: the whole picture drifts a few pixels against the pointer.
    const heroBox = await hero.boundingBox();
    const frame = hero.locator('.hero__stage .hero__frame');
    const drift = () => frame.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).e);
    await page.mouse.move(heroBox.x + heroBox.width * 0.74, heroBox.y + heroBox.height * 0.34);
    await page.mouse.move(heroBox.x + heroBox.width * 0.2, heroBox.y + heroBox.height * 0.34, { steps: 8 });
    await expect.poll(drift).toBeGreaterThan(3);
    await page.mouse.move(heroBox.x + heroBox.width * 0.5, 5);

    // Out of view the clock holds its place and the films pause; back in view both run again.
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="ambient-surface"]').offsetHeight + 400));
    await expect(hero).toHaveAttribute('data-offscreen', '');
    await expect(warm).toHaveCSS('animation-play-state', 'paused');
    await expect.poll(() => daylightFilm.evaluate((el) => el.paused)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(hero).not.toHaveAttribute('data-offscreen');
    await expect(warm).toHaveCSS('animation-play-state', 'running');
    await expect(daylight).toHaveAttribute('data-video', 'playing', { timeout: 15_000 });
    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the hero rests on the daylight photograph: no clock, no parallax, no film', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    const warm = hero.locator('.hero-scene--warm');
    await expect(warm).toHaveCSS('animation-name', 'none');
    await expect(warm).toHaveCSS('opacity', '0');
    await expect(hero.locator('.hero__stage .hero__frame')).toHaveCSS('transform', 'none');
    const still = hero.locator('[data-testid="hero-scene-daylight"] img');
    await expect.poll(() => decodedWidth(still)).toBeGreaterThanOrEqual(1200);
    // The films never start on their own: the photographs are the hero.
    for (const id of HERO_SCENE_IDS) {
      const film = hero.locator(`[data-testid="hero-scene-${id}"] video`);
      expect(await film.evaluate((el) => ({ paused: el.paused, time: el.currentTime }))).toEqual({ paused: true, time: 0 });
      await expect(hero.getByTestId(`hero-scene-${id}`)).not.toHaveAttribute('data-video', 'playing');
    }
    // A pick still lands at once.
    await page.getByTestId('hero-scene-switch').getByRole('button', { name: 'Warm 2700K' }).click();
    await expect(warm).toHaveCSS('opacity', '1');
  });

  test('wide screens crop the floor first: every fixture key stays whole inside the hero, clear of the navbar', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1600, height: 700 },
      { width: 1920, height: 1080 },
    ]) {
      const size = `${viewport.width}x${viewport.height}`;
      await page.setViewportSize(viewport);
      await page.goto('/');
      const hero = page.getByTestId('ambient-surface');
      const heroBox = await hero.boundingBox();
      const navBox = await page.locator('.navbar').boundingBox();
      // The cover frame spans the whole hero: the ceiling is never trimmed to make room for the floor.
      const frameBox = await hero.locator('.hero__stage .hero__frame').boundingBox();
      expect(frameBox.y, size).toBeLessThanOrEqual(heroBox.y);
      expect(frameBox.y + frameBox.height, size).toBeGreaterThanOrEqual(heroBox.y + heroBox.height);
      for (const spot of HERO_HOTSPOTS) {
        const key = hero.getByTestId(`hero-hotspot-${spot.id}`).locator('.hero-hotspot__key');
        const box = await key.boundingBox();
        expect(box.y, `${spot.id} at ${size}`).toBeGreaterThanOrEqual(navBox.y + navBox.height + 6);
        expect(box.y + box.height, `${spot.id} at ${size}`).toBeLessThanOrEqual(heroBox.y + heroBox.height);
        // Nothing covers the key: a click at its centre lands on it.
        const onTop = await key.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
        });
        expect(onTop, `${spot.id} at ${size}`).toBe(true);
      }
    }
  });
});

test.describe('meet our icons cinema', () => {
  test('a full-bleed 2D canvas film with a centred title and a bracketed Discover More, playing only while on screen', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    const canvas = page.getByTestId('icons-cinema-canvas');
    // Below the fold at load: nothing paints a frame nobody sees.
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await cinema.scrollIntoViewIfNeeded();
    await expect(cinema).toHaveAttribute('data-playing', 'true');

    expect(await edgeToEdge(page, cinema)).toEqual({ left: 0, gap: 0 });
    // clamp(460px, 76vh, 760px): 76vh of a 900 px viewport.
    expect(Math.round((await cinema.boundingBox()).height)).toBe(684);
    expect(await canvas.evaluate((el) => [Boolean(el.getContext('2d')), el.getContext('webgl'), el.getContext('webgl2')])).toEqual([true, null, null]);

    const title = cinema.getByRole('heading', { level: 2, name: 'Meet our Icons' });
    await expect(title).toHaveCSS('font-weight', '380');
    await expect(title).toHaveCSS('color', 'rgb(255, 255, 255)');
    const [titleBox, cinemaBox] = await Promise.all([title.boundingBox(), cinema.boundingBox()]);
    expect(Math.abs(titleBox.x + titleBox.width / 2 - (cinemaBox.x + cinemaBox.width / 2))).toBeLessThanOrEqual(1);

    const cta = cinema.getByRole('link', { name: 'Discover More' });
    await expect(cta).toHaveAttribute('href', '/catalog');
    const look = await cta.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        left: style.borderLeft,
        right: style.borderRight,
        top: style.borderTopWidth,
        bottom: style.borderBottomWidth,
        radius: style.borderTopLeftRadius,
        padding: style.padding,
        size: style.fontSize,
        tracking: style.letterSpacing,
        transform: style.textTransform,
      };
    });
    expect(look).toEqual({
      left: '1px solid rgba(255, 255, 255, 0.75)',
      right: '1px solid rgba(255, 255, 255, 0.75)',
      top: '0px',
      bottom: '0px',
      radius: '0px',
      padding: '7.2px 20px',
      size: '11.2px',
      tracking: '1.568px',
      transform: 'uppercase',
    });

    // Only the title and its key sit over the film: no act caption anywhere.
    await expect(cinema.locator('[data-cinema-caption], .cinema__caption')).toHaveCount(0);
    expect((await cinema.innerText()).replace(/\s+/g, ' ').trim().toLowerCase()).toBe('meet our icons discover more');

    // The frames move, and the acts advance through Act III, the anodized track.
    const first = await canvasPrint(canvas);
    await expect.poll(() => canvasPrint(canvas)).not.toBe(first);
    await expect(cinema).toHaveAttribute('data-act', 'aperture', { timeout: 15_000 });
    await expect(cinema).toHaveAttribute('data-act', 'track', { timeout: 15_000 });

    // Scrolled away, the loop stops.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the film is one composed still of Act I and never starts its loop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    const cinema = page.getByTestId('icons-cinema');
    const canvas = page.getByTestId('icons-cinema-canvas');
    await cinema.scrollIntoViewIfNeeded();
    await nextFrames(page);
    await expect(cinema).toHaveAttribute('data-playing', 'false');
    await expect(cinema).toHaveAttribute('data-act', 'obsidian');
    const still = await canvasPrint(canvas);
    expect(still).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(await canvasPrint(canvas)).toBe(still);
    // clamp(460px, 76vh, 760px) on a phone: 76vh of 800 px.
    expect(Math.round((await cinema.boundingBox()).height)).toBe(608);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('explore the lumen home', () => {
  test('a centred head, three 4:5 photographed rooms on a 16 px gutter whose films wake on hover, captions on the bare paper, then A culture of light', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.getByTestId('workspaces');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Explore the Lumen home');
    await expect(section.locator('.section-head')).toHaveCSS('text-align', 'center');
    await expect(section.locator('.section-head__lede')).toContainText('Start from a room, a part or the light itself.');

    const portraits = section.locator('.entry-card__portrait');
    await expect(portraits).toHaveCount(3);
    const pictures = section.getByTestId('interior-portrait');
    for (const [i, scene] of ['dining', 'bedroom', 'studio'].entries()) {
      const picture = pictures.nth(i);
      const media = ROOM_MEDIA[scene];
      await expect(picture).toHaveAttribute('data-scene', scene);
      await expect(picture).toHaveAttribute('aria-hidden', 'true');
      // A 1600 x 2000 photograph, decoded: data-painted reports it.
      const still = picture.locator('img');
      await expect(still).toHaveAttribute('src', mediaPath(media.still));
      await expect.poll(() => decodedWidth(still), { timeout: 15_000 }).toBeGreaterThanOrEqual(1200);
      expect(await still.evaluate((el) => el.naturalWidth / el.naturalHeight)).toBe(0.8);
      await expect(picture).toHaveAttribute('data-painted', 'true');
      // Its film waits on the first frame, the photograph, until it is asked for.
      const film = picture.locator('video');
      await expect(film).toHaveAttribute('preload', 'metadata');
      await expect(film).toHaveAttribute('poster', mediaPath(media.still));
      const sources = await film.locator('source').evaluateAll((els) => els.map((el) => [el.type, new URL(el.src).pathname]));
      expect(sources).toEqual([
        ['video/webm', `/media/rooms/${media.slug}.webm`],
        ['video/mp4', `/media/rooms/${media.slug}.mp4`],
      ]);
      expect(await film.evaluate((el) => ({ paused: el.paused, muted: el.muted, loop: el.loop }))).toEqual({ paused: true, muted: true, loop: true });
      // The hover glow is seated over the room's luminaire.
      const glow = await portraits.nth(i).evaluate((el) => [el.style.getPropertyValue('--glow-x'), el.style.getPropertyValue('--glow-y')]);
      expect(glow).toEqual([`${(INTERIOR_SCENES[scene].glow.x * 100).toFixed(1)}%`, `${(INTERIOR_SCENES[scene].glow.y * 100).toFixed(1)}%`]);
    }
    // Photographs, never procedural drawing: no SVG, canvas, filter or texture in a room.
    const rooms = await portraits.evaluateAll((els) =>
      els.map((el) => ({
        drawn: el.querySelectorAll('svg, canvas, filter, feTurbulence, pattern').length,
        textures: [el, ...el.querySelectorAll('*')].filter((node) => getComputedStyle(node).backgroundImage.includes('url(')).length,
      })),
    );
    for (const room of rooms) expect(room).toEqual({ drawn: 0, textures: 0 });

    // Boxes include transforms: measure once the staggered reveal has settled.
    await expect
      .poll(() => section.locator('.explore__cell').evaluateAll((els) => els.every((el) => el.hasAttribute('data-reveal-settled'))))
      .toBe(true);
    const boxes = await Promise.all((await portraits.all()).map((el) => el.boundingBox()));
    for (const box of boxes) {
      expect(box.width / box.height).toBeCloseTo(0.8, 2);
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
    }
    expect(Math.round(boxes[1].x - (boxes[0].x + boxes[0].width))).toBe(16);
    expect(Math.round(boxes[2].x - (boxes[1].x + boxes[1].width))).toBe(16);
    await expect(portraits.first()).toHaveCSS('border-top-left-radius', '0px');

    // The caption reads straight on the paper under each room.
    const cards = section.locator('.entry-card');
    await expect(cards).toHaveCount(3);
    for (const [i, href] of ['/room-3d', '/catalog', '/room-3d?lens=inside'].entries()) {
      await expect(cards.nth(i)).toHaveAttribute('href', href);
      const caption = cards.nth(i).locator('.entry-card__caption');
      expect((await caption.boundingBox()).y).toBeGreaterThanOrEqual(boxes[i].y + boxes[i].height - 1);
      await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(cards.nth(0)).toHaveAccessibleName(/02 \/ 3D Room\s+Room Planner/);
    await expect(cards.nth(2)).toHaveAccessibleName(/04 \/ Lighting\s+Lighting Studio/);
    await expect(section).not.toContainText('Wall Studio');

    // Hovering a room wakes its film: it plays, then crossfades in over the
    // photograph in 400 ms on the house ease, and its luminaire glows.
    const first = pictures.first();
    const firstFilm = first.locator('video');
    await expect(firstFilm).toHaveCSS('transition', /opacity 0\.4s cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    const glow = cards.first().locator('.entry-card__glow');
    await expect(glow).toHaveCSS('animation-play-state', 'paused');
    await cards.first().locator('.entry-card__portrait').hover();
    await expect(first).toHaveAttribute('data-video', 'playing', { timeout: 15_000 });
    const t0 = await playhead(firstFilm);
    await expect.poll(() => playhead(firstFilm)).toBeGreaterThan(t0);
    await expect.poll(() => firstFilm.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    await expect.poll(() => glow.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.95);
    await expect(glow).toHaveCSS('animation-name', 'interior-breathe');
    await expect(glow).toHaveCSS('animation-play-state', 'running');
    // Leaving rests it again: paused, faded out and back on its first frame.
    await page.mouse.move(4, 4);
    await expect.poll(() => firstFilm.evaluate((el) => el.paused)).toBe(true);
    await expect.poll(() => firstFilm.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(0);
    await expect.poll(() => playhead(firstFilm)).toBe(0);
    // The other rooms never woke.
    for (const i of [1, 2]) expect(await pictures.nth(i).locator('video').evaluate((el) => el.paused && el.currentTime === 0)).toBe(true);

    // A culture of light closes the section, centred under the rooms.
    const manifesto = page.getByTestId('culture-of-light');
    await expect(manifesto.getByRole('heading', { level: 3 })).toHaveText('A culture of light');
    await expect(manifesto).toHaveCSS('text-align', 'center');
    expect((await manifesto.boundingBox()).y).toBeGreaterThan(boxes[0].y + boxes[0].height);

    // Phones stack the rooms in one column without overflow.
    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await Promise.all((await portraits.all()).map((el) => el.boundingBox()));
    expect(narrow[1].y).toBeGreaterThan(narrow[0].y + narrow[0].height);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('overview bands and heads', () => {
  test('the dimming lab and the Nocturne theatre run edge to edge, and every overview head is centred, calm and unclipped', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      for (const [id, surface] of [
        ['surface-lab', 'rgb(239, 236, 229)'],
        ['home-3d-showcase', 'rgb(35, 37, 40)'],
      ]) {
        const band = page.getByTestId(id);
        await band.scrollIntoViewIfNeeded();
        expect(await edgeToEdge(page, band), `${id} ${width}px`).toEqual({ left: 0, gap: 0 });
        await expect(band).toHaveCSS('background-color', surface);
      }

      const heads = await page.locator('.home-atmosphere .section-head').all();
      expect(heads).toHaveLength(4);
      for (const head of heads) {
        await head.scrollIntoViewIfNeeded();
        await expect.poll(() => head.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        const facts = await head.evaluate((el) => {
          const title = el.querySelector('.section-head__title');
          const style = getComputedStyle(title);
          const range = document.createRange();
          range.selectNodeContents(title);
          const ink = [...range.getClientRects()];
          const box = title.getBoundingClientRect();
          let clipped = false;
          for (let node = title.parentElement; node && node !== document.body; node = node.parentElement) {
            if (['hidden', 'clip', 'scroll', 'auto'].includes(getComputedStyle(node).overflowY)) clipped = true;
          }
          return {
            align: getComputedStyle(el).textAlign,
            weight: style.fontWeight,
            size: Number.parseFloat(style.fontSize),
            leading: Number.parseFloat(style.lineHeight),
            inkTop: Math.min(...ink.map((rect) => rect.top)),
            inkBottom: Math.max(...ink.map((rect) => rect.bottom)),
            top: box.top,
            bottom: box.bottom,
            clipped,
          };
        });
        expect(facts.align).toBe('center');
        expect(facts.weight).toBe('380');
        expect(facts.size).toBeLessThanOrEqual(52.5);
        expect(facts.leading).toBeGreaterThanOrEqual(facts.size * 1.1);
        expect(facts.clipped).toBe(false);
        expect(facts.inkTop).toBeGreaterThanOrEqual(facts.top - 0.5);
        expect(facts.inkBottom).toBeLessThanOrEqual(facts.bottom + 0.5);
      }
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }

    // An old showcase deep link still lands the theatre head clear of the navbar.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#spatial-studio-3d');
    const showcase = page.getByTestId('home-3d-showcase');
    const clearance = () =>
      page.evaluate(() => {
        const nav = document.querySelector('.navbar').getBoundingClientRect();
        const label = document.querySelector('[data-testid="home-3d-showcase"] .section-head').getBoundingClientRect();
        return Math.round(label.top - nav.bottom);
      });
    await expect.poll(async () => {
      const gap = await clearance();
      return gap >= 40 && gap <= 64;
    }).toBe(true);
    expect(errors).toEqual([]);
  });
});
