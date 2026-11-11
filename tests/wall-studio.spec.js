import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getFinish, getProduct, PRODUCTS } from '../src/data/products.js';
import { getWallPreset, WALL_PRESETS } from '../src/data/wall-presets.js';
import { BAG_STORAGE_KEY, recommendPsu } from '../src/lib/bag.js';
import { formatUsd } from '../src/lib/format.js';
import {
  aggregateBagLines,
  commitHistory,
  createHistory,
  createLayout,
  cutsSlope,
  findConflicts,
  HISTORY_LIMIT,
  layoutFromPreset,
  MAX_WALL_ITEMS,
  mountProduct,
  redoHistory,
  sanitizeLayout,
  undoHistory,
  updateWall,
  WALL_STORAGE_KEY,
} from '../src/lib/wall-studio.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const BAG_KEY = `lumen:${BAG_STORAGE_KEY}`;

async function openStudio(page) {
  await page.goto('/studio-2d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
}

function wallCanvas(page) {
  return page.getByTestId('wall-canvas');
}

function modules(page) {
  return page.getByTestId('wall-module');
}

function moduleOf(page, productId) {
  return page.locator(`[data-testid="wall-module"][data-product="${productId}"]`);
}

function readModule(locator) {
  return locator.evaluate((el) => ({
    uid: el.dataset.uid,
    x: Number(el.dataset.xCm),
    y: Number(el.dataset.yCm),
    finish: el.dataset.finish,
    conflict: el.dataset.conflict === 'true',
  }));
}

async function readPpcm(page) {
  return Number(await wallCanvas(page).getAttribute('data-ppcm'));
}

async function mount(page, name) {
  await page.getByRole('button', { name: `Mount ${name}`, exact: true }).click();
}

async function loadPreset(page, name) {
  await page.getByRole('button', { name: `Load preset ${name}` }).click();
  await expect(page.getByTestId('studio-notice')).toHaveText(`Loaded ${name}.`);
}

// Wall dimensions sit behind a progressive disclosure; open it before typing.
async function openDimensions(page) {
  const toggle = page.getByTestId('wall-dimensions').getByRole('button', { name: /^Dimensions/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(page.getByTestId('wall-width')).toBeVisible();
}

async function commitField(page, testId, value) {
  const input = page.getByTestId(testId);
  await input.fill(String(value));
  await input.press('Enter');
}

function inspector(page) {
  return page.getByTestId('studio-inspector');
}

async function seedWall(page, raw) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [WALL_KEY, raw]);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
}

function readStoredWall(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), WALL_KEY);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('wall studio', () => {
  test('mounts palette parts to scale, drags with quantization, swaps finish and walks undo/redo', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);
    await expect(modules(page)).toHaveCount(0);
    await expect(page.getByTestId('sync-wall-to-bag')).toBeDisabled();

    await mount(page, 'Floating Shelf 110');
    const shelf = moduleOf(page, 'floating-shelf-110');
    await expect(shelf).toHaveCount(1);
    await expect(shelf).toHaveAttribute('data-finish', 'walnut');
    await expect(page.getByTestId('studio-notice')).toHaveText('Mounted Floating Shelf 110 at X 95 / Y 146 cm.');

    const ppcm = await readPpcm(page);
    expect(ppcm).toBeGreaterThan(0);
    expect(ppcm).toBeLessThanOrEqual(2.5);
    const shelfBox = await shelf.boundingBox();
    expect(Math.abs(shelfBox.width - 110 * ppcm)).toBeLessThanOrEqual(1);
    expect(Math.abs(shelfBox.height - 8 * ppcm)).toBeLessThanOrEqual(1);

    await mount(page, 'Modular Cube 36');
    const cube = moduleOf(page, 'modular-cube-36');
    await expect(cube).toHaveAttribute('data-finish', 'oak');
    await expect(page.getByTestId('conflict-count')).toHaveText('0 conflicts');
    await expect(inspector(page).getByTestId('inspector-name')).toHaveText('Modular Cube 36');

    const origin = await readModule(cube);
    const box = await cube.boundingBox();
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const delta = { x: -30, y: 60 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 12 });
    await expect(page.getByTestId('drag-readout')).toHaveText(/^X \d+ \/ Y \d+$/);
    await page.mouse.up();
    await expect(page.getByTestId('drag-readout')).toHaveCount(0);

    const moved = await readModule(cube);
    expect(Math.abs(moved.x - Math.round(origin.x + delta.x / ppcm))).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - Math.round(origin.y - delta.y / ppcm))).toBeLessThanOrEqual(1);
    expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(true);
    await expect(inspector(page).getByTestId('module-x')).toHaveValue(String(moved.x));
    await expect(inspector(page).getByTestId('module-y')).toHaveValue(String(moved.y));
    await expect(page.getByTestId('item-readout')).toHaveText(
      `Modular Cube 36 / X ${moved.x} cm / Y ${moved.y} cm`,
    );

    await inspector(page).getByRole('radio', { name: 'Obsidian' }).check();
    await expect(cube).toHaveAttribute('data-finish', 'obsidian');

    await page.keyboard.press('Control+z');
    await expect(cube).toHaveAttribute('data-finish', 'oak');
    await page.keyboard.press('Control+z');
    expect(await readModule(cube)).toMatchObject({ x: origin.x, y: origin.y, finish: 'oak' });

    await page.keyboard.press('Control+y');
    expect(await readModule(cube)).toMatchObject({ x: moved.x, y: moved.y, finish: 'oak' });
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(cube).toHaveAttribute('data-finish', 'obsidian');
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();

    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(modules(page)).toHaveCount(1);
    await expect(cube).toHaveCount(0);

    const stored = await readStoredWall(page);
    expect(stored.items).toEqual([
      { uid: 'm1', productId: 'floating-shelf-110', finish: 'walnut', xCm: 95, yCm: 146, led: true, locked: false },
    ]);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('wall dimensions, attic slope, snap, presets and collision flags', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);
    const canvas = wallCanvas(page);

    await openDimensions(page);
    await commitField(page, 'wall-width', 360);
    await expect(canvas).toHaveAttribute('data-width-cm', '360');
    await expect(page.getByTestId('wall-label')).toHaveText('Elevation / Wall A / 360 x 250 cm');
    let ppcm = await readPpcm(page);
    let canvasBox = await canvas.boundingBox();
    expect(Math.abs(canvasBox.width - 360 * ppcm)).toBeLessThanOrEqual(1);
    expect(Math.abs(canvasBox.height - 250 * ppcm)).toBeLessThanOrEqual(1);

    await commitField(page, 'wall-height', 999);
    await expect(page.getByTestId('wall-height')).toHaveValue('320');
    await expect(canvas).toHaveAttribute('data-height-cm', '320');

    await commitField(page, 'wall-width', 120);
    await expect(page.getByTestId('wall-width')).toHaveValue('180');
    await expect(page.getByRole('button', { name: 'Mount Recessed 24V Track Bus 200' })).toBeDisabled();

    await commitField(page, 'wall-width', 300);
    await commitField(page, 'wall-height', 250);
    ppcm = await readPpcm(page);
    canvasBox = await canvas.boundingBox();
    expect(Math.abs(canvasBox.width - 300 * ppcm)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button', { name: 'Mount Recessed 24V Track Bus 200' })).toBeEnabled();

    const slope = page.getByRole('switch', { name: /attic slope/i });
    await expect(page.getByTestId('attic-slope')).toHaveCount(0);
    await slope.click();
    await expect(slope).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('attic-slope')).toBeVisible();
    const slopeBox = await page.getByTestId('attic-slope').boundingBox();
    expect(Math.abs(slopeBox.width - 90 * ppcm)).toBeLessThanOrEqual(1);

    await loadPreset(page, 'Attic Study Alcove');
    await expect(modules(page)).toHaveCount(9);
    await expect(page.getByTestId('wall-label')).toHaveText('Elevation / Wall A / 300 x 240 cm');
    await expect(page.getByTestId('conflict-count')).toHaveText('0 conflicts');
    await expect(page.locator('[data-testid="wall-module"][data-conflict="true"]')).toHaveCount(0);

    // Column 18 x 140 at X 270. Slope hypotenuse on a 300 x 240 wall: x + y = 450.
    // Raised to Y 22 its top-right corner (288, 162) sits on the line; Y 23 cuts in.
    const column = moduleOf(page, 'corner-floor-column-140');
    await column.click();
    await commitField(page, 'module-y', 23);
    await expect(column).toHaveAttribute('data-conflict', 'true');
    await expect(inspector(page).getByTestId('inspector-status')).toHaveText('Cuts attic slope');
    await expect(page.getByTestId('conflict-count')).toHaveText('1 conflict');
    await commitField(page, 'module-y', 22);
    await expect(column).toHaveAttribute('data-conflict', 'false');
    await expect(inspector(page).getByTestId('inspector-status')).toHaveText('Clear');
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(column).toHaveAttribute('data-y-cm', '0');

    const lowerCube = page.locator('[data-testid="wall-module"][data-product="modular-cube-36"][data-y-cm="100"]');
    await lowerCube.click();
    await commitField(page, 'module-y', 110);
    await expect(page.getByTestId('conflict-count')).toHaveText('2 conflicts');
    await expect(moduleOf(page, 'modular-cube-36').and(page.locator('[data-conflict="true"]'))).toHaveCount(2);
    await expect(inspector(page).getByTestId('inspector-status')).toHaveText('Overlaps Modular Cube 36');

    await page.getByRole('switch', { name: /grid snap/i }).click();
    await expect(canvas).toHaveAttribute('data-snap', 'true');
    await commitField(page, 'module-x', 143);
    await expect(inspector(page).getByTestId('module-x')).toHaveValue('145');
    await commitField(page, 'module-y', 52);
    await expect(inspector(page).getByTestId('module-y')).toHaveValue('50');
    await expect(page.getByTestId('conflict-count')).toHaveText('0 conflicts');

    await page.getByRole('radio', { name: 'Daylight Elevation' }).check();
    await expect(canvas).toHaveAttribute('data-surface', 'daylight');

    await slope.click();
    await expect(page.getByTestId('attic-slope')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('technical mode draws SKU tags, anchor coordinates and dimension guides', async ({ page }) => {
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openStudio(page);
    await loadPreset(page, 'Nordic Reading Wall');

    await expect(page.getByTestId('technical-overlay')).toBeVisible();
    await expect(page.getByTestId('sku-tag')).toHaveCount(9);
    await expect(page.getByTestId('dimension-guides')).toHaveCount(0);

    // Shelf m2 sits at X 40 / Y 118, 110 x 8 cm, three anchors on its centreline.
    const shelf = page.locator('[data-testid="wall-module"][data-uid="m2"]');
    await shelf.click();
    const guides = page.getByTestId('dimension-guides');
    await expect(guides).toHaveCount(1);
    await expect(guides.locator('.wall-guide--h')).toBeVisible();
    await expect(guides.getByTestId('anchor-label').locator('dd')).toHaveText(['67.5, 122', '95, 122', '122.5, 122']);
    await expect(guides.locator('.wall-guide__label')).toHaveText(['40', '118', '110', '8']);
    await expect(inspector(page).locator('.studio-anchors dd')).toHaveText([
      'X 67.5 / Y 122',
      'X 95 / Y 122',
      'X 122.5 / Y 122',
    ]);

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: /architectural/i }).click();
    await expect(page.getByTestId('technical-overlay')).toHaveCount(0);
  });

  test('sync wall to bag merges the composition and the drawer matches its telemetry', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);
    await loadPreset(page, 'Nordic Reading Wall');

    const spot = page.locator('[data-testid="wall-module"][data-uid="m9"]');
    await spot.click();
    await inspector(page).getByRole('radio', { name: 'Chalk' }).check();
    await expect(spot).toHaveAttribute('data-finish', 'chalk');

    const column = page.locator('[data-testid="wall-module"][data-uid="m1"]');
    await column.click();
    await inspector(page).getByTestId('led-channel').click();
    await expect(column).toHaveAttribute('data-led', 'false');

    const preset = getWallPreset('nordic-reading-wall');
    const items = preset.items.map((entry, i) => (i === 8 ? { ...entry, finish: 'chalk' } : entry));
    const expected = aggregateBagLines(items);
    const priceUsd = items.reduce((sum, entry) => sum + getProduct(entry.productId).priceUsd, 0);
    const loadW = items.reduce((sum, entry) => sum + getProduct(entry.productId).watts, 0);
    const columnPart = getProduct('corner-floor-column-140');
    const flux = items.reduce((sum, entry) => sum + getProduct(entry.productId).lumens, 0) - columnPart.lumens;
    expect(expected).toHaveLength(7);
    expect(loadW).toBe(108);

    await expect(page.getByTestId('wall-modules')).toHaveText('09');
    await expect(page.getByTestId('wall-load')).toHaveText(`${loadW} W`);
    await expect(page.getByTestId('wall-active-load')).toHaveText(`${loadW - columnPart.watts} W live`);
    await expect(page.getByTestId('wall-flux')).toHaveText(`${flux.toLocaleString('en-US')} lm`);
    await expect(page.getByTestId('wall-price')).toHaveText(formatUsd(priceUsd));
    await expect(page.getByTestId('wall-psu')).toHaveText(recommendPsu(loadW).label);

    const sync = page.getByTestId('sync-wall-to-bag');
    await sync.click();
    const drawer = page.getByRole('dialog', { name: 'Cart' });
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('sync-status')).toHaveText('Synced 9 modules as 7 cart lines.');
    await expect(page.getByRole('button', { name: 'Cart (9)' })).toBeVisible();

    const lines = drawer.getByTestId('bag-line');
    await expect(lines).toHaveCount(expected.length);
    for (const line of expected) {
      const row = drawer.locator(`[data-testid="bag-line"][data-line="${line.id}:${line.finish}"]`);
      const product = getProduct(line.id);
      await expect(row.getByTestId('bag-line-qty')).toHaveText(String(line.qty));
      await expect(row).toContainText(`${product.sku} / ${getFinish(line.finish).label} / ${product.watts} W`);
    }
    await expect(drawer.getByTestId('bag-subtotal')).toHaveText(formatUsd(priceUsd));
    await expect(drawer.getByTestId('bag-load')).toHaveText(`${loadW} W`);
    await expect(drawer.getByTestId('bag-psu')).toHaveText(recommendPsu(loadW).label);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(sync).toBeFocused();

    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), BAG_KEY);
    expect(stored).toEqual(expected);

    // A second sync merges into the existing lines instead of replacing them.
    await sync.click();
    await expect(page.getByRole('button', { name: 'Cart (18)' })).toBeVisible();
    await expect(drawer.getByTestId('bag-load')).toHaveText(`${loadW * 2} W`);
    await expect(drawer.getByTestId('bag-psu')).toHaveText('Multi-bus 24V Driver Array');
    await expect(
      drawer.locator('[data-testid="bag-line"][data-line="floating-shelf-110:walnut"]').getByTestId('bag-line-qty'),
    ).toHaveText('4');
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('tampered storage falls back to a clean wall without errors or CSP violations', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);

    const hostile = [
      '{"format":"lumen.wall","version":1,"items":[',
      JSON.stringify('<img src=x onerror=alert(1)>'),
      '{"__proto__":{"polluted":true},"format":"lumen.wall","version":1,"wall":{},"items":[]}',
      '{"format":"lumen.wall","version":2,"wall":{},"items":[]}',
      '{"version":1,"wall":{},"items":[]}',
      '{"format":"lumen.wall","version":1,"wall":{},"items":{"0":{}}}',
      '[]',
      'null',
      `{"format":"lumen.wall","version":1,"items":${'['.repeat(40)}${']'.repeat(40)}}`,
    ];

    for (const raw of hostile) {
      await seedWall(page, raw);
      await expect(modules(page), raw).toHaveCount(0);
      await expect(page.getByTestId('wall-label'), raw).toHaveText('Elevation / Wall A / 300 x 250 cm');
      const stored = await readStoredWall(page);
      expect(stored, raw).toEqual(createLayout());
    }

    const entries = [
      { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: 40.4, yCm: 120, led: true },
      { uid: 'm1', productId: 'modular-cube-36', finish: 'chalk', xCm: -500, yCm: 1e9, led: 'yes', locked: 'true' },
      { uid: '<img src=x onerror=alert(1)>', productId: 'linear-lightbar-60', finish: 'walnut', xCm: 10, yCm: 10, led: false },
      { uid: 'm7', productId: 'track-bus-200', finish: 'walnut', xCm: 0, yCm: 0 },
      { uid: 'm8', productId: 'lmn-unknown-999', finish: 'oak', xCm: 0, yCm: 0 },
      { uid: 'm9', productId: 'constructor', finish: 'oak', xCm: 0, yCm: 0 },
      { uid: 'm10', productId: 'modular-cube-36', finish: 'oak', xCm: '40', yCm: 0 },
      { uid: 'm11', productId: 'modular-cube-36', finish: 'oak', xCm: null, yCm: 0 },
      null,
      'floating-shelf-110',
      [1, 2, 3],
    ];
    const payload = JSON.stringify({
      format: 'lumen.wall',
      version: 1,
      wall: { widthCm: 9999, heightCm: -5, slope: 'yes', snap: 1, surface: 'javascript:alert(1)' },
      items: entries,
    }).replace('{"uid":"m1","productId":"floating', '{"__proto__":{"locked":true},"uid":"m1","productId":"floating');

    await seedWall(page, payload);
    await expect(modules(page)).toHaveCount(3);
    await expect(page.getByTestId('wall-label')).toHaveText('Elevation / Wall A / 400 x 180 cm');
    await expect(page.getByTestId('attic-slope')).toHaveCount(0);

    const stored = await readStoredWall(page);
    expect(stored.wall).toEqual({ widthCm: 400, heightCm: 180, slope: false, snap: false, surface: 'ambient' });
    expect(stored.items).toEqual([
      { uid: 'm1', productId: 'floating-shelf-110', finish: 'oak', xCm: 40, yCm: 120, led: true, locked: false },
      { uid: 'm2', productId: 'modular-cube-36', finish: 'chalk', xCm: 0, yCm: 144, led: true, locked: false },
      { uid: 'm3', productId: 'linear-lightbar-60', finish: 'walnut', xCm: 10, yCm: 10, led: false, locked: false },
    ]);

    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect(await page.evaluate(() => ({}).locked)).toBeUndefined();
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('exports a JSON layout and imports it back, rejecting hostile files', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);
    await loadPreset(page, 'Acoustic Media Spine');

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('lumen-wall-300x250.json');
    const file = await download.path();
    const exported = JSON.parse(await readFile(file, 'utf-8'));
    expect(exported).toEqual(await readStoredWall(page));
    expect(exported.items).toHaveLength(9);

    await page.getByRole('button', { name: 'Clear wall' }).click();
    await page.getByRole('button', { name: 'Confirm: clear 9' }).click();
    await expect(modules(page)).toHaveCount(0);

    const importer = page.getByTestId('import-layout');
    await importer.setInputFiles(file);
    await expect(page.getByTestId('studio-notice')).toHaveText('Imported 9 modules.');
    await expect(modules(page)).toHaveCount(9);
    expect(await readStoredWall(page)).toEqual(exported);

    const upload = (name, text) =>
      importer.setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

    await upload('hostile.json', '{"__proto__":{"polluted":true},"items":[]}');
    await expect(page.getByTestId('studio-notice')).toHaveText('Import rejected: not a Lumen wall layout.');
    await upload('broken.json', '{"format":"lumen.wall",');
    await expect(page.getByTestId('studio-notice')).toHaveText('Import rejected: not a Lumen wall layout.');
    await upload('huge.json', `{"pad":"${'x'.repeat(120_000)}"}`);
    await expect(page.getByTestId('studio-notice')).toHaveText('Import rejected: file exceeds 100 KB.');
    await expect(modules(page)).toHaveCount(9);

    await upload(
      'partial.json',
      JSON.stringify({
        format: 'lumen.wall',
        version: 1,
        wall: { widthCm: 250, heightCm: 220 },
        items: [
          { uid: 'm1', productId: 'acoustic-art-frame-50x70', finish: 'walnut', xCm: 20, yCm: 80 },
          { uid: 'm2', productId: 'acoustic-art-frame-50x70', finish: 'gold', xCm: 90, yCm: 80 },
          { uid: 'm3', productId: '<script>', finish: 'oak', xCm: 0, yCm: 0 },
        ],
      }),
    );
    await expect(page.getByTestId('studio-notice')).toHaveText('Imported 1 module, 2 rejected.');
    await expect(modules(page)).toHaveCount(1);
    await expect(page.getByTestId('wall-label')).toHaveText('Elevation / Wall A / 250 x 220 cm');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(modules(page)).toHaveCount(9);
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('keyboard nudges, locks and removes modules', async ({ page }) => {
    await openStudio(page);
    await mount(page, 'Linear Lightbar 60');
    const bar = moduleOf(page, 'linear-lightbar-60');
    const origin = await readModule(bar);

    await bar.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await readModule(bar)).toMatchObject({ x: origin.x - 9, y: origin.y + 1 });

    await inspector(page).getByRole('button', { name: 'Lock' }).click();
    await expect(bar).toHaveAttribute('data-locked', 'true');
    await expect(inspector(page).getByTestId('module-x')).toBeDisabled();
    await expect(inspector(page).getByRole('button', { name: 'Remove' })).toBeDisabled();
    await bar.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Delete');
    expect(await readModule(bar)).toMatchObject({ x: origin.x - 9, y: origin.y + 1 });

    await inspector(page).getByRole('button', { name: 'Unlock' }).click();
    await inspector(page).getByRole('button', { name: 'Duplicate' }).click();
    await expect(bar).toHaveCount(2);
    await expect(page.getByTestId('conflict-count')).toHaveText('0 conflicts');

    await bar.first().focus();
    await page.keyboard.press('Delete');
    await expect(bar).toHaveCount(1);
  });

  test('progressive disclosure keeps dimensions folded and coordinates out until a module is selected', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openStudio(page);

    const disclosure = page.getByTestId('wall-dimensions');
    const toggle = disclosure.getByRole('button', { name: /^Dimensions/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('300 x 250 cm');
    await expect(page.getByTestId('wall-width')).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('wall-width')).toBeVisible();
    await commitField(page, 'wall-height', 280);
    await expect(toggle).toContainText('300 x 280 cm');
    await toggle.click();
    await expect(page.getByTestId('wall-width')).toBeHidden();

    // Nothing selected: the inspector lists modules without coordinate inputs,
    // and each row shows its coordinates only under the pointer.
    await loadPreset(page, 'Nordic Reading Wall');
    await expect(inspector(page).getByTestId('module-x')).toHaveCount(0);
    const row = inspector(page).locator('.module-list__item').first();
    const coords = row.locator('.module-list__coords');
    await expect(coords).toHaveCSS('opacity', '0');
    await row.hover();
    await expect(coords).toHaveCSS('opacity', '1');

    await page.locator('[data-testid="wall-module"][data-uid="m2"]').click();
    const position = inspector(page).locator('.studio-inspector__position');
    await expect(position).toHaveCSS('animation-name', 'lumen-unfold');
    await expect(inspector(page).getByTestId('module-x')).toBeVisible();
    await expect(inspector(page).getByTestId('module-x')).toHaveValue('40');
    await inspector(page).getByRole('button', { name: 'Done' }).click();
    await expect(inspector(page).getByTestId('module-x')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('dragging a module dims the surrounding chrome and the other modules', async ({ page }) => {
    await openStudio(page);
    await loadPreset(page, 'Nordic Reading Wall');

    const palette = page.locator('.studio-layout__palette');
    const summary = page.getByTestId('wall-summary');
    const cube = page.locator('[data-testid="wall-module"][data-uid="m4"]');
    const other = page.locator('[data-testid="wall-module"][data-uid="m5"]');
    const opacity = (locator) => locator.evaluate((el) => Number(getComputedStyle(el).opacity));

    await cube.scrollIntoViewIfNeeded();
    const box = await cube.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2 - 20, { steps: 8 });
    await expect(cube).toHaveAttribute('data-dragging', 'true');

    await expect.poll(() => opacity(palette)).toBeLessThan(0.4);
    await expect.poll(() => opacity(summary)).toBeLessThan(0.4);
    await expect.poll(() => opacity(other)).toBeLessThan(0.6);
    expect(await opacity(cube)).toBe(1);
    await expect(page.getByTestId('drag-readout')).toBeVisible();

    await page.mouse.up();
    await expect(cube).not.toHaveAttribute('data-dragging');
    await expect.poll(() => opacity(palette)).toBe(1);
    await expect.poll(() => opacity(other)).toBe(1);
  });

  test('the studio fits every viewport from 360px to 1600px without overflow', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openStudio(page);
    await loadPreset(page, 'Nordic Reading Wall');
    await openDimensions(page);
    await commitField(page, 'wall-width', 400);
    await commitField(page, 'wall-height', 320);
    await page.locator('[data-testid="wall-module"][data-uid="m7"]').click();

    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByTestId('wall-canvas')).toHaveAttribute('data-width-cm', '400');
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);

      const frame = await page.getByRole('region', { name: 'Wall elevation' }).boundingBox();
      const canvas = await page.getByTestId('wall-canvas').boundingBox();
      expect(frame.x + frame.width, `${width}px frame`).toBeLessThanOrEqual(width);
      expect(canvas.x + canvas.width, `${width}px canvas`).toBeLessThanOrEqual(frame.x + frame.width);
      expect(canvas.x, `${width}px canvas`).toBeGreaterThanOrEqual(frame.x);

      const sync = await page.getByTestId('sync-wall-to-bag').boundingBox();
      expect(sync.x + sync.width, `${width}px sync`).toBeLessThanOrEqual(width);
    }
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('wall studio model', () => {
  test('every preset is collision-free and inside its wall', () => {
    expect(WALL_PRESETS.map((preset) => preset.name)).toEqual([
      'Nordic Reading Wall',
      'Acoustic Media Spine',
      'Attic Study Alcove',
    ]);
    for (const preset of WALL_PRESETS) {
      const layout = layoutFromPreset(preset.id);
      expect(findConflicts(layout).size, preset.name).toBe(0);
      expect(sanitizeLayout(JSON.parse(JSON.stringify(layout))), preset.name).toEqual(layout);
    }
  });

  test('auto placement never collides while the wall has room', () => {
    let layout = createLayout();
    for (let round = 0; round < 3; round += 1) {
      for (const product of PRODUCTS) {
        const result = mountProduct(layout, product.id);
        if (!result?.clear) continue;
        layout = result.layout;
        expect(findConflicts(layout).size, `${product.id} round ${round}`).toBe(0);
      }
    }
    expect(layout.items.length).toBeGreaterThan(12);
    expect(layout.items.length).toBeLessThanOrEqual(MAX_WALL_ITEMS);
  });

  test('slope test is exact on the hypotenuse and resizing pulls modules inside', () => {
    const wall = { widthCm: 300, heightCm: 250, slope: true };
    // Hypotenuse: x + y = 300 + 250 - 90 = 460. A 10 x 10 box touching it is clear.
    expect(cutsSlope({ x: 220, y: 220, w: 10, h: 10 }, wall)).toBe(false);
    expect(cutsSlope({ x: 221, y: 220, w: 10, h: 10 }, wall)).toBe(true);
    expect(cutsSlope({ x: 221, y: 220, w: 10, h: 10 }, { ...wall, slope: false })).toBe(false);

    const layout = layoutFromPreset('nordic-reading-wall');
    const narrow = updateWall(layout, { widthCm: 180, heightCm: 200 });
    const track = narrow.items.find((item) => item.productId === 'track-bus-200');
    expect(track).toMatchObject({ xCm: 0, yCm: 197 });
    expect(findConflicts(narrow).get(track.uid).bounds).toBe(true);
    expect(updateWall(layout, { widthCm: 300 })).toBe(layout);
  });

  test('history keeps 30 steps and a new edit clears redo', () => {
    let history = createHistory(createLayout());
    for (let i = 1; i <= HISTORY_LIMIT + 5; i += 1) {
      history = commitHistory(history, updateWall(history.present, { widthCm: 180 + i }));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.present.wall.widthCm).toBe(180 + HISTORY_LIMIT + 5);

    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = undoHistory(history);
    expect(history.past).toHaveLength(0);
    expect(history.present.wall.widthCm).toBe(185);
    expect(history.future).toHaveLength(HISTORY_LIMIT);

    history = redoHistory(history);
    expect(history.present.wall.widthCm).toBe(186);
    history = commitHistory(history, updateWall(history.present, { heightCm: 300 }));
    expect(history.future).toHaveLength(0);
    expect(commitHistory(history, history.present)).toBe(history);
  });

  test('aggregates modules into bag lines by part and finish', () => {
    expect(
      aggregateBagLines([
        { productId: 'modular-cube-36', finish: 'oak' },
        { productId: 'floating-shelf-110', finish: 'walnut' },
        { productId: 'modular-cube-36', finish: 'oak' },
        { productId: 'modular-cube-36', finish: 'chalk' },
      ]),
    ).toEqual([
      { id: 'modular-cube-36', finish: 'oak', qty: 2 },
      { id: 'floating-shelf-110', finish: 'walnut', qty: 1 },
      { id: 'modular-cube-36', finish: 'chalk', qty: 1 },
    ]);
  });
});
