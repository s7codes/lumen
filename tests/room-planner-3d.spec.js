import { expect, test } from '@playwright/test';
import { getFinish, getProduct } from '../src/data/products.js';
import { BAG_STORAGE_KEY, recommendPsu } from '../src/lib/bag.js';
import { formatUsd } from '../src/lib/format.js';
import {
  CAMERA_PITCH,
  CAMERA_YAW,
  createRoomState,
  furnitureLayout,
  ROOM_FORMAT,
  ROOM_STORAGE_KEY,
  ROOM_VERSION,
  sanitizeCamera,
  sanitizeRoomState,
} from '../src/lib/room-3d.js';
import { buildScene, cameraFrame, cameraFromPosition, cameraPosition, orbitLimits } from '../src/lib/room-scene.js';
import { aggregateBagLines, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const BAG_KEY = `lumen:${BAG_STORAGE_KEY}`;

const MARK_GEOMETRY = {
  spine: { x: '3', y: '3', width: '4', height: '18' },
  base: { x: '3', y: '17', width: '18', height: '4' },
  cantilever: { x: '10', y: '3', width: '11', height: '3.5' },
  aperture: { x: '14.25', y: '8.5', width: '2', height: '6.5' },
};

async function openRoom(page) {
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

function viewport(page) {
  return page.getByTestId('room-viewport');
}

/**
 * Hit-tests the centre of a HUD control the way a real pointer would. The
 * stage clips with overflow: hidden, so a control that leaks past it is
 * painted over by the controls column or, after a scroll, the sticky navbar.
 */
async function expectUnoccluded(locator) {
  await locator.scrollIntoViewIfNeeded();
  const probe = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const stage = el.closest('.workspace-frame__viewport').getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      onTarget: Boolean(hit) && el.contains(hit),
      inControls: Boolean(hit?.closest('.room3d-layout__controls')),
      inNavbar: Boolean(hit?.closest('.navbar')),
      insideStage:
        box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom,
    };
  });
  expect(probe).toEqual({ onTarget: true, inControls: false, inNavbar: false, insideStage: true });
}

// Scene nodes live in the hidden scene-graph mirror next to the WebGL canvas.
function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
}

function roomLights(page, uid) {
  return page.locator(`[data-testid="room-light"][data-uid="${uid}"]`);
}

/** Waits for the lazy WebGL chunk and returns 'webgl2', 'webgl' or 'unavailable'. */
async function rendererOf(page) {
  await expect(viewport(page)).not.toHaveAttribute('data-renderer', 'loading', { timeout: 20_000 });
  return viewport(page).getAttribute('data-renderer');
}

/**
 * Clicks a module where it is actually drawn on the canvas, so selection goes
 * through the WebGL raycaster. Falls back to the module list without WebGL.
 */
async function pickInScene(page, uid, name) {
  if ((await rendererOf(page)) === 'unavailable') {
    await page.getByTestId('room-module-list').getByRole('button', { name }).click();
    return;
  }
  const node = roomModule(page, uid);
  await expect(node).toHaveAttribute('data-screen-x', /^\d+$/);
  await viewport(page).scrollIntoViewIfNeeded();
  const canvas = await page.getByTestId('room-canvas').boundingBox();
  const x = Number(await node.getAttribute('data-screen-x'));
  const y = Number(await node.getAttribute('data-screen-y'));
  await page.mouse.click(canvas.x + x, canvas.y + y);
}

function inspector(page) {
  return page.getByTestId('room-inspector');
}

async function mount(page, name) {
  await page.getByRole('button', { name: `Mount ${name}`, exact: true }).click();
}

async function commitField(page, testId, value) {
  const input = page.getByTestId(testId);
  await input.fill(String(value));
  await input.press('Enter');
}

// Room and wall dimensions sit behind a progressive disclosure.
async function openDimensions(page, testId) {
  const disclosure = page.getByTestId(testId);
  const toggle = disclosure.getByRole('button', { name: /^Dimensions/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(disclosure.getByRole('spinbutton').first()).toBeVisible();
}

async function expectCamera(page, camera) {
  await expect(viewport(page)).toHaveAttribute('data-camera-yaw', String(camera.yaw));
  await expect(viewport(page)).toHaveAttribute('data-camera-pitch', String(camera.pitch));
  await expect(viewport(page)).toHaveAttribute('data-camera-zoom', String(camera.zoom));
}

function readStoredRoom(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY);
}

/**
 * Every small round indicator and every outer blurred shadow on UI controls.
 * Simulated fixtures (wall modules in the 2D studio) are the only exemption.
 */
function findGlowingIndicators(page) {
  return page.evaluate(() => {
    const CONTROLS =
      'button, a, label, input, [role="switch"], [role="group"], .product-card__stock, .workspace-frame__status';
    const outerBlur = (shadow) =>
      shadow !== 'none' &&
      shadow.split(/,(?![^(]*\))/).some((layer) => {
        if (layer.includes('inset')) return false;
        const lengths = layer.match(/-?\d*\.?\d+px/g) ?? [];
        return Number.parseFloat(lengths[2] ?? '0') > 0;
      });
    const inspect = (el, pseudo) => {
      const style = getComputedStyle(el, pseudo);
      if (pseudo && (style.content === 'none' || style.content === 'normal')) return null;
      if (style.display === 'none') return null;
      const w = Number.parseFloat(style.width);
      const h = Number.parseFloat(style.height);
      const radius = Number.parseFloat(style.borderTopLeftRadius);
      const isPercent = style.borderTopLeftRadius.endsWith('%') && radius >= 50;
      const dot = w > 0 && h > 0 && w <= 12 && h <= 12 && (isPercent || radius >= Math.min(w, h) / 2);
      const glow = outerBlur(style.boxShadow);
      return dot || glow ? `${el.className || el.tagName}${pseudo ?? ''} dot=${dot} glow=${glow}` : null;
    };

    const found = new Set();
    for (const control of document.querySelectorAll(CONTROLS)) {
      if (control.closest('.wall-module')) continue;
      for (const el of [control, ...control.querySelectorAll('*')]) {
        if (!(el instanceof HTMLElement)) continue;
        for (const pseudo of [null, '::before', '::after']) {
          const hit = inspect(el, pseudo);
          if (hit) found.add(hit);
        }
      }
    }
    return [...found];
  });
}

test.describe('brand mark and display mode switch', () => {
  test('navbar carries the cantilever and aperture mark, the favicon matches it', async ({ page, request }) => {
    await page.goto('/');
    const brand = page.getByRole('banner').getByRole('link', { name: 'Lumen overview' });
    const mark = brand.getByTestId('lumen-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('viewBox', '0 0 24 24');

    for (const [part, geometry] of Object.entries(MARK_GEOMETRY)) {
      const rect = mark.locator(`rect[data-part="${part}"]`);
      for (const [attr, value] of Object.entries(geometry)) {
        await expect(rect, `${part} ${attr}`).toHaveAttribute(attr, value);
      }
    }
    await expect(mark.locator('rect')).toHaveCount(4);
    const fills = await mark.locator('rect').evaluateAll((rects) =>
      rects.map((rect) => [rect.dataset.part, getComputedStyle(rect).fill]),
    );
    expect(Object.fromEntries(fills)).toEqual({
      spine: 'rgb(255, 255, 255)',
      base: 'rgb(255, 255, 255)',
      cantilever: 'rgb(255, 255, 255)',
      aperture: 'rgb(232, 146, 58)',
    });

    const wordmark = brand.locator('.navbar__wordmark');
    await expect(wordmark).toHaveText('Lumen');
    const type = await wordmark.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        transform: style.textTransform,
        tracking: Number.parseFloat(style.letterSpacing) / Number.parseFloat(style.fontSize),
      };
    });
    expect(type.transform).toBe('uppercase');
    expect(type.tracking).toBeCloseTo(0.14, 3);

    await expect(page.getByRole('contentinfo').getByTestId('lumen-mark')).toBeVisible();

    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
    const favicon = await (await request.get('/favicon.svg')).text();
    expect(favicon).toContain('viewBox="0 0 32 32"');
    expect(favicon).toContain('fill="#0b0b0a"');
    expect(favicon).toContain('<rect x="3" y="3" width="4" height="18" fill="#ffffff"/>');
    expect(favicon).toContain('<rect x="3" y="17" width="18" height="4" fill="#ffffff"/>');
    expect(favicon).toContain('<rect x="10" y="3" width="11" height="3.5" fill="#ffffff"/>');
    expect(favicon).toContain('<rect x="14.25" y="8.5" width="2" height="6.5" fill="#e8923a"/>');
  });

  test('Visual / Specs is a flat inverting segment switch with zero glowing status dots', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const group = page.getByRole('group', { name: 'Display mode' });
    const arch = group.getByRole('button', { name: 'Architectural' });
    const tech = group.getByRole('button', { name: 'Technical' });
    await expect(group.getByRole('button')).toHaveText(['Visual', 'Specs']);
    await expect(arch).toHaveAttribute('title', 'Visual mode - clean presentation');
    await expect(tech).toHaveAttribute('title', 'Specs mode - dimensions, wiring & engineering data');

    const paint = (locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
      });
    const frame = await group.evaluate((el) => {
      const style = getComputedStyle(el);
      return { border: `${style.borderTopWidth} ${style.borderTopStyle}`, color: style.borderTopColor };
    });
    expect(frame).toEqual({ border: '1px solid', color: 'rgba(255, 255, 255, 0.08)' });

    await expect(arch).toHaveAttribute('aria-pressed', 'true');
    expect(await paint(arch)).toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(11, 11, 10)', shadow: 'none' });

    await tech.click();
    await expect(html).toHaveAttribute('data-mode', 'technical');
    await expect(tech).toHaveAttribute('aria-pressed', 'true');
    await expect(arch).toHaveAttribute('aria-pressed', 'false');
    // Polled: the inversion eases over 120 ms.
    await expect
      .poll(() => paint(tech))
      .toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(11, 11, 10)', shadow: 'none' });
    await expect.poll(async () => (await paint(arch)).background).toBe('rgba(0, 0, 0, 0)');
    expect((await paint(arch)).shadow).toBe('none');

    await arch.click();
    await expect(html).toHaveAttribute('data-mode', 'architectural');

    for (const path of ['/', '/catalog', '/studio-2d', '/room-3d']) {
      for (const mode of ['architectural', 'technical']) {
        await storeDisplayMode(page, mode);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await findGlowingIndicators(page), `${path} in ${mode} mode`).toEqual([]);
      }
    }
  });
});

test.describe('room planner', () => {
  test('mounts, edits and persists modules, envelope, reference, lighting and camera', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);

    await expect(viewport(page)).toHaveAttribute('data-room-width', '320');
    await expect(viewport(page)).toHaveAttribute('data-room-depth', '280');
    await expect(viewport(page)).toHaveAttribute('data-room-height', '250');
    await expect(page.getByTestId('room-modules')).toHaveText('00');
    await expect(page.getByTestId('sync-room-to-bag')).toBeDisabled();
    await expect(page.getByTestId('export-to-wall-studio')).toBeDisabled();

    await mount(page, 'Floating Shelf 110');
    await expect(page.getByTestId('room-notice')).toHaveText('Mounted Floating Shelf 110 at X 105 / Y 146 cm.');
    const shelf = roomModule(page, 'm1');
    await expect(shelf).toHaveAttribute('data-dims', '110x8x25');
    await expect(shelf).toHaveAttribute('data-x-cm', '105');
    await expect(shelf).toHaveAttribute('data-y-cm', '146');
    await expect(inspector(page).getByTestId('room-inspector-name')).toHaveText('Floating Shelf 110');
    await expect(inspector(page).getByTestId('room-inspector-dims')).toHaveText('LMN-SH-110 / W 110 x H 8 x D 25 cm');

    // Product primitives: the shelf is a box in its finish colour with one LED wash light.
    await expect(shelf).toHaveAttribute('data-geometry', 'box');
    await expect(shelf).toHaveAttribute('data-color', getFinish('walnut').hex);
    await expect(roomLights(page, 'm1')).toHaveCount(1);
    await expect(roomLights(page, 'm1')).toHaveAttribute('data-type', 'spot');

    await mount(page, 'Corner Floor Column 140');
    const column = roomModule(page, 'm2');
    await expect(column).toHaveAttribute('data-x-cm', '151');
    await expect(column).toHaveAttribute('data-y-cm', '0');
    await expect(column).toHaveAttribute('data-geometry', 'cylinder');
    await expect(roomLights(page, 'm2')).toHaveCount(1);
    await expect(roomLights(page, 'm2')).toHaveAttribute('data-type', 'point');

    // Selecting in the scene itself: a raycast pick on the canvas.
    await expect(inspector(page).getByTestId('room-inspector-name')).toHaveText('Corner Floor Column 140');
    await pickInScene(page, 'm1', /Floating Shelf 110/);
    await expect(inspector(page).getByTestId('room-inspector-name')).toHaveText('Floating Shelf 110');
    await expect(page.getByTestId('room-selection')).toHaveAttribute('data-uid', 'm1');

    await inspector(page).getByRole('radio', { name: 'Oak' }).check();
    await expect(shelf).toHaveAttribute('data-finish', 'oak');
    await expect(shelf).toHaveAttribute('data-color', getFinish('oak').hex);
    await commitField(page, 'room-module-x', 40);
    await commitField(page, 'room-module-y', 120);
    await expect(shelf).toHaveAttribute('data-x-cm', '40');
    await expect(shelf).toHaveAttribute('data-y-cm', '120');
    await commitField(page, 'room-module-x', 9999);
    await expect(page.getByTestId('room-module-x')).toHaveValue('210');
    await commitField(page, 'room-module-x', 40);

    await inspector(page).getByTestId('room-led-channel').click();
    await expect(shelf).toHaveAttribute('data-led', 'false');
    await expect(roomLights(page, 'm1')).toHaveCount(0);
    await inspector(page).getByTestId('room-led-channel').click();
    await expect(shelf).toHaveAttribute('data-led', 'true');
    await expect(roomLights(page, 'm1')).toHaveCount(1);

    await openDimensions(page, 'room-dimensions');
    await commitField(page, 'room-width', 900);
    await expect(page.getByTestId('room-width')).toHaveValue('500');
    await commitField(page, 'room-width', 400);
    await commitField(page, 'room-depth', 360);
    await commitField(page, 'room-height', 300);
    await expect(page.getByTestId('room-label')).toHaveText('Viewport / Room 400 x 360 x 300 cm');

    // The sofa base reaches 6-98 cm off the wall: the column at X 151 is inside it.
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();
    await expect(viewport(page)).toHaveAttribute('data-furniture', 'sofa-200');
    await expect(page.getByTestId('room-furniture')).toHaveCount(furnitureLayout({ widthCm: 400, depthCm: 360, furniture: 'sofa-200' }).parts.length);
    await expect(page.getByTestId('room-conflict-count')).toHaveText('1 conflict');
    await inspector(page).getByRole('button', { name: 'Done' }).click();
    await page.getByTestId('room-module-list').getByRole('button', { name: /Corner Floor Column 140/ }).click();
    await expect(inspector(page).getByTestId('room-inspector-status')).toHaveText('Collides with Modular Sofa 200cm');
    await commitField(page, 'room-module-x', 20);
    await expect(inspector(page).getByTestId('room-inspector-status')).toHaveText('Clear');
    await expect(page.getByTestId('room-conflict-count')).toHaveText('0 conflicts');

    await page.getByRole('radio', { name: 'Daylight Studio' }).check();
    await expect(viewport(page)).toHaveAttribute('data-lighting', 'daylight');

    await page.getByRole('button', { name: 'Front Elevation' }).click();
    await expectCamera(page, { yaw: 0, pitch: 8, zoom: 1.1 });
    await expect(page.getByRole('button', { name: 'Front Elevation' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Corner Iso' }).click();
    await expectCamera(page, { yaw: 45, pitch: 35.3, zoom: 0.95 });
    await page.getByRole('button', { name: 'Reset Camera' }).click();
    await expectCamera(page, { yaw: -24, pitch: 24, zoom: 1 });
    await expect(page.getByRole('button', { name: 'Reset Camera' })).toBeDisabled();
    await page.getByRole('button', { name: 'Perspective' }).click();
    await expectCamera(page, { yaw: -34, pitch: 14, zoom: 1.25 });
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expectCamera(page, { yaw: -34, pitch: 14, zoom: 1.35 });
    await expect(viewport(page)).toHaveAttribute('data-preset', 'custom');
    await expect(page.getByTestId('camera-readout')).toHaveText('Yaw -34.0 / Pitch 14.0 / Zoom 1.35x');

    const expected = {
      format: ROOM_FORMAT,
      version: ROOM_VERSION,
      room: { widthCm: 400, depthCm: 360, heightCm: 300, furniture: 'sofa-200', lighting: 'daylight' },
      camera: { yaw: -34, pitch: 14, zoom: 1.35 },
      items: [
        { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: 40, yCm: 120, led: true },
        { uid: 'm2', productId: 'corner-floor-column-140', finish: 'walnut', xCm: 20, yCm: 0, led: true },
      ],
    };
    await expect.poll(() => readStoredRoom(page)).toEqual(expected);

    await page.reload();
    await expect(page.getByTestId('room-label')).toHaveText('Viewport / Room 400 x 360 x 300 cm');
    await expect(viewport(page)).toHaveAttribute('data-furniture', 'sofa-200');
    await expect(viewport(page)).toHaveAttribute('data-lighting', 'daylight');
    await expectCamera(page, expected.camera);
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-finish', 'oak');
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-x-cm', '40');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-x-cm', '20');
    await expect(page.getByTestId('room-modules')).toHaveText('02');
    expect(await readStoredRoom(page)).toEqual(expected);

    // Selection is session state: a reload opens on the module list.
    await page.getByTestId('room-module-list').getByRole('button', { name: /Floating Shelf 110/ }).click();
    await inspector(page).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('room-notice')).toHaveText('Removed Floating Shelf 110, Oak.');
    await expect(page.getByTestId('room-module')).toHaveCount(1);

    expect(errors).toEqual([]);
  });

  test('OrbitControls orbit and wheel zoom commit inside the camera limits, keys step exactly', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRoom(page);
    const stage = viewport(page);
    const renderer = await rendererOf(page);
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cameraOf = async () => ({
      yaw: Number(await stage.getAttribute('data-camera-yaw')),
      pitch: Number(await stage.getAttribute('data-camera-pitch')),
      zoom: Number(await stage.getAttribute('data-camera-zoom')),
    });

    if (renderer === 'unavailable') {
      test.info().annotations.push({ type: 'webgl', description: 'unavailable: pointer orbit skipped' });
    } else {
      // Dragging right swings the eye toward negative yaw until the azimuth limit.
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 400, cy + 60, { steps: 10 });
      await page.mouse.up();
      await expect(stage).toHaveAttribute('data-camera-yaw', String(CAMERA_YAW.min));
      const afterFirst = await cameraOf();
      expect(afterFirst.pitch).toBeGreaterThan(24);
      expect(afterFirst.pitch).toBeLessThan(CAMERA_PITCH.max);
      expect(afterFirst.zoom).toBe(1);

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx - 100, cy + 600, { steps: 10 });
      await page.mouse.up();
      await expect(stage).toHaveAttribute('data-camera-pitch', String(CAMERA_PITCH.max));
      expect((await cameraOf()).yaw).toBeGreaterThan(CAMERA_YAW.min);

      // One wheel notch dollies 5 percent; a burst stops at the zoom limit. Wheel
      // input reaches the page asynchronously, so count deliveries before moving on.
      await stage.evaluate((el) => {
        window.__wheels = 0;
        el.addEventListener('wheel', () => (window.__wheels += 1), { capture: true });
      });
      await page.mouse.move(cx, cy);
      await page.mouse.wheel(0, -100);
      await expect(stage).toHaveAttribute('data-camera-zoom', '1.05');
      for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, -100);
      await expect.poll(() => page.evaluate(() => window.__wheels)).toBe(21);
      await expect(stage).toHaveAttribute('data-camera-zoom', '1.8');
      await expect.poll(async () => (await readStoredRoom(page)).camera.zoom).toBe(1.8);
    }

    await stage.focus();
    await page.keyboard.press('Home');
    await expectCamera(page, { yaw: -24, pitch: 24, zoom: 1 });
    await page.keyboard.press('ArrowLeft');
    await expect(stage).toHaveAttribute('data-camera-yaw', '-29');
    await page.keyboard.press('ArrowUp');
    await expect(stage).toHaveAttribute('data-camera-pitch', '28');
    await page.keyboard.press('Home');
    await expectCamera(page, { yaw: -24, pitch: 24, zoom: 1 });

    // Rapid presses step from the glide target, so they land on whole steps.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expectCamera(page, { yaw: -9, pitch: 24, zoom: 1 });
    await expect(page.getByTestId('camera-readout')).toHaveText('Yaw -9.0 / Pitch 24.0 / Zoom 1.00x');

    await page.reload();
    await expectCamera(page, { yaw: -9, pitch: 24, zoom: 1 });
  });

  test('camera settings popover hides yaw, pitch, zoom and the wireframe view until opened', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    await mount(page, 'Floating Shelf 110');

    const toggle = page.getByRole('button', { name: 'Camera settings' });
    const panel = page.getByTestId('camera-settings');
    const yaw = page.getByRole('slider', { name: 'Yaw' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    await expect(yaw).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(yaw).toHaveValue('-24');

    await yaw.fill('30');
    await page.getByRole('slider', { name: 'Pitch' }).fill('40');
    await page.getByRole('slider', { name: 'Zoom' }).fill('1.5');
    await expectCamera(page, { yaw: 30, pitch: 40, zoom: 1.5 });
    await expect(page.getByTestId('camera-readout')).toHaveText('Yaw 30.0 / Pitch 40.0 / Zoom 1.50x');
    await expect(page.getByTestId('camera-zoom')).toHaveText('1.50x');
    await expect.poll(async () => (await readStoredRoom(page)).camera).toEqual({ yaw: 30, pitch: 40, zoom: 1.5 });

    // Wireframe turns materials to smoked glass and outlines every box.
    await expect(page.getByTestId('room-wireframe')).toHaveCount(0);
    const wire = page.getByTestId('camera-wireframe');
    await expectUnoccluded(wire);
    await wire.click();
    await expect(wire).toHaveAttribute('aria-checked', 'true');
    await expect(viewport(page)).toHaveAttribute('data-wireframe', 'true');
    await expect(page.getByTestId('room-wireframe')).toHaveAttribute('data-edges', '1');

    // Escape closes and returns focus to the trigger; an outside press closes too.
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(panel).toBeHidden();
    await toggle.click();
    await expect(panel).toBeVisible();
    await page.getByRole('heading', { level: 1 }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Session view state: the wireframe survives closing the popover, not a reload.
    await expect(page.getByTestId('room-wireframe')).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId('room-wireframe')).toHaveCount(0);
    await expectCamera(page, { yaw: 30, pitch: 40, zoom: 1.5 });

    // Wider Linux CI fonts wrap the HUD; narrower viewports force the same
    // wrap locally. The open panel must stay on the stage at every width.
    for (const size of [
      { width: 1024, height: 768 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(size);
      await toggle.click();
      await expect(panel).toBeVisible();
      await expectUnoccluded(wire);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    }
    expect(errors).toEqual([]);
  });

  test('orbiting the camera dims the panels around the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRoom(page);
    test.skip((await rendererOf(page)) === 'unavailable', 'Pointer orbit needs a WebGL context.');
    const stage = viewport(page);
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    const controls = page.locator('.room3d-layout__controls');
    const opacity = () => controls.evaluate((el) => Number(getComputedStyle(el).opacity));

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 6 });
    await expect(page.getByRole('region', { name: 'Room viewport' })).toHaveAttribute('data-orbiting', 'true');
    await expect.poll(opacity).toBeLessThan(0.4);

    await page.mouse.up();
    await expect(page.getByRole('region', { name: 'Room viewport' })).not.toHaveAttribute('data-orbiting');
    await expect.poll(opacity).toBe(1);
  });

  test('technical mode overlays wireframe edges, X / Y / Z axes and clearance callouts', async ({ page }) => {
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openRoom(page);
    await mount(page, 'Floating Shelf 110');
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();

    const overlay = page.getByTestId('room-technical-overlay');
    await expect(overlay).toHaveCount(1);
    await expect(overlay.getByTestId('axis-label')).toHaveText(['X 320 cm', 'Y 250 cm', 'Z 280 cm']);
    await expect(overlay.getByTestId('room-sku-tag')).toHaveText(['LMN-SH-110']);
    // One shelf plus the seven sofa parts carry edge outlines.
    await expect(overlay).toHaveAttribute('data-edges', '8');
    if ((await rendererOf(page)) !== 'unavailable') {
      // Labels projected over the canvas.
      await expect(page.locator('.room3d-label--axis')).toHaveText(['X 320 cm', 'Y 250 cm', 'Z 280 cm']);
      await expect(page.locator('.room3d-label--tag')).toHaveText(['LMN-SH-110']);
    }

    const callout = (id) => overlay.locator(`[data-testid="clearance-callout"][data-callout="${id}"]`);
    // Shelf m1 is selected after mounting: X 105, Y 146, 110 x 8 cm, under a 250 cm ceiling.
    await expect(callout('walkway')).toHaveAttribute('data-value-cm', String(280 - 98));
    await expect(callout('walkway')).toContainText('Walkway 182 cm');
    await expect(callout('floor')).toContainText('FFL +146 cm');
    await expect(callout('ceiling')).toContainText('Ceiling 96 cm');
    await expect(callout('headroom')).toContainText('Headroom 68 cm');
    await expect(callout('headroom')).toHaveAttribute('data-tone', 'ok');

    await commitField(page, 'room-module-y', 96);
    await expect(callout('headroom')).toContainText('Headroom 18 cm');
    await expect(callout('headroom')).toHaveAttribute('data-tone', 'tight');

    await openDimensions(page, 'room-dimensions');
    await commitField(page, 'room-depth', 200);
    await expect(callout('walkway')).toContainText('Walkway 102 cm');

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Architectural' }).click();
    await expect(page.getByTestId('room-technical-overlay')).toHaveCount(0);
    await expect(page.locator('.room3d-label')).toHaveCount(0);
  });

  test('tampered lumen_room_3d_v1 payloads fall back or are rebuilt without errors', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await installCspRecorder(page);
    await openRoom(page);

    const rejected = [
      '{"format":"lumen.room3d","version":1,"items":[',
      '"<img src=x onerror=alert(1)>"',
      '{"__proto__":{"polluted":true},"format":"lumen.room3d","version":1,"items":[]}',
      JSON.stringify({ format: 'lumen.wall', version: 1, items: [] }),
      JSON.stringify({ format: ROOM_FORMAT, version: 2, items: [] }),
      JSON.stringify({ format: ROOM_FORMAT, version: ROOM_VERSION, items: 'm1' }),
      JSON.stringify([{ format: ROOM_FORMAT }]),
    ];
    for (const raw of rejected) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [ROOM_KEY, raw]);
      await page.reload();
      await expect(page.getByTestId('room-label'), raw).toHaveText('Viewport / Room 320 x 280 x 250 cm');
      await expect(page.getByTestId('room-module')).toHaveCount(0);
      await expectCamera(page, { yaw: -24, pitch: 24, zoom: 1 });
      expect(await readStoredRoom(page), raw).toEqual(createRoomState());
    }

    const poisoned = {
      format: ROOM_FORMAT,
      version: ROOM_VERSION,
      room: { widthCm: 9999, depthCm: -4, heightCm: '300', furniture: 'piano', lighting: '<script>' },
      camera: { yaw: 999, pitch: -90, zoom: 'Infinity', __proto__: { polluted: true } },
      items: [
        { uid: 'm1', productId: 'floating-shelf-110', finish: 'walnut', xCm: 9000, yCm: -20, led: 'yes' },
        { uid: 'm1', productId: 'modular-cube-36', finish: 'chalk', xCm: 12.6, yCm: 40.4, led: false },
        { uid: '<img src=x>', productId: 'linear-lightbar-60', finish: 'oak', xCm: 30, yCm: 200 },
        { uid: 'm4', productId: 'constructor', finish: 'walnut', xCm: 0, yCm: 0 },
        { uid: 'm5', productId: 'directional-spot-monopoint', finish: 'walnut', xCm: 0, yCm: 0 },
        { uid: 'm6', productId: 'track-bus-200', finish: 'obsidian', xCm: '10', yCm: 0 },
        { uid: 'm7', productId: 'modular-cube-36', finish: 'oak', xCm: null, yCm: 5 },
      ],
    };
    const raw = JSON.stringify(poisoned).replace('"camera":{', '"camera":{"__proto__":{"polluted":true},');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [ROOM_KEY, raw]);
    await page.reload();

    await expect(page.getByTestId('room-label')).toHaveText('Viewport / Room 500 x 200 x 250 cm');
    await expect(viewport(page)).toHaveAttribute('data-furniture', 'none');
    await expect(viewport(page)).toHaveAttribute('data-lighting', 'night');
    await expectCamera(page, { yaw: 65, pitch: 8, zoom: 1 });
    await expect(page.getByTestId('room-module')).toHaveCount(3);
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-x-cm', '390');
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-y-cm', '0');
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-led', 'true');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-product', 'modular-cube-36');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-x-cm', '13');
    await expect(roomModule(page, 'm2')).toHaveAttribute('data-led', 'false');
    await expect(roomModule(page, 'm3')).toHaveAttribute('data-product', 'linear-lightbar-60');

    const stored = await readStoredRoom(page);
    expect(stored).toEqual(sanitizeRoomState(JSON.parse(raw)));
    expect(stored.items.map((item) => item.uid)).toEqual(['m1', 'm2', 'm3']);
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('2D and 3D bridge', () => {
  test('a custom 2D wall loads into the room exactly, pushes back and syncs to the bag', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/studio-2d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');

    await openDimensions(page, 'wall-dimensions');
    await commitField(page, 'wall-width', 360);
    await page.getByRole('button', { name: 'Mount Compact Sideboard 75', exact: true }).click();
    await page.getByRole('button', { name: 'Mount Acoustic Art Frame 50x70', exact: true }).click();
    await page.getByRole('button', { name: 'Mount Linear Lightbar 60', exact: true }).click();
    await page.getByTestId('studio-inspector').getByRole('radio', { name: 'Chalk' }).check();
    await commitField(page, 'module-x', 24);
    await page.getByRole('button', { name: 'Mount Acoustic Art Frame 50x70', exact: true }).click();
    await page.getByTestId('studio-inspector').getByTestId('led-channel').click();
    await page.getByRole('radio', { name: 'Daylight Elevation' }).check();

    const wall = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), WALL_KEY);
    expect(wall.wall.widthCm).toBe(360);
    expect(wall.items).toHaveLength(4);

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /3d room/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await page.getByTestId('import-from-wall-studio').click();
    await expect(page.getByTestId('room-notice')).toHaveText('Loaded 4 modules from Wall Studio. Main wall 360 x 250 cm.');
    await expect(viewport(page)).toHaveAttribute('data-room-width', '360');
    await expect(viewport(page)).toHaveAttribute('data-lighting', 'daylight');

    await expect(page.getByTestId('room-module')).toHaveCount(wall.items.length);
    for (const item of wall.items) {
      const el = roomModule(page, item.uid);
      const { w, h, d } = getProduct(item.productId).dimsCm;
      await expect(el).toHaveAttribute('data-product', item.productId);
      await expect(el).toHaveAttribute('data-finish', item.finish);
      await expect(el).toHaveAttribute('data-x-cm', String(item.xCm));
      await expect(el).toHaveAttribute('data-y-cm', String(item.yCm));
      await expect(el).toHaveAttribute('data-led', String(item.led));
      await expect(el).toHaveAttribute('data-dims', `${w}x${h}x${d}`);
    }

    // Edit in 3D, push back, and read it in the 2D studio.
    const moved = wall.items[0];
    await page.getByTestId('room-module-list').locator(`[data-uid="${moved.uid}"]`).click();
    await commitField(page, 'room-module-x', moved.xCm + 30);
    await openDimensions(page, 'room-dimensions');
    await commitField(page, 'room-width', 450);
    await page.getByTestId('export-to-wall-studio').click();
    await expect(page.getByTestId('room-bridge-status')).toHaveText(
      'Pushed 4 modules to Wall Studio, wall 400 x 250 cm. Wall capped at 400 cm; 0 modules pulled inside.',
    );
    const pushed = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), WALL_KEY);
    expect(pushed.wall).toMatchObject({ widthCm: 400, heightCm: 250, slope: false, surface: 'daylight' });
    expect(pushed.items.find((item) => item.uid === moved.uid).xCm).toBe(moved.xCm + 30);

    await page.getByRole('link', { name: 'Open Wall Studio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    await expect(page.getByTestId('wall-label')).toHaveText('Elevation / Wall A / 400 x 250 cm');
    await expect(page.locator(`[data-testid="wall-module"][data-uid="${moved.uid}"]`)).toHaveAttribute(
      'data-x-cm',
      String(moved.xCm + 30),
    );

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /3d room/i }).click();
    const items = (await readStoredRoom(page)).items;
    const lines = aggregateBagLines(items);
    const priceUsd = items.reduce((sum, item) => sum + getProduct(item.productId).priceUsd, 0);
    const loadW = items.reduce((sum, item) => sum + getProduct(item.productId).watts, 0);
    await expect(page.getByTestId('room-price')).toHaveText(formatUsd(priceUsd));
    await expect(page.getByTestId('room-load')).toHaveText(`${loadW} W`);

    await page.getByTestId('sync-room-to-bag').click();
    const drawer = page.getByRole('dialog', { name: 'Cart' });
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('room-bridge-status')).toHaveText(
      `Synced 4 modules as ${lines.length} cart lines.`,
    );
    await expect(drawer.getByTestId('bag-line')).toHaveCount(lines.length);
    for (const line of lines) {
      await expect(
        drawer.locator(`[data-testid="bag-line"][data-line="${line.id}:${line.finish}"]`).getByTestId('bag-line-qty'),
      ).toHaveText(String(line.qty));
    }
    await expect(drawer.getByTestId('bag-subtotal')).toHaveText(formatUsd(priceUsd));
    await expect(drawer.getByTestId('bag-psu')).toHaveText(recommendPsu(loadW).label);
    await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), BAG_KEY)).toEqual(lines);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page.getByTestId('sync-room-to-bag')).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('an empty 2D wall loads the default composition', async ({ page }) => {
    await openRoom(page);
    await page.getByTestId('import-from-wall-studio').click();
    await expect(page.getByTestId('room-notice')).toHaveText(
      'Wall Studio is empty. Loaded the default composition: 9 modules.',
    );
    await expect(page.getByTestId('room-module')).toHaveCount(9);
    await expect(viewport(page)).toHaveAttribute('data-room-width', '300');
    await expect(page.getByTestId('room-modules')).toHaveText('09');
  });
});

test.describe('scene description', () => {
  const state = sanitizeRoomState({
    format: ROOM_FORMAT,
    version: ROOM_VERSION,
    room: { widthCm: 360, depthCm: 300, heightCm: 260, furniture: 'sofa-200', lighting: 'night' },
    camera: { yaw: 30, pitch: 20, zoom: 1.2 },
    items: [
      { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: 40, yCm: 120, led: true },
      { uid: 'm2', productId: 'compact-sideboard-75', finish: 'walnut', xCm: 200, yCm: 100, led: false },
      { uid: 'm3', productId: 'corner-floor-column-140', finish: 'obsidian', xCm: 300, yCm: 0, led: true },
      { uid: 'm4', productId: 'acoustic-art-frame-50x70', finish: 'chalk', xCm: 120, yCm: 30, led: true },
    ],
  });

  test('maps modules to finish-coloured primitives and lit modules to real lights, deterministically', () => {
    const input = { state, conflicts: new Map(), selectedUid: 'm1', technical: true };
    const scene = buildScene(input);
    expect(JSON.stringify(scene)).toBe(JSON.stringify(buildScene(input)));

    const byUid = Object.fromEntries(scene.modules.map((module) => [module.uid, module]));
    expect(byUid.m1).toMatchObject({ geometry: 'box', color: getFinish('oak').hex, size: [1.1, 0.08, 0.25], selected: true });
    expect(byUid.m1.position).toEqual([0.95, 1.24, 0.125]);
    expect(byUid.m2.color).toBe(getFinish('walnut').hex);
    expect(byUid.m3).toMatchObject({ geometry: 'cylinder', color: getFinish('obsidian').hex });
    expect(byUid.m4.color).toBe(getFinish('chalk').hex);

    // LED off: no light and a dark emitter. LED on: spot wash, point glow, backlit halo.
    expect(byUid.m2.lights).toEqual([]);
    expect(byUid.m2.emitters.every((emitter) => emitter.intensity === 0)).toBe(true);
    expect(byUid.m1.lights.map((light) => light.type)).toEqual(['spot']);
    expect(byUid.m3.lights.map((light) => light.type)).toEqual(['point']);
    expect(byUid.m4.lights.map((light) => light.type)).toEqual(['point']);
    const wash = byUid.m1.lights[0];
    expect(wash.target[1]).toBeLessThan(wash.position[1]);
    expect(wash.intensity).toBeGreaterThan(0);
    expect(scene.stats.lights).toBe(3 + 3);

    // Daylight keeps the rig shape with a stronger sun and LEDs that read weaker against it.
    const day = buildScene({ ...input, state: { ...state, room: { ...state.room, lighting: 'daylight' } } });
    expect(day.rig.sun.intensity).toBeGreaterThan(scene.rig.sun.intensity);
    expect(day.modules[0].lights[0].intensity).toBeLessThan(wash.intensity);

    expect(scene.furniture).toHaveLength(furnitureLayout(state.room).parts.length);
    expect(scene.axes.map((axis) => axis.label)).toEqual(['X 360 cm', 'Y 260 cm', 'Z 300 cm']);
    expect(scene.callouts.map((callout) => callout.id)).toContain('walkway');
  });

  test('orbit frame round-trips yaw, pitch and zoom and mirrors the camera limits', () => {
    const cameras = [
      { yaw: -65, pitch: 8, zoom: 0.6 },
      { yaw: 30, pitch: 20, zoom: 1.2 },
      { yaw: 65, pitch: 50, zoom: 1.8 },
    ];
    const radius = 0.5 * Math.hypot(3.6, 2.6, 3.0);
    for (const aspect of [0.6, 1, 1.6, 2.4]) {
      const frame = cameraFrame(state.room, aspect);
      for (const camera of cameras) {
        expect(sanitizeCamera(cameraFromPosition(frame, cameraPosition(frame, camera)))).toEqual(camera);
      }
      // Even fully zoomed in, the eye stays outside the room's bounding sphere.
      expect(frame.minDistance).toBeGreaterThan(radius);
    }
    const limits = orbitLimits(CAMERA_YAW, CAMERA_PITCH);
    expect(limits.minPolarAngle).toBeCloseTo(((90 - CAMERA_PITCH.max) * Math.PI) / 180, 10);
    expect(limits.maxAzimuthAngle).toBeCloseTo((CAMERA_YAW.max * Math.PI) / 180, 10);
  });
});

test.describe('runtime guards', () => {
  test('room planner boots clean from 360px to 1600px in both modes with zero overflow or CSP errors', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await installCspRecorder(page);
    await openRoom(page);
    await page.getByTestId('import-from-wall-studio').click();
    await page.getByRole('radio', { name: 'Low Platform Bed 160cm' }).check();
    await page.getByTestId('room-module-list').locator('[data-uid="m2"]').click();

    for (const mode of ['architectural', 'technical']) {
      await storeDisplayMode(page, mode);
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/room-3d');
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
        await expect(page.getByTestId('room-module')).toHaveCount(9);
        await rendererOf(page);
        expect(await horizontalOverflow(page), `${mode} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(await readCspViolations(page), `CSP violations in ${mode} mode`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test('the WebGL canvas boots on the production CSP with no violations', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await installCspRecorder(page);
    await openRoom(page);
    const renderer = await rendererOf(page);
    test.skip(renderer === 'unavailable', 'No WebGL context in this browser.');
    expect(['webgl2', 'webgl']).toContain(renderer);
    const canvas = page.getByTestId('room-canvas').locator('canvas');
    await expect(canvas).toHaveCount(1);
    const [w, h] = await canvas.evaluate((el) => [el.width, el.height]);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('without a WebGL context the planner falls back cleanly and keeps the scene state live', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await installCspRecorder(page);
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        return /webgl/i.test(type) ? null : original.call(this, type, ...rest);
      };
    });
    await openRoom(page);

    await expect(viewport(page)).toHaveAttribute('data-renderer', 'unavailable');
    await expect(page.getByTestId('room-webgl-fallback')).toBeVisible();
    await expect(page.getByTestId('room-canvas')).toHaveCount(0);

    await mount(page, 'Floating Shelf 110');
    await expect(roomModule(page, 'm1')).toHaveAttribute('data-x-cm', '105');
    await expect(roomLights(page, 'm1')).toHaveCount(1);
    await page.getByRole('button', { name: 'Front Elevation' }).click();
    await expectCamera(page, { yaw: 0, pitch: 8, zoom: 1.1 });
    await page.getByRole('button', { name: 'Camera settings' }).click();
    await expect(page.getByTestId('camera-readout')).toHaveText('Yaw 0.0 / Pitch 8.0 / Zoom 1.10x');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
