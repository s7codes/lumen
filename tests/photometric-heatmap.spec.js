import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { formatInt } from '../src/lib/format.js';
import {
  computeFloorLuxField,
  computeWallLuxField,
  createWallLuxProbe,
  ISO_LUX_LEVELS,
  isoLuxContours,
  luxColor,
} from '../src/lib/illuminance-field.js';
import { createRoomState } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics } from '../src/lib/room-physics.js';
import { createLayout, DEFAULT_WALL, SLOPE_CM } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const SHELF = 'floating-shelf-110';
const LIGHTBAR = 'linear-lightbar-60';
const FRAME = 'acoustic-art-frame-50x70';
const TRACK = 'track-bus-200';

function module(productId, xCm, yCm, { uid = 'm1', led = true } = {}) {
  const product = getProduct(productId);
  return { uid, productId, finish: product.defaultFinish, xCm, yCm, led: product.watts > 0 && led, locked: false };
}

function wallOf(items, wall = {}) {
  return createLayout({ ...DEFAULT_WALL, ...wall }, items);
}

function roomOf(items) {
  return createRoomState(undefined, items);
}

function stats(field) {
  return {
    peak: field.peakLux,
    avg: field.avgLux,
    uniformity: field.uniformityRatio.toFixed(2),
    hotspot: field.hotspot ? [field.hotspot.xCm, field.hotspot.yCm] : null,
  };
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('illuminance field engine', () => {
  test('every lit module off reads zero direct lux on the wall and the floor', () => {
    const items = [module(SHELF, 95, 146, { led: false }), module(LIGHTBAR, 40, 60, { uid: 'm2', led: false }), module(TRACK, 50, 228, { uid: 'm3' })];
    for (const field of [computeWallLuxField(wallOf(items)), computeFloorLuxField(roomOf(items))]) {
      expect(field.sources).toBe(0);
      expect(field.directPeakLux).toBe(0);
      expect(field.direct.every((lux) => lux === 0)).toBe(true);
      // No flux means no inter-reflected bounce either.
      expect(field.ambientLux).toBe(0);
      expect(field.values.every((lux) => lux === 0)).toBe(true);
      expect(field.hotspot).toBeNull();
      expect(field.uniformityRatio).toBe(0);
    }
    expect(computeWallLuxField(wallOf([])).cells).toBe(24 * 16);
  });

  test('illuminance rises monotonically at every point as modules switch on', () => {
    const off = [module(SHELF, 95, 146, { led: false }), module(LIGHTBAR, 30, 60, { uid: 'm2', led: false })];
    const one = [module(SHELF, 95, 146), off[1]];
    const both = [module(SHELF, 95, 146), module(LIGHTBAR, 30, 60, { uid: 'm2' })];

    for (const compute of [(items) => computeWallLuxField(wallOf(items)), (items) => computeFloorLuxField(roomOf(items))]) {
      const [a, b, c] = [compute(off), compute(one), compute(both)];
      for (const [lo, hi] of [
        [a, b],
        [b, c],
      ]) {
        expect(hi.values.every((lux, k) => lux >= lo.values[k])).toBe(true);
        expect(hi.values.some((lux, k) => lux > lo.values[k])).toBe(true);
        expect(hi.avgLux).toBeGreaterThan(lo.avgLux);
        expect(hi.peakLux).toBeGreaterThanOrEqual(lo.peakLux);
      }
      // The ambient floor is the cavity bounce of the lumen method.
      expect(c.ambientLux).toBe(computeEnvironmentalPhysics(c.surface === 'wall' ? wallOf(both) : roomOf(both)).reflectedLux);
      expect(c.ambientLux).toBeGreaterThan(b.ambientLux);
    }
  });

  test('the hotspot sits beneath a Floating Shelf 110 and a Linear Lightbar 60', () => {
    const shelf = computeWallLuxField(wallOf([module(SHELF, 95, 146)]));
    expect(shelf.hotspot.xCm).toBe(95 + 55);
    expect(shelf.hotspot.yCm).toBeLessThan(146);
    expect(shelf.hotspot.yCm).toBeGreaterThan(146 - 40);
    expect(shelf.peakLux).toBeGreaterThan(shelf.avgLux);
    expect(shelf.avgLux).toBeGreaterThanOrEqual(shelf.minLux);
    expect(shelf.minLux).toBeGreaterThanOrEqual(Math.floor(shelf.ambientLux));

    const floor = computeFloorLuxField(roomOf([module(SHELF, 95, 146)]));
    expect(floor.hotspot.xCm).toBe(150);
    // The shelf's front-lip channel is 23 cm out from the wall.
    expect(floor.hotspot.yCm).toBe(23);

    const bar = computeWallLuxField(wallOf([module(LIGHTBAR, 120, 140)]));
    expect(bar.hotspot.xCm).toBe(120 + 30);
    expect(bar.hotspot.yCm).toBeLessThanOrEqual(142);
    expect(bar.hotspot.yCm).toBeGreaterThan(140 - 10);

    // The probe reads the same law at any point; peak beneath beats a far corner.
    const probe = createWallLuxProbe(wallOf([module(SHELF, 95, 146)]));
    expect(probe(shelf.hotspot.xCm, shelf.hotspot.yCm)).toBe(shelf.hotspot.lux);
    expect(probe(5, 245)).toBeLessThan(probe(150, 124));
    expect(probe(-1, 10)).toBeNull();
  });

  test('the hotspot follows a module cm for cm when it is dragged or nudged', () => {
    const base = computeWallLuxField(wallOf([module(SHELF, 60, 140)]));
    for (const [dx, dy] of [
      [1, 0],
      [5, 0],
      [37, -12],
      [-20, 25],
    ]) {
      const moved = computeWallLuxField(wallOf([module(SHELF, 60 + dx, 140 + dy)]));
      expect(moved.hotspot.xCm - base.hotspot.xCm).toBe(dx);
      expect(moved.hotspot.yCm - base.hotspot.yCm).toBe(dy);
      expect(moved.hotspot.lux).toBe(base.hotspot.lux);

      const floorBase = computeFloorLuxField(roomOf([module(SHELF, 60, 140)]));
      const floorMoved = computeFloorLuxField(roomOf([module(SHELF, 60 + dx, 140 + dy)]));
      expect(floorMoved.hotspot.xCm - floorBase.hotspot.xCm).toBe(dx);
      expect(floorMoved.hotspot.yCm).toBe(floorBase.hotspot.yCm);
    }
    // Deterministic: the same layout gives the same field, value for value.
    expect(computeWallLuxField(wallOf([module(SHELF, 60, 140)]))).toEqual(base);
  });

  test('statistics, iso-lux thresholds, slope masking and the false-colour ramp', () => {
    const items = [module(SHELF, 30, 150), module(LIGHTBAR, 180, 120, { uid: 'm2' }), module(FRAME, 120, 40, { uid: 'm3' })];
    const field = computeWallLuxField(wallOf(items));
    const masked = field.values.filter((_, k) => field.mask[k]);
    expect(field.minLux).toBe(Math.round(Math.min(...masked)));
    expect(field.uniformityRatio).toBeCloseTo(field.minLux / field.avgLux, 1);
    expect(field.isoLux.map((level) => level.lux)).toEqual([...ISO_LUX_LEVELS]);
    expect(ISO_LUX_LEVELS).toEqual([100, 250, 500]);
    const areas = field.isoLux.map((level) => level.areaPct);
    expect(areas).toEqual([...areas].sort((a, b) => b - a));

    const contours = isoLuxContours(field);
    expect(contours.map((c) => c.lux)).toEqual([100, 250, 500]);
    for (const contour of contours) {
      for (const [x1, y1, x2, y2] of contour.segments) {
        for (const x of [x1, x2]) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(DEFAULT_WALL.widthCm);
        }
        for (const y of [y1, y2]) {
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(DEFAULT_WALL.heightCm);
        }
      }
    }

    // An attic slope removes the top-right triangle from the statistics and the probe.
    const sloped = computeWallLuxField(wallOf(items, { slope: true }));
    expect(sloped.cells).toBeLessThan(sloped.cols * sloped.rows);
    const probe = createWallLuxProbe(wallOf(items, { slope: true }));
    expect(probe(DEFAULT_WALL.widthCm - 5, DEFAULT_WALL.heightCm - 5)).toBeNull();
    expect(probe(DEFAULT_WALL.widthCm - SLOPE_CM - 5, DEFAULT_WALL.heightCm - 5)).not.toBeNull();

    // Basalt at the dark end, warm alabaster at the bright end, rising luminance between.
    const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    expect(luxColor(0)).toEqual([18, 17, 16]);
    expect(luxColor(100000)).toEqual([246, 239, 228]);
    const ramp = [10, 50, 100, 250, 500, 1000].map((lux) => luma(luxColor(lux)));
    expect(ramp).toEqual([...ramp].sort((a, b) => a - b));
  });
});

/* The 2D Wall Studio and its iso-lux overlay are retired; the wall field engine above
   still lights the 3D planner and the blueprint, so its math stays covered in Node. */

/* Room Planner */

async function readRoomItems(page) {
  return page.getByTestId('room-module').evaluateAll((nodes) =>
    nodes.map((node) => ({
      uid: node.dataset.uid,
      productId: node.dataset.product,
      finish: node.dataset.finish,
      xCm: Number(node.dataset.xCm),
      yCm: Number(node.dataset.yCm),
      led: node.dataset.led === 'true',
    })),
  );
}

async function expectFloorLux(page) {
  const field = computeFloorLuxField(roomOf(await readRoomItems(page)));
  const mirror = page.getByTestId('room-floor-lux');
  await expect(mirror).toHaveAttribute('data-peak-lux', String(field.peakLux));
  await expect(mirror).toHaveAttribute('data-avg-lux', String(field.avgLux));
  await expect(mirror).toHaveAttribute('data-uniformity', field.uniformityRatio.toFixed(2));
  await expect(mirror).toHaveAttribute('data-sources', String(field.sources));
  const summary = page.getByTestId('floor-lux-summary');
  await expect(summary.getByTestId('floor-lux-line')).toHaveText(
    `Peak ${formatInt(field.peakLux)} lx / Avg ${formatInt(field.avgLux)} lx`,
  );
  await expect(summary).toHaveAttribute('data-uniformity', field.uniformityRatio.toFixed(2));
  return field;
}

test.describe('room planner floor lux grid', () => {
  test('the floor grid follows modules as they mount and switch off', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await page.getByRole('button', { name: `Mount ${getProduct(SHELF).name}`, exact: true }).click();
    await expect(page.getByTestId('room-module')).toHaveCount(1);

    await page.getByTestId('camera-settings-toggle').click();
    const grid = page.getByTestId('toggle-floor-lux-grid');
    await expect(grid).toHaveAttribute('role', 'switch');
    await expect(grid).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('room-floor-lux')).toHaveCount(0);
    await expect(page.getByTestId('floor-lux-summary')).toHaveCount(0);

    await grid.click();
    await expect(grid).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('room-viewport')).toHaveAttribute('data-floor-lux', 'true');
    const shelfOnly = await expectFloorLux(page);
    const [shelf] = await readRoomItems(page);
    await expect(page.getByTestId('room-floor-lux')).toHaveAttribute('data-hotspot-x', String(shelf.xCm + 55));
    await expect(page.getByTestId('room-floor-lux')).toHaveAttribute('data-hotspot-y', '23');
    await expect(page.getByTestId('floor-lux-detail')).toContainText(`hotspot X ${shelf.xCm + 55} Y 23 cm`);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: `Mount ${getProduct(LIGHTBAR).name}`, exact: true }).click();
    await expect(page.getByTestId('room-module')).toHaveCount(2);
    const lit = await expectFloorLux(page);
    expect(lit.avgLux).toBeGreaterThan(shelfOnly.avgLux);
    expect(lit.sources).toBeGreaterThan(shelfOnly.sources);

    // The new lightbar is selected; its channel switches off from the inspector.
    await page.getByTestId('room-led-channel').click();
    await expect(page.locator(`[data-testid="room-module"][data-product="${LIGHTBAR}"]`)).toHaveAttribute('data-led', 'false');
    const dimmed = await expectFloorLux(page);
    expect(dimmed.sources).toBe(shelfOnly.sources);
    expect(dimmed.avgLux).toBeLessThan(lit.avgLux);
    expect(dimmed.hotspot).toEqual({ ...shelfOnly.hotspot, lux: dimmed.hotspot.lux });

    await page.getByTestId('room-inspector').getByRole('button', { name: 'Done' }).click();
    await page.locator(`[data-testid="room-module-list"] [data-uid="${shelf.uid}"]`).click();
    await page.getByTestId('room-led-channel').click();
    const dark = await expectFloorLux(page);
    expect(stats(dark)).toEqual({ peak: 0, avg: 0, uniformity: '0.00', hotspot: null });
    await expect(page.getByTestId('room-floor-lux')).toHaveAttribute('data-direct-peak-lux', '0');
    await expect(page.getByTestId('floor-lux-detail')).toContainText('no lit modules');

    await page.getByTestId('camera-settings-toggle').click();
    await grid.click();
    await expect(grid).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByTestId('room-floor-lux')).toHaveCount(0);
    await expect(page.getByTestId('floor-lux-summary')).toHaveCount(0);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
