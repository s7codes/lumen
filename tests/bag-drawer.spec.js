import { expect, test } from '@playwright/test';
import {
  BAG_STORAGE_KEY,
  bagReducer,
  MAX_LINE_QTY,
  recommendPsu,
  sanitizeBagItems,
  summarizeBag,
} from '../src/lib/bag.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const STORAGE_KEY = `lumen:${BAG_STORAGE_KEY}`;

async function addFromCatalog(page, name, finish) {
  const card = page.getByRole('article', { name });
  if (finish) await card.getByRole('radio', { name: finish }).check();
  await card.getByRole('button', { name: /add to cart/i }).click();
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
    const count = drawer.getByTestId('bag-count');
    const press = (label) => drawer.getByRole('button', { name: label, exact: true }).click();
    const expectTotals = async (usd, watts, driver) => {
      await expect(drawer.getByTestId('bag-subtotal')).toHaveText(usd);
      await expect(drawer.getByTestId('bag-load')).toHaveText(`${watts} W`);
      await expect(drawer.getByTestId('bag-psu')).toHaveText(driver);
    };
    const shelf = 'Floating Shelf 110, Walnut';
    const column = 'Corner Floor Column 140, Walnut';

    await expect(lines).toHaveCount(2);
    await expect(lines.getByTestId('product-thumb-glyph')).toHaveCount(2);
    await expect(count).toBeVisible();
    await expect(count).toHaveText('2 items');
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
    await expect(count).toHaveText('7 items');
    // Only the line list scrolls: the checkout key and Clear cart stay inside 1280x720.
    await expect(drawer.getByTestId('proceed-to-checkout')).toBeInViewport({ ratio: 1 });
    await expect(drawer.getByRole('button', { name: 'Clear cart' })).toBeInViewport({ ratio: 1 });

    await press(`Decrease ${shelf}`);
    await expectTotals('$1,635', 136, '1x Lumen 150W 24V Driver');
    await expect(drawer.getByRole('button', { name: `Decrease ${shelf}` })).toBeDisabled();

    await press(`Remove ${column}`);
    await expect(lines).toHaveCount(1);
    await expectTotals('$185', 16, '1x Lumen 60W 24V Driver');
    await expect(count).toHaveText('1 item');
    await expect(drawer.getByRole('list', { name: 'Cart contents' })).toBeFocused();

    await drawer.getByRole('button', { name: 'Clear cart' }).click();
    await drawer.getByRole('button', { name: 'Confirm: clear 1 item' }).click();
    await expect(drawer.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(count).toHaveText('0 items');
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
    const lines = drawer.getByTestId('bag-line');
    await expect(lines).toHaveCount(2);
    await expect(lines.first()).toContainText('LMN-LB-060 / Chalk / 14 W');
    // Each line draws its part in the line's own finish, lit when the part draws power.
    const lightbarGlyph = lines.first().getByTestId('product-thumb-glyph');
    await expect(lightbarGlyph).toBeVisible();
    await expect(lightbarGlyph).toHaveAttribute('data-shape', 'lightbar');
    await expect(lightbarGlyph).toHaveAttribute('data-finish', 'chalk');
    await expect(lightbarGlyph).toHaveAttribute('data-lit', 'true');
    await expect(lines.nth(1).getByTestId('product-thumb-glyph')).toHaveAttribute('data-finish', 'walnut');
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
    await expect(lightbar.getByTestId('in-bag')).toHaveText('In cart 2');
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
    await expect(drawer.getByTestId('bag-line')).toHaveCount(3);
    for (const line of await drawer.getByTestId('bag-line').all()) {
      const box = await line.boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      const finish = (await line.getAttribute('data-line')).split(':')[1];
      const glyph = line.getByTestId('product-thumb-glyph');
      await expect(glyph).toBeVisible();
      await expect(glyph).toHaveAttribute('data-finish', finish);
    }
    await expect(drawer.getByTestId('bag-count')).toHaveText('3 items');
    await expect(drawer.getByTestId('proceed-to-checkout')).toBeInViewport({ ratio: 1 });

    const close = drawer.getByRole('button', { name: 'Close' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(drawer.getByRole('button', { name: 'Clear cart' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
  });

  test('an empty cart opens on warm basalt with a guided empty state and Specs-only telemetry', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'architectural');

    const drawer = await openBag(page);
    // Warm basalt: a champagne top light over a two-stop gradient, a champagne hairline edge, no glow.
    await expect(drawer).toHaveCSS(
      'background-image',
      /^radial-gradient\(.+\), linear-gradient\(rgb\(23, 21, 19\)( 0%)?, rgb\(17, 16, 14\)( 100%)?\)$/,
    );
    await expect(drawer).toHaveCSS('border-left-color', 'rgba(229, 199, 153, 0.16)');
    await expect(drawer).toHaveCSS('box-shadow', 'none');
    await expect(drawer.getByTestId('bag-count')).toHaveText('0 items');

    const close = drawer.getByRole('button', { name: 'Close' });
    const catalog = drawer.getByRole('link', { name: 'Browse Catalog' });
    const planner = drawer.getByRole('link', { name: 'Open 3D Room Planner' });
    await expect(close).toBeFocused();
    await expect(drawer.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();
    await expect(
      drawer.getByText('Explore our modular lighting and shelving or design your space in 3D to build your system.'),
    ).toBeVisible();
    await expect(catalog).toHaveAttribute('href', '/catalog');
    await expect(planner).toHaveAttribute('href', '/room-3d');
    await expect(drawer.getByTestId('proceed-to-checkout')).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Clear cart' })).toHaveCount(0);

    // The trap runs Close, the two pills, then back to Close.
    await page.keyboard.press('Tab');
    await expect(catalog).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(planner).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    // Visual mode: an empty cart keeps its 24V readout in the DOM, out of sight.
    const telemetry = [drawer.getByTestId('bag-load'), drawer.getByTestId('bag-psu'), drawer.getByTestId('bag-psu-note')];
    for (const row of telemetry) await expect(row).toBeHidden();
    await expect(drawer.getByTestId('bag-load')).toHaveText('0 W');
    await expect(drawer.getByTestId('bag-psu')).toHaveText('No driver required');
    await expect(drawer.getByTestId('bag-subtotal')).toHaveText('$0');

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.getByRole('button', { name: 'Specs (Technical)' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'technical');

    // Specs mode: the same rows are on screen with the same exact text.
    await openBag(page);
    for (const row of telemetry) await expect(row).toBeVisible();
    await expect(drawer.getByTestId('bag-load')).toHaveText('0 W');
    await expect(drawer.getByTestId('bag-psu')).toHaveText('No driver required');
    await expect(drawer.getByTestId('bag-psu-note')).toHaveText('Passive parts only, no driver load');
    await expect(drawer.getByRole('heading', { name: 'Your cart is empty' })).toBeVisible();

    // A pill closes the drawer on its way to the route.
    await catalog.click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/catalog$/);
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
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
