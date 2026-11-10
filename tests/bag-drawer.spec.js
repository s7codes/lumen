import { expect, test } from '@playwright/test';
import {
  BAG_STORAGE_KEY,
  bagReducer,
  MAX_LINE_QTY,
  recommendPsu,
  sanitizeBagItems,
  summarizeBag,
} from '../src/lib/bag.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder } from './support/runtime-guards.js';

const STORAGE_KEY = `lumen:${BAG_STORAGE_KEY}`;

async function addFromCatalog(page, name, finish) {
  const card = page.getByRole('article', { name });
  if (finish) await card.getByRole('radio', { name: finish }).check();
  await card.getByRole('button', { name: /add to bag/i }).click();
}

async function openBag(page) {
  await page.getByRole('button', { name: /^Cart \(\d+\)$/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Cart' });
  await expect(drawer).toBeVisible();
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  return drawer;
}

function readStoredBag(page) {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

async function seedStorage(page, raw) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [STORAGE_KEY, raw]);
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('bag drawer', () => {
  test('quantities drive the subtotal, 24V system load and PSU recommendation', async ({ page }) => {
    await page.goto('/catalog');
    await addFromCatalog(page, 'Floating Shelf 110');
    await addFromCatalog(page, 'Corner Floor Column 140');
    await expect(page.getByRole('button', { name: 'Cart (2)' })).toBeVisible();

    const drawer = await openBag(page);
    const lines = drawer.getByTestId('bag-line');
    const note = drawer.getByTestId('bag-psu-note');
    const press = (label) => drawer.getByRole('button', { name: label, exact: true }).click();
    const expectTotals = async (usd, watts, driver) => {
      await expect(drawer.getByTestId('bag-subtotal')).toHaveText(usd);
      await expect(drawer.getByTestId('bag-load')).toHaveText(`${watts} W`);
      await expect(drawer.getByTestId('bag-psu')).toHaveText(driver);
    };
    const shelf = 'Floating Shelf 110, Walnut';
    const column = 'Corner Floor Column 140, Walnut';

    await expect(lines).toHaveCount(2);
    await expectTotals('$475', 40, '1x Lumen 60W 24V Driver');
    await expect(note).toHaveText('Driver utilisation 67% of 60 W');

    await press(`Increase ${shelf}`);
    await expectTotals('$660', 56, '1x Lumen 60W 24V Driver');

    await press(`Increase ${column}`);
    await expectTotals('$950', 80, '1x Lumen 150W 24V Driver');

    await press(`Increase ${column}`);
    await press(`Increase ${column}`);
    await expectTotals('$1,530', 128, '1x Lumen 150W 24V Driver');

    await press(`Increase ${column}`);
    await expectTotals('$1,820', 152, 'Multi-bus 24V Driver Array');
    await expect(note).toHaveText('2x 150W drivers / 51% of 300 W');
    await expect(lines.filter({ hasText: 'Corner Floor Column 140' }).getByTestId('bag-line-qty')).toHaveText('5');
    await expect(drawer.getByText('07 / Items')).toBeVisible();

    await press(`Decrease ${shelf}`);
    await expectTotals('$1,635', 136, '1x Lumen 150W 24V Driver');
    await expect(drawer.getByRole('button', { name: `Decrease ${shelf}` })).toBeDisabled();

    await press(`Remove ${column}`);
    await expect(lines).toHaveCount(1);
    await expectTotals('$185', 16, '1x Lumen 60W 24V Driver');
    await expect(drawer.getByRole('list', { name: 'Bag contents' })).toBeFocused();

    await drawer.getByRole('button', { name: 'Clear bag' }).click();
    await drawer.getByRole('button', { name: 'Confirm: clear 1 item' }).click();
    await expect(drawer.getByText('Your bag is empty.')).toBeVisible();
    await expectTotals('$0', 0, 'No driver required');
    await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();
    expect(await readStoredBag(page)).toBeNull();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Cart (0)' })).toBeFocused();
  });

  test('the bag persists across reloads and routes with the selected finishes', async ({ page }) => {
    await page.goto('/catalog');
    await addFromCatalog(page, 'Linear Lightbar 60', 'Chalk');
    await addFromCatalog(page, 'Linear Lightbar 60', 'Chalk');
    await addFromCatalog(page, 'Acoustic Art Frame 50x70', 'Walnut');
    await expect(page.getByRole('button', { name: 'Cart (3)' })).toBeVisible();

    expect(JSON.parse(await readStoredBag(page))).toEqual([
      { id: 'linear-lightbar-60', finish: 'chalk', qty: 2 },
      { id: 'acoustic-art-frame-50x70', finish: 'walnut', qty: 1 },
    ]);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Cart (3)' })).toBeVisible();

    const drawer = await openBag(page);
    await expect(drawer.getByTestId('bag-line')).toHaveCount(2);
    await expect(drawer.getByTestId('bag-line').first()).toContainText('LMN-LB-060 / Chalk / 14 W');
    await expect(drawer.getByTestId('bag-subtotal')).toHaveText('$530');
    await expect(drawer.getByTestId('bag-load')).toHaveText('43 W');
    await page.keyboard.press('Escape');

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /overview/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);
    await expect(page.getByRole('button', { name: 'Cart (3)' })).toBeVisible();

    await page.goto('/catalog');
    const lightbar = page.getByRole('article', { name: 'Linear Lightbar 60' });
    await expect(lightbar.getByTestId('in-bag')).toHaveCount(0);
    await lightbar.getByRole('radio', { name: 'Chalk' }).check();
    await expect(lightbar.getByTestId('in-bag')).toHaveText('In bag 2');
  });

  test('malformed or hostile storage payloads fall back to an empty bag without throwing', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');

    const payloads = [
      '{"id":',
      JSON.stringify('<img src=x onerror=alert(1)>'),
      '{"__proto__":{"polluted":true},"items":[]}',
      '42',
      `[${'['.repeat(40)}${']'.repeat(40)}]`,
    ];

    for (const raw of payloads) {
      await seedStorage(page, raw);
      await expect(page.getByRole('button', { name: 'Cart (0)' }), raw).toBeVisible();
      expect(await readStoredBag(page), raw).toBeNull();
    }

    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('line validation drops tampered entries and keeps the valid ones', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');

    const lines = [
      { id: 'floating-shelf-110', finish: 'walnut', qty: 2 },
      { id: 'floating-shelf-110', finish: 'walnut', qty: 1 },
      { id: 'modular-cube-36', finish: 'oak', qty: -4 },
      { id: 'modular-cube-36', finish: 'oak', qty: 0 },
      { id: 'modular-cube-36', finish: 'oak', qty: 1.5 },
      { id: 'modular-cube-36', finish: 'oak', qty: '3' },
      { id: 'modular-cube-36', finish: 'oak', qty: 1e9 },
      { id: 'track-bus-200', finish: 'walnut', qty: 1 },
      { id: 'track-bus-200', finish: 'gold', qty: 1 },
      { id: 'lmn-unknown-999', finish: 'oak', qty: 1 },
      { id: 'constructor', finish: 'oak', qty: 1 },
      { id: '<img src=x onerror=alert(1)>', finish: 'oak', qty: 1 },
      null,
      'floating-shelf-110',
      [1, 2, 3],
      { id: 'corner-floor-column-140', finish: 'chalk', qty: 1 },
    ];
    // A prototype-borne qty must not satisfy validation once __proto__ is stripped.
    const raw = JSON.stringify(lines).replace(
      /^\[/,
      '[{"__proto__":{"qty":5},"id":"modular-cube-36","finish":"oak"},',
    );

    await seedStorage(page, raw);
    await expect(page.getByRole('button', { name: 'Cart (4)' })).toBeVisible();
    expect(JSON.parse(await readStoredBag(page))).toEqual([
      { id: 'floating-shelf-110', finish: 'walnut', qty: 3 },
      { id: 'corner-floor-column-140', finish: 'chalk', qty: 1 },
    ]);

    const drawer = await openBag(page);
    await expect(drawer.getByTestId('bag-line')).toHaveCount(2);
    await expect(drawer.getByTestId('bag-subtotal')).toHaveText('$845');
    await expect(drawer.getByTestId('bag-load')).toHaveText('72 W');
    await expect(drawer.getByTestId('bag-psu')).toHaveText('1x Lumen 150W 24V Driver');
    expect(errors).toEqual([]);
  });

  test('a second tab follows bag changes and rejects a tampered write', async ({ context }) => {
    const shop = await context.newPage();
    const home = await context.newPage();
    await shop.goto('/catalog');
    await home.goto('/');

    await addFromCatalog(shop, 'Modular Cube 36');
    await expect(home.getByRole('button', { name: 'Cart (1)' })).toBeVisible();

    await shop.evaluate(
      (key) => localStorage.setItem(key, '[{"id":"modular-cube-36","finish":"oak","qty":-50}]'),
      STORAGE_KEY,
    );
    await expect(home.getByRole('button', { name: 'Cart (0)' })).toBeVisible();
    await expect(shop.getByRole('button', { name: 'Cart (0)' })).toBeVisible();
  });

  test('a filled drawer fits a 360px viewport and traps focus', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/catalog');
    await addFromCatalog(page, 'Compact Sideboard 75');
    await addFromCatalog(page, 'Directional Spot Monopoint');
    await addFromCatalog(page, 'Acoustic Art Frame 50x70');

    const drawer = await openBag(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    for (const line of await drawer.getByTestId('bag-line').all()) {
      const box = await line.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }

    const close = drawer.getByRole('button', { name: 'Close' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Clear bag' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
  });
});

test.describe('bag store', () => {
  test('recommends the driver tier at each load boundary', () => {
    expect(recommendPsu(0).label).toBe('No driver required');
    expect(recommendPsu(-20).label).toBe('No driver required');
    expect(recommendPsu(Number.NaN).label).toBe('No driver required');
    expect(recommendPsu(1).label).toBe('1x Lumen 60W 24V Driver');
    expect(recommendPsu(60).label).toBe('1x Lumen 60W 24V Driver');
    expect(recommendPsu(61).label).toBe('1x Lumen 150W 24V Driver');
    expect(recommendPsu(150).label).toBe('1x Lumen 150W 24V Driver');
    expect(recommendPsu(151)).toMatchObject({ label: 'Multi-bus 24V Driver Array', drivers: 2, capacityW: 300 });
    expect(recommendPsu(451)).toMatchObject({ drivers: 4, capacityW: 600 });
  });

  test('sanitizes untrusted lines and merges duplicates up to the cap', () => {
    expect(sanitizeBagItems(null)).toEqual([]);
    expect(sanitizeBagItems({ id: 'floating-shelf-110', finish: 'oak', qty: 1 })).toEqual([]);
    expect(sanitizeBagItems([{ id: 'hasOwnProperty', finish: 'oak', qty: 1 }])).toEqual([]);
    expect(
      sanitizeBagItems([
        { id: 'floating-shelf-110', finish: 'oak', qty: 60 },
        { id: 'floating-shelf-110', finish: 'oak', qty: 60 },
      ]),
    ).toEqual([{ id: 'floating-shelf-110', finish: 'oak', qty: MAX_LINE_QTY }]);
  });

  test('the reducer ignores invalid actions and keeps identity when nothing changes', () => {
    const start = [{ id: 'modular-cube-36', finish: 'oak', qty: 1 }];

    expect(bagReducer(start, { type: 'add', id: 'modular-cube-36', finish: 'gold' })).toBe(start);
    expect(bagReducer(start, { type: 'add', id: 'modular-cube-36', finish: 'oak', qty: -3 })).toBe(start);
    expect(bagReducer(start, { type: 'step', id: 'modular-cube-36', finish: 'oak', delta: -1 })).toBe(start);
    expect(bagReducer(start, { type: 'step', id: 'modular-cube-36', finish: 'oak', delta: 5 })).toBe(start);
    expect(bagReducer(start, { type: 'remove', id: 'track-bus-200', finish: 'oak' })).toBe(start);
    expect(bagReducer(start, { type: 'unknown' })).toBe(start);
    expect(bagReducer(start, { type: 'hydrate', items: [...start] })).toBe(start);

    expect(bagReducer(start, { type: 'add', id: 'modular-cube-36', finish: 'oak' })).toEqual([
      { id: 'modular-cube-36', finish: 'oak', qty: 2 },
    ]);
    expect(bagReducer(start, { type: 'clear' })).toEqual([]);
  });

  test('summarizes money and electrical load across lines', () => {
    const summary = summarizeBag([
      { id: 'floating-shelf-110', finish: 'oak', qty: 3 },
      { id: 'track-bus-200', finish: 'chalk', qty: 2 },
    ]);
    expect(summary).toMatchObject({ count: 5, subtotalUsd: 745, loadW: 48 });
    expect(summary.psu.label).toBe('1x Lumen 60W 24V Driver');
  });
});
