import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { BAG_STORAGE_KEY, recommendPsu } from '../src/lib/bag.js';
import { formatUsd } from '../src/lib/format.js';
import {
  createRoomState,
  furnitureLayout,
  ROOM_FORMAT,
  ROOM_STORAGE_KEY,
  ROOM_VERSION,
  sanitizeRoomState,
} from '../src/lib/room-3d.js';
import { buildScene } from '../src/lib/room-scene.js';
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

function roomModule(page, uid) {
  return page.locator(`[data-testid="room-module"][data-uid="${uid}"]`);
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
      spine: 'rgb(242, 238, 231)',
      base: 'rgb(242, 238, 231)',
      cantilever: 'rgb(242, 238, 231)',
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
    expect(favicon).toContain('<rect x="3" y="3" width="4" height="18" fill="#f2eee7"/>');
    expect(favicon).toContain('<rect x="3" y="17" width="18" height="4" fill="#f2eee7"/>');
    expect(favicon).toContain('<rect x="10" y="3" width="11" height="3.5" fill="#f2eee7"/>');
    expect(favicon).toContain('<rect x="14.25" y="8.5" width="2" height="6.5" fill="#e8923a"/>');
  });

  test('Arch / Tech is a flat inverting segment switch with zero glowing status dots', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const group = page.getByRole('group', { name: 'Display mode' });
    const arch = group.getByRole('button', { name: 'Architectural' });
    const tech = group.getByRole('button', { name: 'Technical' });
    await expect(group.getByRole('button')).toHaveText(['Arch', 'Tech']);

    const paint = (locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
      });
    const frame = await group.evaluate((el) => {
      const style = getComputedStyle(el);
      return { border: `${style.borderTopWidth} ${style.borderTopStyle}`, color: style.borderTopColor };
    });
    expect(frame).toEqual({ border: '1px solid', color: 'rgba(242, 238, 231, 0.16)' });

    await expect(arch).toHaveAttribute('aria-pressed', 'true');
    expect(await paint(arch)).toEqual({ background: 'rgb(242, 238, 231)', color: 'rgb(11, 11, 10)', shadow: 'none' });

    await tech.click();
    await expect(html).toHaveAttribute('data-mode', 'technical');
    await expect(tech).toHaveAttribute('aria-pressed', 'true');
    await expect(arch).toHaveAttribute('aria-pressed', 'false');
    // Polled: the inversion eases over 120 ms.
    await expect
      .poll(() => paint(tech))
      .toEqual({ background: 'rgb(242, 238, 231)', color: 'rgb(11, 11, 10)', shadow: 'none' });
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

    // A box seen from outside shows between one and three faces.
    const faces = Number(await shelf.getAttribute('data-faces'));
    expect(faces).toBeGreaterThanOrEqual(1);
    expect(faces).toBeLessThanOrEqual(3);
    await expect(page.locator('[data-testid="light-patch"][data-uid="m1"]')).toHaveCount(1);

    await mount(page, 'Corner Floor Column 140');
    const column = roomModule(page, 'm2');
    await expect(column).toHaveAttribute('data-x-cm', '151');
    await expect(column).toHaveAttribute('data-y-cm', '0');
    await expect(page.locator('[data-testid="light-patch"][data-uid="m2"]')).toHaveCount(2);

    // Selecting in the scene itself.
    await shelf.click();
    await expect(inspector(page).getByTestId('room-inspector-name')).toHaveText('Floating Shelf 110');
    await expect(page.getByTestId('room-selection')).toHaveCount(1);

    await inspector(page).getByRole('radio', { name: 'Oak' }).check();
    await expect(shelf).toHaveAttribute('data-finish', 'oak');
    await commitField(page, 'room-module-x', 40);
    await commitField(page, 'room-module-y', 120);
    await expect(shelf).toHaveAttribute('data-x-cm', '40');
    await expect(shelf).toHaveAttribute('data-y-cm', '120');
    await commitField(page, 'room-module-x', 9999);
    await expect(page.getByTestId('room-module-x')).toHaveValue('210');
    await commitField(page, 'room-module-x', 40);

    await inspector(page).getByTestId('room-led-channel').click();
    await expect(shelf).toHaveAttribute('data-led', 'false');
    await expect(page.locator('[data-testid="light-patch"][data-uid="m1"]')).toHaveCount(0);
    await inspector(page).getByTestId('room-led-channel').click();
    await expect(shelf).toHaveAttribute('data-led', 'true');
    await expect(page.locator('[data-testid="light-patch"][data-uid="m1"]')).toHaveCount(1);

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

  test('pointer orbit, wheel zoom and keyboard stay inside the camera limits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRoom(page);
    const stage = viewport(page);
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 60, { steps: 8 });
    await page.mouse.up();
    // Yaw -24 - 200 * 0.3 clamps at -65; pitch 24 + 60 * 0.22 = 37.2.
    await expectCamera(page, { yaw: -65, pitch: 37.2, zoom: 1 });

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 100, cy + 400, { steps: 8 });
    await page.mouse.up();
    await expect(stage).toHaveAttribute('data-camera-pitch', '50');
    await expect(stage).toHaveAttribute('data-camera-yaw', '-35');

    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await expect(stage).toHaveAttribute('data-camera-zoom', '1.43');
    await page.mouse.wheel(0, -3000);
    await expect(stage).toHaveAttribute('data-camera-zoom', '1.8');

    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-camera-yaw', '-30');
    await page.keyboard.press('ArrowDown');
    await expect(stage).toHaveAttribute('data-camera-pitch', '46');
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

  test('technical mode overlays wireframe edges, X / Y / Z axes and clearance callouts', async ({ page }) => {
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openRoom(page);
    await mount(page, 'Floating Shelf 110');
    await page.getByRole('radio', { name: 'Modular Sofa 200cm' }).check();

    const overlay = page.getByTestId('room-technical-overlay');
    await expect(overlay).toBeVisible();
    await expect(overlay.getByTestId('axis-label').locator('text')).toHaveText(['X 320 cm', 'Y 250 cm', 'Z 280 cm']);
    await expect(overlay.getByTestId('room-sku-tag')).toHaveText(['LMN-SH-110']);
    expect(await overlay.locator('.room3d-tech__edges line').count()).toBe(12 * 8);
    expect(await overlay.locator('.room3d-tech__edges line.is-hidden').count()).toBeGreaterThan(0);

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

    await commitField(page, 'room-depth', 200);
    await expect(callout('walkway')).toContainText('Walkway 102 cm');

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Architectural' }).click();
    await expect(page.getByTestId('room-technical-overlay')).toHaveCount(0);
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
    const drawer = page.getByRole('dialog', { name: 'Bag' });
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('room-bridge-status')).toHaveText(
      `Synced 4 modules as ${lines.length} bag lines.`,
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

test.describe('scene compiler', () => {
  test('is deterministic and culls every box to at most three faces', () => {
    const state = sanitizeRoomState({
      format: ROOM_FORMAT,
      version: ROOM_VERSION,
      room: { widthCm: 360, depthCm: 300, heightCm: 260, furniture: 'sofa-200', lighting: 'night' },
      camera: { yaw: 30, pitch: 20, zoom: 1.2 },
      items: [
        { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: 40, yCm: 120, led: true },
        { uid: 'm2', productId: 'compact-sideboard-75', finish: 'walnut', xCm: 200, yCm: 100, led: true },
      ],
    });
    const input = {
      state,
      camera: state.camera,
      viewport: { w: 960, h: 600 },
      conflicts: new Map(),
      selectedUid: 'm1',
      technical: true,
    };
    const a = buildScene(input);
    const b = buildScene(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    for (const solid of a.solids) expect(solid.faces.length).toBeLessThanOrEqual(3);
    // Painter order: the sofa back stands on the base, so with the eye above it draws later.
    const order = a.solids.map((solid) => solid.key);
    expect(order.indexOf('furniture-back')).toBeGreaterThan(order.indexOf('furniture-base'));
    expect(order.indexOf('furniture-seat-left')).toBeGreaterThan(order.indexOf('furniture-base'));
    expect(a.technical.axes.map((axis) => axis.label)).toEqual(['X 360 cm', 'Y 260 cm', 'Z 300 cm']);
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
        expect(await horizontalOverflow(page), `${mode} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(await readCspViolations(page), `CSP violations in ${mode} mode`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});
