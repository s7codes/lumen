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
  conePath,
  convexHull,
  galleryWeight,
  HERO_CROSSFADE_SECONDS,
  HERO_CYCLE_SECONDS,
  HERO_HOLD_SECONDS,
  HERO_SCENE_IDS,
  heroSceneAt,
  heroSceneGeometry,
  herringbonePlanks,
  roomCamera,
  spotScallop,
} from '../src/lib/hero-scenes.js';
import { createRoom, INTERIOR_SCENE_IDS, INTERIOR_VIEW, interiorScene } from '../src/lib/interior-painter.js';
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

/** Vertices of an "M x yL x y ... Z" polygon path. */
function polygonPoints(d) {
  return d
    .slice(1, -1)
    .split('L')
    .map((pair) => pair.split(' ').map(Number));
}

/** Point in a convex polygon (either winding), edges included. */
function insideConvex(points, [x, y]) {
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(cross) < 1e-6) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
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

    // Each room is smooth vectors only: crisp paths painted in a hex colour or
    // a gradient of its own drawing, finite geometry, the luminaire in frame.
    for (const id of INTERIOR_SCENE_IDS) {
      const art = interiorScene(id);
      expect(art.id).toBe(id);
      expect(art.shapes.length, id).toBeGreaterThan(100);
      expect(art.defs.every((def) => ['linear', 'radial', 'clip'].includes(def.type)), id).toBe(true);
      const ids = new Set(art.defs.map((def) => def.id));
      for (const shape of art.shapes) {
        expect(shape.paint === 'none' || /^#[0-9a-f]{6}$/.test(shape.paint) || ids.has(shape.paint), `${id} ${shape.paint}`).toBe(true);
        expect(shape.d, id).not.toMatch(/NaN|Infinity|undefined/);
      }
      expect(art.glow.x).toBeGreaterThan(0);
      expect(art.glow.x).toBeLessThan(1);
      expect(art.glow.y).toBeGreaterThan(0);
      expect(art.glow.y).toBeLessThan(1);
    }
    expect(interiorScene('unknown').id).toBe('dining');
    expect(INTERIOR_VIEW).toEqual({ width: 600, height: 800 });
  });

  test('the hero clock holds each scene 5 s and crossfades 1.1 s, and its rooms are true perspective', () => {
    expect(HERO_SCENE_IDS).toEqual(['wall-wash', 'gallery']);
    expect(HERO_HOLD_SECONDS).toBe(5);
    expect(HERO_CROSSFADE_SECONDS).toBe(1.1);
    expect(HERO_CYCLE_SECONDS).toBeCloseTo(12.2, 9);
    expect(galleryWeight(0)).toBe(0);
    expect(galleryWeight(4.99)).toBe(0);
    expect(galleryWeight(5.55)).toBeCloseTo(0.5, 6);
    expect(galleryWeight(6.1)).toBe(1);
    expect(galleryWeight(11.09)).toBe(1);
    expect(galleryWeight(11.65)).toBeCloseTo(0.5, 6);
    expect(galleryWeight(12.2 + 2)).toBe(0);
    expect(galleryWeight(Number.NaN)).toBe(0);
    let last = -1;
    for (let t = 5; t <= 6.1; t += 0.05) {
      expect(galleryWeight(t)).toBeGreaterThanOrEqual(last);
      last = galleryWeight(t);
    }
    expect(heroSceneAt(1)).toBe('wall-wash');
    expect(heroSceneAt(8)).toBe('gallery');

    // One-point perspective: the back wall spans its rows, and depth scales lateral offsets.
    const camera = roomCamera({ floorY: 765, ceilingY: 40, height: 280, eyeY: 150, depth: 500, vx: 1000 });
    expect(camera.project(0, 0, 500)[1]).toBeCloseTo(765, 6);
    expect(camera.project(0, 280, 500)[1]).toBeCloseTo(40, 6);
    expect(camera.project(100, 150, 250)[0] - 1000).toBeCloseTo(2 * (camera.project(100, 150, 500)[0] - 1000), 6);

    // Herringbone: two plank families of near equal count, every plank L x W.
    const planks = herringbonePlanks({ width: 9, length: 54, xMin: -100, xMax: 100, zMin: 300, zMax: 400 });
    expect(planks.along.length).toBeGreaterThan(20);
    expect(Math.abs(planks.along.length - planks.across.length)).toBeLessThanOrEqual(planks.along.length * 0.2);
    for (const plank of [...planks.along.slice(0, 5), ...planks.across.slice(0, 5)]) {
      const sides = plank.map((p, i) => Math.hypot(plank[(i + 1) % 4][0] - p[0], plank[(i + 1) % 4][1] - p[1]));
      expect(Math.max(...sides)).toBeCloseTo(54, 6);
      expect(Math.min(...sides)).toBeCloseTo(9, 6);
    }

    // A wall-wash cone is a hyperbola: symmetric about its axis, widening with reach.
    const d = conePath({ x: 100, y0: 50, dir: 1, reach: 300, halfWidth: 10, knee: 40, steps: 12 });
    const points = d.slice(1, -1).split('L').map((pair) => pair.split(' ').map(Number));
    expect(points[0]).toEqual([90, 50]);
    expect(points.at(-1)).toEqual([110, 50]);
    const foot = points[12];
    expect(foot[1]).toBe(350);
    expect(100 - foot[0]).toBeCloseTo(10 * Math.sqrt(1 + (300 / 40) ** 2), 1);

    // A spot leaning toward a wall: its scallop arches where the wall-side
    // generator lands, is symmetric about the spot and opens toward the floor
    // while the lean stays under the half angle.
    const lean = spotScallop({ apex: [0, 290, 400], wallZ: 420, tilt: 0.1, halfAngle: 0.2, untilY: 100 });
    expect(lean.top).toBeCloseTo(290 - 20 / Math.tan(0.3), 6);
    expect(lean.halfWidth(lean.top + 0.01)).toBe(0);
    expect(lean.bottom).toBe(100);
    expect(lean.halfWidth(150)).toBeGreaterThan(lean.halfWidth(200));
    expect(Math.abs(lean.outline[0][0])).toBeLessThan(1e-3);
    expect(lean.outline[0][1]).toBe(lean.top);
    for (let i = 0; i < 10; i += 1) expect(lean.outline[i][0]).toBeCloseTo(-lean.outline.at(-1 - i)[0], 9);
    // Leaning past the half angle closes the scallop into an ellipse above the floor.
    const steep = spotScallop({ apex: [0, 290, 400], wallZ: 420, tilt: 0.5, halfAngle: 0.2, untilY: 0 });
    expect(steep.bottom).toBeCloseTo(290 - 20 / Math.tan(0.3), 6);
    expect(convexHull([[0, 0], [2, 0], [1, 1], [1, 0.2], [2, 2], [0, 2]])).toHaveLength(4);

    // Scene II: each grazer's light is one cone from its own aperture. The
    // beam starts on the aperture rim, never below it, and holds both the
    // aperture centre and the arch of the scallop it lays on the limestone.
    const { spots } = heroSceneGeometry().gallery;
    expect(spots).toHaveLength(2);
    for (const spot of spots) {
      const beam = polygonPoints(spot.beam);
      const rimTop = Math.min(...spot.apertureRim.map(([, y]) => y));
      expect(Math.min(...beam.map(([, y]) => y))).toBeCloseTo(rimTop, 0);
      expect(insideConvex(beam, spot.apex)).toBe(true);
      expect(insideConvex(beam, spot.scallopTop)).toBe(true);
      expect(spot.scallopTop[1]).toBeGreaterThan(spot.apex[1]);
      // The beam's gradient runs from the aperture down past the arch.
      expect(spot.beamEnd[1]).toBeGreaterThan(spot.scallopTop[1]);
    }
  });
});

test.describe('light architectural hero', () => {
  test('two smooth light interiors alternate on a 5 s hold and 1.1 s crossfade, with crisp 2700K cones and no text on the pictures', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    await expect(hero).toHaveAttribute('data-scenes', 'wall-wash gallery');
    expect(await edgeToEdge(page, hero)).toEqual({ left: 0, gap: 0 });
    // Smooth matte sand-stone, never a dark chamber.
    await expect(hero).toHaveCSS('background-color', 'rgb(198, 185, 165)');
    await expect(hero).not.toHaveClass(/(^|\s)optical(\s|$)/);

    // Both scenes are inline SVG interiors; the gallery crossfades over the wall wash.
    const wallWash = hero.locator('svg.hero-scene--wall-wash');
    const gallery = hero.locator('svg.hero-scene--gallery');
    await expect(wallWash).toHaveCount(1);
    await expect(gallery).toHaveCount(1);
    const motion = await gallery.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        name: style.animationName,
        duration: style.animationDuration,
        count: style.animationIterationCount,
        timing: style.animationTimingFunction,
        state: style.animationPlayState,
      };
    });
    expect(motion).toEqual({ name: 'hero-scene-cycle', duration: '12.2s', count: 'infinite', timing: 'cubic-bezier(0.45, 0, 0.55, 1)', state: 'running' });
    // Seek the CSS clock: 5 s hold, 1.1 s crossfade, 5 s hold, 1.1 s back.
    const opacityAt = (ms) =>
      gallery.evaluate((el, at) => {
        const [animation] = el.getAnimations();
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
    await gallery.evaluate((el) => el.getAnimations()[0].play());

    // Zero cloudy noise: no SVG turbulence filters and no texture images anywhere in the hero.
    const noise = await hero.evaluate((el) => {
      const images = [el, ...el.querySelectorAll('*')].map((node) => getComputedStyle(node).backgroundImage).filter((image) => image !== 'none');
      return {
        filters: el.querySelectorAll('filter, feTurbulence').length,
        textures: images.filter((image) => image.includes('url(')).length,
      };
    });
    expect(noise).toEqual({ filters: 0, textures: 0 });

    // Crisp light: the sconce throws a hyperbolic up and down cone, each a
    // #fffdf7 core falling into a #f5e2c0 halo, drawn with a hard edge.
    for (const id of ['hw-up-main', 'hw-down-main']) {
      const stops = await hero.locator(`#${id} stop`).evaluateAll((els) => els.map((el) => el.getAttribute('stop-color')));
      expect(stops[0], id).toBe('#fffdf7');
      expect(stops.at(-1), id).toBe('#f5e2c0');
      await expect(wallWash.locator(`path[fill="url(#${id})"]`), id).toHaveCount(1);
    }
    // The gallery: a recessed 24V track slot, a pendant that pools gold on the console, a lit walnut shelf.
    await expect(gallery.locator('path[fill="url(#hg-wash)"]')).toHaveCount(1);
    await expect(gallery.locator('[data-depth="pendant"] path[fill="url(#hg-beam)"]')).toHaveCount(1);
    // Each track spot's light is drawn from its own aperture: in the rendered
    // picture the beam's top edge is the aperture's, as wide, and runs on below it.
    const anchors = await gallery.evaluate((svg) =>
      [...svg.querySelectorAll('[data-spot-beam]')].map((beam) => {
        const aperture = svg.querySelector(`[data-spot-aperture="${beam.dataset.spotBeam}"]`).getBBox();
        const box = beam.getBBox();
        return {
          gap: Math.abs(box.y - aperture.y),
          spans: box.x <= aperture.x + 0.5 && box.x + box.width >= aperture.x + aperture.width - 0.5,
          below: box.y + box.height > aperture.y + aperture.height + 100,
        };
      }),
    );
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(anchor.gap).toBeLessThan(0.5);
      expect(anchor).toMatchObject({ spans: true, below: true });
    }

    // No text overlays on the pictures: the only words in the hero are the copy.
    await expect(hero.locator('.hero__tag, .hero__readout, .hero__atmosphere')).toHaveCount(0);
    expect(await hero.locator('.hero__stage').evaluate((el) => el.textContent.trim())).toBe('');

    // The copy: carbon ink over the plaster, an attribution and a bracketed key.
    const copy = page.getByTestId('hero-copy');
    await expect(copy.locator('.index-label')).toHaveCount(0);
    await expect(copy).not.toContainText('Overview');
    await expect(copy).not.toContainText('2D');
    await expect(page.locator('.hero__title')).toHaveCSS('color', 'rgb(20, 19, 17)');
    const attribution = page.getByTestId('hero-attribution');
    await expect(attribution).toHaveText(/^Architectural Lighting & Modular\s+Systems\s*\/\s*24V\s+DC$/);
    await expect(attribution).toHaveCSS('text-transform', 'uppercase');
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

    // Cursor parallax: the pendant slides with the pointer along its track.
    const box = await hero.boundingBox();
    const pendant = hero.locator('[data-depth="pendant"]');
    const travel = () => pendant.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).e);
    await page.mouse.move(box.x + box.width * 0.74, box.y + box.height * 0.34);
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.34, { steps: 8 });
    await expect.poll(travel).toBeLessThan(-20);
    await page.mouse.move(box.x + box.width * 0.5, 5);

    // Out of view the clock holds its place; back in view it runs again.
    await page.evaluate(() => window.scrollTo(0, document.querySelector('[data-testid="ambient-surface"]').offsetHeight + 400));
    await expect(hero).toHaveAttribute('data-offscreen', '');
    await expect(gallery).toHaveCSS('animation-play-state', 'paused');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(hero).not.toHaveAttribute('data-offscreen');
    await expect(gallery).toHaveCSS('animation-play-state', 'running');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the hero rests on the wall wash: no crossfade, no parallax', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const hero = page.getByTestId('ambient-surface');
    const gallery = hero.locator('svg.hero-scene--gallery');
    await expect(gallery).toHaveCSS('animation-name', 'none');
    await expect(gallery).toHaveCSS('opacity', '0');
    for (const depth of ['far', 'near', 'pendant']) {
      await expect(hero.locator(`[data-depth="${depth}"]`).first(), depth).toHaveCSS('transform', 'none');
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
  test('a centred head, three 3:4 vector rooms on a 16 px gutter, captions on the bare paper, then A culture of light', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.getByTestId('workspaces');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Explore the Lumen home');
    await expect(section.locator('.section-head')).toHaveCSS('text-align', 'center');
    await expect(section.locator('.section-head__lede')).toContainText('Start from a room, a part or the light itself.');

    const portraits = section.locator('.entry-card__portrait');
    await expect(portraits).toHaveCount(3);
    const canvases = section.getByTestId('interior-portrait');
    for (const [i, scene] of ['dining', 'bedroom', 'studio'].entries()) {
      await expect(canvases.nth(i)).toHaveAttribute('data-scene', scene);
      await expect(canvases.nth(i)).toHaveAttribute('data-painted', scene);
      await expect(canvases.nth(i)).toHaveAttribute('aria-hidden', 'true');
    }
    // Smooth architectural vectors, never procedural noise: inline SVG with
    // no canvas, filter, turbulence, pattern or bitmap, every path painted in
    // a flat colour or a gradient that lives in its own picture.
    const pictures = await portraits.evaluateAll((els) =>
      els.map((el) => {
        const svg = el.querySelector('[data-testid="interior-portrait"]');
        // The painted shapes: the picture's own paths, not the outlines inside its clip paths.
        const fills = [...svg.querySelectorAll(':scope > path')].map((path) => path.getAttribute('fill'));
        return {
          tag: svg.tagName.toLowerCase(),
          canvases: el.querySelectorAll('canvas').length,
          noise: svg.querySelectorAll('filter, feTurbulence, pattern, image').length,
          flat: fills.every((fill) => fill === 'none' || /^#[0-9a-f]{6}$/.test(fill) || /^url\(#[a-z0-9-]+\)$/.test(fill)),
          unresolved: fills.filter((fill) => fill.startsWith('url(') && !svg.querySelector(fill.slice(4, -1))).length,
          gradients: svg.querySelectorAll('linearGradient, radialGradient').length,
          textures: [el, ...el.querySelectorAll('*')].filter((node) => getComputedStyle(node).backgroundImage.includes('url(')).length,
        };
      }),
    );
    for (const picture of pictures) {
      expect(picture).toMatchObject({ tag: 'svg', canvases: 0, noise: 0, flat: true, unresolved: 0, textures: 0 });
      expect(picture.gradients).toBeGreaterThan(20);
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
    for (const [i, href] of ['/room-3d', '/catalog', '/room-3d?lens=inside'].entries()) {
      await expect(cards.nth(i)).toHaveAttribute('href', href);
      const caption = cards.nth(i).locator('.entry-card__caption');
      expect((await caption.boundingBox()).y).toBeGreaterThanOrEqual(boxes[i].y + boxes[i].height - 1);
      await expect(caption).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    await expect(cards.nth(0)).toHaveAccessibleName(/02 \/ 3D Room\s+Room Planner/);
    await expect(cards.nth(2)).toHaveAccessibleName(/04 \/ Lighting\s+Lighting Studio/);
    await expect(section).not.toContainText('Wall Studio');

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
