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
import { createRoom, INTERIOR_SCENE_IDS } from '../src/lib/interior-painter.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

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
    expect(CINEMA_ACT_IDS).toEqual(['obsidian', 'aperture', 'sconce']);
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

    // The interiors are true one-point perspectives: the back wall is the
    // picture plane scaled about the eye, and every room has a painter.
    expect(INTERIOR_SCENE_IDS).toEqual(['dining', 'bedroom', 'studio']);
    const room = createRoom(300, 400, { vpx: 0.5, horizon: 0.44, depth: 0.5 });
    const [bx0, by0] = room.project(0, 0, 0);
    const [bx1] = room.project(1, 0, 0);
    const [fx0, fy0] = room.project(0, 0, 1);
    const [fx1] = room.project(1, 0, 1);
    expect((bx1 - bx0) / (fx1 - fx0)).toBeCloseTo(0.5, 6);
    expect(fy0).toBeCloseTo(400, 6);
    expect(by0).toBeLessThan(fy0);
  });
});

test.describe('plaster hero', () => {
  test('the hero is a full-bleed plaster wall breathing between two atmospheres on a 6.5 s clock, with an attribution and a bracketed key', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    await expect(hero).toHaveAttribute('data-atmospheres', 'venetian limestone');
    expect(await edgeToEdge(page, hero)).toEqual({ left: 0, gap: 0 });
    await expect(hero).toHaveCSS('background-color', 'rgb(44, 40, 36)');

    // One crossfade clock: the limestone wall and the 2400K wash rise while
    // the 2700K wash and its caption fall, held at each end, eased between.
    const motion = (selector) =>
      hero.locator(selector).evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          name: style.animationName,
          duration: style.animationDuration,
          direction: style.animationDirection,
          count: style.animationIterationCount,
          timing: style.animationTimingFunction,
          state: style.animationPlayState,
        };
      });
    const clock = { duration: '6.5s', direction: 'alternate', count: 'infinite', timing: 'cubic-bezier(0.45, 0, 0.55, 1)', state: 'running' };
    for (const [selector, name] of [
      ['.hero__plaster--limestone', 'hero-atmosphere-in'],
      ['.hero__wash:not(.hero__wash--evening)', 'hero-atmosphere-out'],
      ['.hero__wash--evening', 'hero-atmosphere-in'],
      ['.hero__atmosphere-name--venetian', 'hero-atmosphere-out'],
      ['.hero__atmosphere-name--limestone', 'hero-atmosphere-in'],
    ]) {
      expect(await motion(selector), selector).toEqual({ name, ...clock });
    }
    await expect(hero.locator('.hero__atmosphere-name--venetian')).toHaveText('Warm Venetian Plaster / 2700K');
    await expect(hero.locator('.hero__atmosphere-name--limestone')).toHaveText('Soft Limestone Evening Wash / 2400K');
    const limestone = () => hero.locator('.hero__plaster--limestone').evaluate((el) => Number(getComputedStyle(el).opacity));
    await expect.poll(limestone, { timeout: 10_000 }).toBeGreaterThan(0.05);

    // An architectural attribution replaces the old section index.
    const copy = page.getByTestId('hero-copy');
    await expect(copy.locator('.index-label')).toHaveCount(0);
    await expect(copy).not.toContainText('Overview');
    const attribution = page.getByTestId('hero-attribution');
    await expect(attribution).toHaveText(/^Architectural Lighting & Modular\s+Systems\s*\/\s*24V\s+DC$/);
    await expect(attribution).toHaveCSS('text-transform', 'uppercase');

    // The secondary key is bracketed: two vertical hairlines, no top or bottom edge.
    const bracket = page.getByTestId('hero-room-planner');
    await expect(bracket).toHaveAttribute('href', '/room-3d');
    await expect(bracket).toHaveText('Open Room Planner');
    const frame = await bracket.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        left: `${style.borderLeftWidth} ${style.borderLeftStyle}`,
        right: `${style.borderRightWidth} ${style.borderRightStyle}`,
        top: style.borderTopWidth,
        bottom: style.borderBottomWidth,
        radius: style.borderTopLeftRadius,
        surface: style.backgroundColor,
        transform: style.textTransform,
        shadow: style.boxShadow,
      };
    });
    expect(frame).toEqual({ left: '1px solid', right: '1px solid', top: '0px', bottom: '0px', radius: '0px', surface: 'rgba(0, 0, 0, 0)', transform: 'uppercase', shadow: 'none' });

    // Out of view the wall holds its breath; back in view it breathes again.
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="ambient-surface"]').offsetHeight + 400));
    await expect(hero).toHaveAttribute('data-offscreen', '');
    await expect(hero.locator('.hero__plaster--limestone')).toHaveCSS('animation-play-state', 'paused');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(hero).not.toHaveAttribute('data-offscreen');
    await expect(hero.locator('.hero__plaster--limestone')).toHaveCSS('animation-play-state', 'running');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the wall rests on Warm Venetian Plaster with no crossfade', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    for (const selector of ['.hero__plaster--limestone', '.hero__wash--evening', '.hero__atmosphere-name--limestone']) {
      await expect(hero.locator(selector), selector).toHaveCSS('animation-name', 'none');
      await expect(hero.locator(selector), selector).toHaveCSS('opacity', '0');
    }
    await expect(hero.locator('.hero__atmosphere-name--venetian')).toHaveCSS('opacity', '1');
    await expect(hero.locator('.hero__wash:not(.hero__wash--evening)')).toHaveCSS('opacity', '1');
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

    // The frames move, and the acts advance with their caption.
    const first = await canvasPrint(canvas);
    await expect.poll(() => canvasPrint(canvas)).not.toBe(first);
    await expect(cinema).toHaveAttribute('data-act', 'aperture', { timeout: 15_000 });
    await expect(cinema.locator('[data-cinema-caption]')).toHaveText('Act II / Triple-Aperture Optical Diffuser');

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
  test('a centred head, three 3:4 painted rooms on a 16 px gutter, captions on the bare paper, then A culture of light', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.getByTestId('workspaces');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Explore the Lumen home');
    await expect(section.locator('.section-head')).toHaveCSS('text-align', 'center');
    await expect(section.locator('.section-head__lede')).toContainText('Start from a room, a part or a wall.');

    const portraits = section.locator('.entry-card__portrait');
    await expect(portraits).toHaveCount(3);
    const canvases = section.getByTestId('interior-portrait');
    for (const [i, scene] of ['dining', 'bedroom', 'studio'].entries()) {
      await expect(canvases.nth(i)).toHaveAttribute('data-scene', scene);
      await expect(canvases.nth(i)).toHaveAttribute('data-painted', scene);
      await expect(canvases.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
    // Boxes include transforms: measure once the staggered reveal has settled.
    await expect
      .poll(() => section.locator('.explore__cell').evaluateAll((els) => els.every((el) => el.hasAttribute('data-reveal-settled'))))
      .toBe(true);
    const boxes = await Promise.all((await portraits.all()).map((el) => el.boundingBox()));
    for (const box of boxes) {
      expect(box.width / box.height).toBeCloseTo(0.75, 2);
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
    }
    expect(Math.round(boxes[1].x - (boxes[0].x + boxes[0].width))).toBe(16);
    expect(Math.round(boxes[2].x - (boxes[1].x + boxes[1].width))).toBe(16);
    await expect(portraits.first()).toHaveCSS('border-top-left-radius', '0px');

    // The caption reads straight on the paper under each room.
    const cards = section.locator('.entry-card');
    await expect(cards).toHaveCount(3);
    for (const [i, href] of ['/room-3d', '/catalog', '/studio-2d'].entries()) {
      await expect(cards.nth(i)).toHaveAttribute('href', href);
      const caption = cards.nth(i).locator('.entry-card__caption');
      expect((await caption.boundingBox()).y).toBeGreaterThanOrEqual(boxes[i].y + boxes[i].height - 1);
      await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(cards.nth(0)).toHaveAccessibleName(/02 \/ 3D Room\s+Room Planner/);

    // Hovering a room lets its luminaire breathe on the compositor.
    const glow = cards.first().locator('.entry-card__glow');
    await expect(glow).toHaveCSS('animation-play-state', 'paused');
    await cards.first().locator('.entry-card__portrait').hover();
    await expect.poll(() => glow.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.95);
    await expect(glow).toHaveCSS('animation-name', 'interior-breathe');
    await expect(glow).toHaveCSS('animation-play-state', 'running');

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

    // The 3D Room key glides to the theatre and lands its head clear of the navbar.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('nav-3d-showcase').click();
    const showcase = page.getByTestId('home-3d-showcase');
    await expect(showcase).toBeFocused();
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
