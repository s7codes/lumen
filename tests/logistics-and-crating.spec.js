import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { PRODUCTS } from '../src/data/products.js';
import { recommendPsu, resolveBagLines } from '../src/lib/bag.js';
import { DRIVERS } from '../src/lib/drivers.js';
import {
  computeLogisticsSchedule,
  FREIGHT_CLASSES,
  parseLeadWeeks,
} from '../src/lib/logistics.js';
import { buildQuote } from '../src/lib/quote.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const BAG_KEY = 'lumen:lumen_bag_v1';

// Track bus ships in a week; the sideboard is studio-built at 4-6 weeks. 18 W sizes one 60W driver.
const ROUGH_IN_BAG = [
  { id: 'track-bus-200', finish: 'obsidian', qty: 1 },
  { id: 'compact-sideboard-75', finish: 'walnut', qty: 1 },
];
// USD 95 + 320 + 58 driver = 47,300 cents net; 27% VAT = 12,771.
const ROUGH_IN_GROSS_MINOR = 47300 + 12771;

const MIXED_BAG = [
  { id: 'track-bus-200', finish: 'obsidian', qty: 1 },
  { id: 'linear-pendant-150', finish: 'obsidian', qty: 1 },
  { id: 'compact-sideboard-75', finish: 'walnut', qty: 1 },
  { id: 'floating-shelf-110', finish: 'oak', qty: 1 },
  { id: 'directional-spot-monopoint', finish: 'obsidian', qty: 1 },
];

const tenths = (kg) => Math.round(kg * 10);

function scheduleFor(items, options) {
  const bagLines = resolveBagLines(items);
  const loadW = bagLines.reduce((sum, line) => sum + line.lineW, 0);
  return computeLogisticsSchedule(bagLines, { psu: recommendPsu(loadW), driverIncluded: true }, options);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('physical weights and crate packing engine', () => {
  test('every part carries a mass and the spec sheet reads it out', async ({ page }) => {
    for (const product of PRODUCTS) {
      expect(Number.isFinite(product.weightKg), product.id).toBe(true);
      expect(product.weightKg).toBeGreaterThanOrEqual(1.4);
      expect(product.weightKg).toBeLessThanOrEqual(18.5);
    }
    expect(DRIVERS['driver-60'].weightKg).toBe(0.6);
    expect(DRIVERS['driver-150'].weightKg).toBe(1.2);

    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog/floating-shelf-110');
    const row = page.getByTestId('spec-weight');
    await expect(row).toHaveText('6.8 kg');
    await expect(row.locator('xpath=preceding-sibling::dt')).toHaveText('Mass / Weight');
    expect(errors).toEqual([]);
  });

  test('mass, tare and crate grouping are deterministic and escalate freight class', () => {
    const schedule = scheduleFor(MIXED_BAG);
    expect(schedule).toEqual(scheduleFor(MIXED_BAG));

    // 2.4 + 4.6 + 18.5 + 6.8 + 1.4 parts, 69 W load so one 150W driver at 1.2 kg.
    expect(schedule.netWeightKg).toBe(34.9);
    expect(tenths(schedule.netWeightKg) + tenths(schedule.tareWeightKg)).toBe(tenths(schedule.grossWeightKg));
    expect(Math.abs(schedule.tareWeightKg - schedule.netWeightKg * 0.18)).toBeLessThanOrEqual(0.05);
    expect(schedule.pieceCount).toBe(6);

    expect(schedule.crates.map((crate) => crate.code)).toEqual(['CRT-01', 'CRT-02', 'CRT-03']);
    const [tube, millwork, carton] = schedule.crates;
    expect(tube.label).toBe('Long-Span Timber Tube');
    expect(tube.skus.toSorted()).toEqual(['LMN-PD-150', 'LMN-TR-200']);
    expect(tube.dimsCm.w).toBeGreaterThanOrEqual(200);
    expect(millwork.label).toBe('Reinforced Millwork Crate');
    expect(millwork.skus.toSorted()).toEqual(['LMN-SB-075', 'LMN-SH-110']);
    expect(carton.label).toBe('Precision Hardware Carton');
    expect(carton.skus.toSorted()).toEqual(['LMN-DR-150', 'LMN-SP-012']);

    const crateGross = schedule.crates.reduce((sum, crate) => sum + tenths(crate.grossWeightKg), 0);
    expect(crateGross).toBe(tenths(schedule.grossWeightKg));
    expect(schedule.crates.reduce((sum, crate) => sum + crate.itemCount, 0)).toBe(schedule.pieceCount);
    const crateVolume = schedule.crates.reduce((sum, c) => sum + c.dimsCm.w * c.dimsCm.h * c.dimsCm.d, 0) / 1e6;
    expect(schedule.totalVolumeM3).toBeCloseTo(crateVolume, 2);
    expect(schedule.freightClass).toBe(FREIGHT_CLASSES.van);

    // Corner column and baffle also go long-span; cube and art frame go millwork.
    const spans = scheduleFor([
      { id: 'corner-floor-column-140', finish: 'oak', qty: 1 },
      { id: 'acoustic-baffle-120', finish: 'oak', qty: 1 },
      { id: 'modular-cube-36', finish: 'oak', qty: 1 },
      { id: 'acoustic-art-frame-50x70', finish: 'oak', qty: 1 },
    ]);
    expect(spans.crates.map((crate) => [crate.type, crate.skus.toSorted()])).toEqual([
      ['long-span', ['LMN-AB-120', 'LMN-CL-140']],
      ['millwork', ['LMN-AF-070', 'LMN-CB-036']],
      ['hardware', ['LMN-DR-060']],
    ]);

    const heavy = scheduleFor([{ id: 'compact-sideboard-75', finish: 'walnut', qty: 4 }]);
    expect(heavy.grossWeightKg).toBeGreaterThanOrEqual(65);
    expect(heavy.freightClass).toBe(FREIGHT_CLASSES.pallet);
    expect(heavy.crates.filter((crate) => crate.type === 'millwork').length).toBeGreaterThanOrEqual(2);

    const parcel = scheduleFor([{ id: 'directional-spot-monopoint', finish: 'obsidian', qty: 1 }]);
    expect(parcel.freightClass).toBe(FREIGHT_CLASSES.parcel);
    // 1.4 + 0.6 kg is under the tare floor: 18% would be 0.4 kg.
    expect(parcel.tareWeightKg).toBe(0.8);
    expect(parcel.grossWeightKg).toBe(2.8);

    const longLight = scheduleFor([{ id: 'track-bus-200', finish: 'obsidian', qty: 1 }]);
    expect(longLight.grossWeightKg).toBeLessThan(35);
    expect(longLight.longestCrateCm).toBeGreaterThan(160);
    expect(longLight.freightClass).toBe(FREIGHT_CLASSES.van);

    const empty = computeLogisticsSchedule([], { psu: recommendPsu(0), driverIncluded: false });
    expect(empty).toMatchObject({ netWeightKg: 0, tareWeightKg: 0, grossWeightKg: 0, totalVolumeM3: 0, freightClass: null });
    expect(empty.crates).toEqual([]);
    expect(empty.waves).toEqual([]);
  });

  test('dispatch waves split rough-in stock from fabricated parts without touching totals', () => {
    expect(parseLeadWeeks('2-3 weeks')).toEqual([2, 3]);
    expect(parseLeadWeeks([4, 6])).toEqual([4, 6]);
    expect(parseLeadWeeks('soon')).toEqual([1, 2]);

    const consolidated = scheduleFor(ROUGH_IN_BAG);
    expect(consolidated.mode).toBe('consolidated');
    expect(consolidated.waves).toHaveLength(1);
    expect(consolidated.waves[0]).toMatchObject({ code: 'Wave 01', label: 'Consolidated Dispatch', window: '4-6 weeks' });
    expect(consolidated.waves[0].lines.map((line) => line.sku)).toEqual(['LMN-TR-200', 'LMN-SB-075', 'LMN-DR-060']);

    const split = scheduleFor(ROUGH_IN_BAG, { fulfilmentMode: 'split' });
    expect(split.modeLabel).toBe('Split Rough-In & Millwork');
    expect(split.waves.map((wave) => [wave.code, wave.label, wave.window])).toEqual([
      ['Wave 01', 'Rough-In & In-Stock Dispatch', '1-2 weeks'],
      ['Wave 02', 'Custom Millwork & Luminaires', '4-6 weeks'],
    ]);
    expect(split.waves[0].lines.map((line) => line.sku)).toEqual(['LMN-TR-200', 'LMN-DR-060']);
    expect(split.waves[1].lines.map((line) => line.sku)).toEqual(['LMN-SB-075']);
    expect(split.windowLabel).toBe('1-2 weeks / 4-6 weeks');
    expect(split.grossWeightKg).toBe(consolidated.grossWeightKg);

    const stockOnly = scheduleFor([{ id: 'wall-sconce-80', finish: 'chalk', qty: 2 }], { fulfilmentMode: 'split' });
    expect(stockOnly.waves).toHaveLength(1);
    expect(stockOnly.note).toContain('All lines qualify for Wave 01');

    for (const mode of ['__proto__', 'constructor', 42, null]) {
      expect(scheduleFor(ROUGH_IN_BAG, { fulfilmentMode: mode }).mode).toBe('consolidated');
    }

    const a = buildQuote({ items: ROUGH_IN_BAG, currencyCode: 'USD', fulfilmentMode: 'consolidated' });
    const b = buildQuote({ items: ROUGH_IN_BAG, currencyCode: 'USD', fulfilmentMode: 'split' });
    expect(a.totals).toEqual(b.totals);
    expect(a.totals.gross).toBe(ROUGH_IN_GROSS_MINOR);
    expect(b.logistics.waves).toHaveLength(2);
  });
});

test.describe('checkout logistics schedule', () => {
  test('mass, crates and dispatch waves render, switch mode, export and submit', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await page.evaluate(([key, value]) => localStorage.setItem(key, value), [BAG_KEY, JSON.stringify(ROUGH_IN_BAG)]);
    await page.goto('/checkout');

    const schedule = page.getByTestId('logistics-schedule');
    await expect(schedule).toBeVisible();
    await expect(page.getByTestId('logistics-weight')).toHaveText('21.5 / 25.4 kg');
    await expect(page.getByTestId('logistics-weight')).toHaveAttribute('data-gross', '25.4');
    await expect(page.getByTestId('logistics-volume')).toHaveText(/^\d+\.\d{2} m3$/);
    await expect(page.getByTestId('logistics-freight-class')).toHaveText('Dedicated Van / LTL');

    const crates = page.getByTestId('logistics-crate-list').getByTestId('logistics-crate');
    await expect(crates).toHaveCount(3);
    await expect(crates.nth(0)).toHaveAttribute('data-code', 'CRT-01');
    await expect(crates.nth(0)).toContainText('Long-Span Timber Tube');
    await expect(crates.nth(0).locator('[data-sku="LMN-TR-200"]')).toBeVisible();
    await expect(crates.nth(1)).toContainText('Reinforced Millwork Crate');
    await expect(crates.nth(2).locator('[data-sku="LMN-DR-060"]')).toBeVisible();

    const waves = page.getByTestId('logistics-wave-list').getByTestId('logistics-wave');
    await expect(page.getByTestId('fulfilment-consolidated')).toHaveAttribute('aria-pressed', 'true');
    await expect(waves).toHaveCount(1);
    await expect(page.getByTestId('logistics-window')).toHaveText('4-6 weeks');
    await expect(page.getByTestId('quote-gross')).toHaveAttribute('data-minor', String(ROUGH_IN_GROSS_MINOR));

    await page.getByTestId('fulfilment-split').click();
    await expect(page.getByTestId('fulfilment-split')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('fulfilment-consolidated')).toHaveAttribute('aria-pressed', 'false');
    await expect(waves).toHaveCount(2);
    await expect(waves.nth(0)).toContainText('Rough-In & In-Stock Dispatch');
    await expect(waves.nth(0).locator('[data-sku="LMN-TR-200"]')).toBeVisible();
    await expect(waves.nth(0).locator('[data-sku="LMN-DR-060"]')).toBeVisible();
    await expect(waves.nth(0).locator('[data-sku="LMN-SB-075"]')).toHaveCount(0);
    await expect(waves.nth(1)).toContainText('Custom Millwork & Luminaires');
    await expect(waves.nth(1).locator('[data-sku="LMN-SB-075"]')).toBeVisible();
    await expect(page.getByTestId('logistics-window')).toHaveText('1-2 weeks / 4-6 weeks');
    await expect(page.getByTestId('quote-gross')).toHaveAttribute('data-minor', String(ROUGH_IN_GROSS_MINOR));

    await page.emulateMedia({ media: 'print' });
    await expect(schedule).toBeVisible();
    await expect(page.getByTestId('fulfilment-split')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    await page.setViewportSize({ width: 375, height: 812 });
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.setViewportSize({ width: 1280, height: 800 });

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-quote').click()]);
    const payload = JSON.parse(await readFile(await download.path(), 'utf-8'));
    expect(payload.logistics).toMatchObject({
      fulfilmentMode: 'split',
      netWeightKg: 21.5,
      grossWeightKg: 25.4,
      freightClass: 'Dedicated Van / LTL',
      windowLabel: '1-2 weeks / 4-6 weeks',
    });
    expect(payload.logistics.crates.map((crate) => crate.code)).toEqual(['CRT-01', 'CRT-02', 'CRT-03']);
    expect(payload.logistics.waves.map((wave) => wave.lines.map((line) => line.sku))).toEqual([
      ['LMN-TR-200', 'LMN-DR-060'],
      ['LMN-SB-075'],
    ]);
    expect(payload.totals.gross).toBe(ROUGH_IN_GROSS_MINOR);

    await page.getByTestId('project-reference').fill('Fjord House - Rough-In');
    await page.getByTestId('project-client').fill('Studio Halvorsen Arkitekter');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith('/api/quotes') && res.request().method() === 'POST'),
      page.getByTestId('submit-requisition').click(),
    ]);
    expect(response.status()).toBe(201);
    expect((await response.json()).quote.grossMinor).toBe(ROUGH_IN_GROSS_MINOR);
    await expect(page.getByTestId('requisition-confirmed')).toBeVisible();

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
