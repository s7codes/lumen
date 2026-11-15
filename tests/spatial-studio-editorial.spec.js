import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PRODUCTS } from '../src/data/products.js';
import { BLUEPRINT_SCALE_LABEL, PAPER } from '../src/lib/blueprint-sheet.js';
import { DRIVERS } from '../src/lib/drivers.js';
import { BUS_RATED_W, BUS_VOLTAGE, DROP_LIMIT } from '../src/lib/electrical.js';
import { WALL_GRID } from '../src/lib/illuminance-field.js';
import { launchHref } from '../src/lib/launch-presets.js';
import { CATALOG_SIZE, productPhoto } from '../src/lib/media-manifest.js';
import { CAMERA_PITCH, CAMERA_YAW, ROOM_DEPTH, ROOM_HEIGHT, ROOM_SIZE_PRESETS, ROOM_STORAGE_KEY, ROOM_WIDTH } from '../src/lib/room-3d.js';
import { OCTAVE_BANDS } from '../src/lib/room-physics.js';
import { EYE_HEIGHT_CM, INSIDE_FOV, INSIDE_FOV_DEG, RUN_SPEED, WALK_SPEED } from '../src/lib/room-walkthrough.js';
import { SHOWCASE_3D_ID } from '../src/lib/routes.js';
import { STUDIO_PILLAR_IDS, STUDIO_PILLARS } from '../src/lib/studio-capabilities.js';
import { collectFailedResponses, collectRuntimeErrors, decodedWidth, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|RoomCanvas)-[\w-]+\.js$/;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const HEADINGS = ['01 / Four-Wall Envelope', '02 / 165 cm Eye-Level Walkthrough', '03 / 24V SELV Bus & Acoustic RT60', '04 / Architectural CAD Exports'];
const PRESETS = [
  ['orbit', launchHref({ lens: 'orbit' }), 'Launch 360 Orbit'],
  ['inside', launchHref({ lens: 'inside' }), 'Launch 165 cm Eye Level'],
  ['loft', launchHref({ scale: 'loft', lens: 'inside' }), 'Launch Grand Loft'],
];

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

/** Largest blur radius of any box-shadow inside the section: the gallery casts none. */
function maxShadowBlur(section) {
  return section.evaluate((root) =>
    Math.max(
      0,
      ...[root, ...root.querySelectorAll('*')].flatMap((el) => {
        const shadow = getComputedStyle(el).boxShadow;
        if (shadow === 'none') return [];
        return shadow.split(/,(?![^(]*\))/).map((layer) => Number.parseFloat((layer.match(/-?\d*\.?\d+px/g) ?? [])[2] ?? '0'));
      }),
    ),
  );
}

test.describe('3D spatial studio editorial grid', () => {
  test('every figure on the grid is the planner engines own figure, in plain ASCII', () => {
    expect(STUDIO_PILLAR_IDS).toEqual(['envelope', 'eye-level', 'bus', 'exports']);
    expect(STUDIO_PILLARS.map((pillar) => `${pillar.index} / ${pillar.title}`)).toEqual(HEADINGS);
    const figures = Object.fromEntries(STUDIO_PILLARS.map((pillar) => [pillar.id, Object.fromEntries(pillar.specs.map((row) => [row.label, row.value]))]));

    // 01: the envelope ranges and the orbit camera of src/lib/room-3d.js.
    expect(figures.envelope).toEqual({
      Width: `${ROOM_WIDTH.min} to ${ROOM_WIDTH.max} cm`,
      Length: `${ROOM_DEPTH.min} to ${ROOM_DEPTH.max} cm`,
      Height: `${ROOM_HEIGHT.min} to ${ROOM_HEIGHT.max} cm`,
      Orbit: `${CAMERA_YAW.max - CAMERA_YAW.min} deg yaw / ${CAMERA_PITCH.min} to ${CAMERA_PITCH.max} deg pitch`,
    });
    // 02: the walkthrough lens and pace of src/lib/room-walkthrough.js, the wall field of illuminance-field.js.
    expect(figures['eye-level']).toEqual({
      'Eye height': `${EYE_HEIGHT_CM} cm`,
      Lens: `${INSIDE_FOV_DEG} deg / ${INSIDE_FOV.min} to ${INSIDE_FOV.max} deg`,
      Pace: `${WALK_SPEED.forward} cm/s walk / ${RUN_SPEED.forward} cm/s run`,
      'Wall lux': `${WALL_GRID.cols} x ${WALL_GRID.rows} point grid`,
    });
    // 03: the bus rating, the boxed drivers, the drop limit and the Sabine octaves.
    const driverWatts = Object.keys(DRIVERS).map((id) => Number(id.replace('driver-', ''))).sort((a, b) => a - b);
    expect(figures.bus).toEqual({
      Bus: `${BUS_VOLTAGE}V DC SELV / ${BUS_RATED_W} W per run`,
      Drivers: `${driverWatts.join(' W and ')} W`,
      'Voltage drop': `${Math.round(DROP_LIMIT * 100)}% limit, hop by hop`,
      Acoustics: `RT60 / ${OCTAVE_BANDS[0]} Hz to ${OCTAVE_BANDS.at(-1) / 1000} kHz / STI`,
    });
    // 04: the ISO A3 sheet at 1:20, the R12 DXF writer, the OBJ writer and the schedule.
    expect(PAPER).toEqual({ widthMm: 420, heightMm: 297 });
    expect(readFileSync(new URL('../src/lib/dxf-export.js', import.meta.url), 'utf8')).toContain("pair(1, 'AC1009')");
    expect(figures.exports).toEqual({
      Elevation: `${BLUEPRINT_SCALE_LABEL} SVG / ISO A3`,
      CAD: 'AutoCAD R12 DXF',
      Model: 'Wavefront OBJ',
      Schedule: 'Bill of materials',
    });

    // Every picture is a shipped studio photograph of a real part in a finish it ships in.
    const photos = STUDIO_PILLARS.filter((pillar) => pillar.photo);
    expect(photos.map((pillar) => pillar.id)).toEqual(['envelope', 'eye-level', 'bus']);
    for (const { photo } of photos) {
      const product = PRODUCTS.find((entry) => entry.id === photo.product);
      expect(product?.finishes, photo.product).toContain(photo.finish);
      expect(productPhoto(product.id, photo.finish).src).toMatch(new RegExp(`^/media/catalog/${product.id}-${photo.finish}\\.webp\\?v=`));
    }
    // None of them repeats a Core Modules card below the grid.
    const flagships = PRODUCTS.filter((product) => product.flagship).map((product) => product.id);
    for (const { photo } of photos) expect(flagships).not.toContain(photo.product);

    for (const pillar of STUDIO_PILLARS) {
      for (const text of [pillar.title, pillar.summary, pillar.photo?.alt ?? '', ...pillar.specs.flatMap((row) => [row.label, row.value])]) {
        expect(/^[\x20-\x7e]*$/.test(text), text).toBe(true);
      }
    }
  });

  test('the section sits on the gallery paper like Core Modules: four 4:3 pictures over hairline specifications, a carbon rule, a matte carbon key and no video', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    const failed = collectFailedResponses(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const section = page.getByTestId('home-3d-showcase');
    await expect(section).toHaveAttribute('id', SHOWCASE_3D_ID);
    await section.evaluate((el) => el.scrollIntoView());

    // No theatre left: no film, no canvas, no chamber, no act keys.
    expect(await section.evaluate((el) => el.querySelectorAll('video, canvas, .theatre, .optical, [data-film], [data-act]').length)).toBe(0);
    await expect(section).not.toHaveClass(/(^|\s)optical(\s|$)/);
    // Warm architectural paper, carbon type: the section is transparent on the paper flow, like Core Modules.
    expect(await section.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.getByTestId('core-modules').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.getByTestId('home-atmosphere').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(250, 249, 246)');
    await expect(section.locator('.section-head .index-label')).toHaveText('03 / 3D Spatial Studio');
    const title = section.getByRole('heading', { level: 2 });
    await expect(title).toHaveText('Step inside a four-walled room before a single hole is drilled.');
    await expect(title).toHaveCSS('color', 'rgb(20, 19, 17)');
    await expect(title).toHaveCSS('font-weight', '380');

    // Four columns of one width, their pictures on one line, read once the staggered reveal has settled.
    const grid = page.getByTestId('studio-pillars');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    const cards = grid.getByRole('article');
    await expect(cards).toHaveCount(4);
    await grid.scrollIntoViewIfNeeded();
    for (const cell of await grid.locator(':scope > li').all()) await expect(cell).toHaveAttribute('data-reveal-settled', '');
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);
    }

    for (const [i, pillar] of STUDIO_PILLARS.entries()) {
      const card = page.getByTestId(`studio-pillar-${pillar.id}`);
      await card.scrollIntoViewIfNeeded();
      const heading = card.getByRole('heading', { level: 3 });
      await expect(heading).toHaveText(HEADINGS[i]);
      await expect(heading).toHaveCSS('text-transform', 'uppercase');
      await expect(heading).toHaveCSS('color', 'rgb(20, 19, 17)');
      await expect(heading).toHaveCSS('font-family', /Inter Tight/);
      await expect(card.locator('.showcase3d__summary')).toHaveText(pillar.summary);
      // One hairline under the card, square corners, no fill.
      const look = await card.evaluate((el) => {
        const style = getComputedStyle(el);
        return { rule: style.borderBottom, radius: style.borderTopLeftRadius, surface: style.backgroundColor };
      });
      expect(look).toEqual({ rule: '1px solid rgba(20, 19, 17, 0.14)', radius: '0px', surface: 'rgba(0, 0, 0, 0)' });
      // The specification: label and figure per row.
      const rows = await card.locator('.showcase3d__spec').evaluateAll((els) => els.map((el) => [el.querySelector('dt').textContent, el.querySelector('dd').textContent]));
      expect(rows).toEqual(pillar.specs.map((row) => [row.label, row.value]));

      // A 4:3 picture on the warm plinth of the product cards, or the drawing on its stone sheet.
      const figure = card.locator('.showcase3d__figure');
      const frame = await figure.boundingBox();
      expect(Math.abs(frame.width / frame.height - 4 / 3)).toBeLessThan(0.02);
      await expect(figure).toHaveCSS('border-top-left-radius', '0px');
      if (pillar.photo) {
        await expect(figure).toHaveCSS('background-color', 'rgb(228, 221, 209)');
        const img = figure.locator('img');
        await expect(img).toHaveAttribute('alt', pillar.photo.alt);
        expect(new URL(await img.evaluate((el) => el.currentSrc || el.src)).pathname).toBe(`/media/catalog/${pillar.photo.product}-${pillar.photo.finish}.webp`);
        await expect.poll(() => decodedWidth(img), { timeout: 15_000 }).toBe(CATALOG_SIZE.width);
      } else {
        await expect(figure).toHaveCSS('background-color', 'rgb(243, 240, 232)');
        const drawing = figure.getByTestId('studio-elevation');
        await expect(drawing).toBeVisible();
        await expect(drawing).toHaveAttribute('viewBox', '0 0 400 300');
        const notes = await drawing.locator('text').allTextContents();
        expect(notes).toEqual(expect.arrayContaining(['NORTH ELEVATION', 'SCALE 1:20', '320', '250']));
        for (const note of notes) expect(/^[\x20-\x7e]+$/.test(note), note).toBe(true);
      }
    }

    // One carbon rule closes the grid: the presets on the left, the matte carbon key on the right.
    const foot = page.getByTestId('showcase-launchpad');
    await foot.scrollIntoViewIfNeeded();
    await expect(foot).toHaveAttribute('data-reveal-settled', '');
    await expect(foot).toHaveCSS('border-top', '1px solid rgb(20, 19, 17)');
    const cta = page.getByTestId('launch-3d-studio-cta');
    await expect(cta).toHaveText('Open 3D Room Planner');
    await expect(cta).toHaveAttribute('href', '/room-3d');
    await expect(cta).toHaveCSS('background-color', 'rgb(20, 19, 17)');
    await expect(cta).toHaveCSS('color', 'rgb(250, 249, 246)');
    await expect(cta).toHaveCSS('text-transform', 'uppercase');
    await expect(cta).toHaveCSS('height', '52px');
    await expect(cta).toHaveCSS('border-top-left-radius', '0px');
    await expect(cta.locator('svg')).toBeVisible();
    for (const [id, href, name] of PRESETS) {
      const link = page.getByTestId(`launch-preset-${id}`);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAccessibleName(name);
    }
    const [footBox, ctaBox, presetBox] = await Promise.all([foot.boundingBox(), cta.boundingBox(), page.getByTestId('launch-preset-orbit').boundingBox()]);
    expect(presetBox.x).toBeLessThan(ctaBox.x);
    expect(Math.abs(ctaBox.x + ctaBox.width - (footBox.x + footBox.width))).toBeLessThanOrEqual(1);
    expect(await maxShadowBlur(section)).toBe(0);

    // The grid hands straight on to Core Modules, on the same paper and the same grid.
    const modules = page.getByTestId('core-modules');
    const [sectionBox, modulesBox, modulesGrid, studioGrid] = await Promise.all([section.boundingBox(), modules.boundingBox(), modules.locator('.modules__grid').boundingBox(), grid.boundingBox()]);
    expect(modulesBox.y).toBeGreaterThanOrEqual(sectionBox.y + sectionBox.height - 1);
    expect(Math.abs(modulesGrid.x - studioGrid.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(modulesGrid.width - studioGrid.width)).toBeLessThanOrEqual(1);

    // A cold overview never fetched the planner or its WebGL engine.
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
    expect(failed).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the key opens the planner and the Grand Loft preset lands at eye level in 800 x 650 x 340 cm', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cta = page.getByTestId('launch-3d-studio-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('showcase-launchpad')).toHaveAttribute('data-reveal-settled', '');
    // Keys stay where they are under the pointer: only the arrows travel, and the carbon key deepens a step.
    for (const key of [cta, page.getByTestId('launch-preset-loft')]) {
      const rest = await key.boundingBox();
      await key.hover();
      await expect.poll(() => key.locator('svg').last().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e)).toBeGreaterThan(0);
      const held = await key.boundingBox();
      expect(Math.abs(held.x - rest.x) + Math.abs(held.y - rest.y)).toBeLessThan(0.5);
      if (key === cta) await expect(cta).toHaveCSS('background-color', 'rgb(43, 41, 37)');
    }

    const loft = ROOM_SIZE_PRESETS.find((preset) => preset.id === 'loft');
    await page.getByTestId('launch-preset-loft').click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const stage = page.getByTestId('room-viewport');
    await expect(stage).toHaveAttribute('data-room-width', String(loft.widthCm));
    await expect(stage).toHaveAttribute('data-room-depth', String(loft.depthCm));
    await expect(stage).toHaveAttribute('data-room-height', String(loft.heightCm));
    await expect(page.getByTestId('room-preset-loft')).toHaveAttribute('aria-pressed', 'true');
    const walk = page.getByTestId('room-walkthrough-state');
    await expect(walk).toHaveAttribute('data-camera-mode', 'inside');
    await expect(walk).toHaveAttribute('data-fov-deg', String(INSIDE_FOV_DEG));
    await expect(page.getByTestId('room-notice')).toHaveText('Launched Grand Loft 800 x 650 x 340 cm, Inside Room (165 cm) lens.');
    await expect.poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY))?.room?.widthCm).toBe(loft.widthCm);

    // Back on the overview, the key itself opens the planner as left.
    await page.goto(`/#${SHOWCASE_3D_ID}`);
    await expect(page.getByTestId('home-3d-showcase').getByRole('heading', { level: 2 })).toBeInViewport();
    await page.getByTestId('launch-3d-studio-cta').click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByTestId('room-viewport')).toHaveAttribute('data-room-width', String(loft.widthCm));
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('at phone width the grid stacks to one column and the key leads the launch rule, without overflow', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#${SHOWCASE_3D_ID}`);
    const section = page.getByTestId('home-3d-showcase');
    await expect(section.getByRole('heading', { level: 2 })).toBeInViewport();
    const grid = page.getByTestId('studio-pillars');
    expect(await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    const boxes = await Promise.all((await grid.getByRole('article').all()).map((card) => card.boundingBox()));
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height);

    const foot = page.getByTestId('showcase-launchpad');
    await foot.scrollIntoViewIfNeeded();
    const [footBox, ctaBox] = await Promise.all([foot.boundingBox(), page.getByTestId('launch-3d-studio-cta').boundingBox()]);
    expect(ctaBox.width).toBeGreaterThanOrEqual(footBox.width - 1);
    const presetBoxes = await Promise.all(PRESETS.map(([id]) => page.getByTestId(`launch-preset-${id}`).boundingBox()));
    expect(presetBoxes[0].y).toBeGreaterThan(ctaBox.y + ctaBox.height);
    for (let i = 1; i < presetBoxes.length; i += 1) expect(presetBoxes[i].y).toBeGreaterThan(presetBoxes[i - 1].y);
    for (const box of presetBoxes) expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
