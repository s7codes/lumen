import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

const BAG_KEY = 'lumen:lumen_bag_v1';
const WALL_KEY = 'lumen:lumen_wall_studio_v1';
const ROOM_KEY = 'lumen:lumen_room_3d_v1';
const CURRENCY_KEY = 'lumen:lumen_currency_v1';

// 2x shelf $185, column $290, track $95: 56 W on the bus, so one 60W driver at $58.
const PROJECT_BAG = [
  { id: 'floating-shelf-110', finish: 'oak', qty: 2 },
  { id: 'corner-floor-column-140', finish: 'walnut', qty: 1 },
  { id: 'track-bus-200', finish: 'obsidian', qty: 1 },
];
const NET_USD = 2 * 185 + 290 + 95 + 58;

const XSS_REFERENCE = '<img src=x onerror=alert(1)> Nordic Residence - Living Wall';
const XSS_CLIENT = '"><script>alert(2)</script> Studio Halvorsen';
const XSS_NOTES = 'javascript:alert(3)\n\n<svg onload=alert(4)> Plaster-in track before skim coat.';

async function seedBag(page, items = PROJECT_BAG) {
  await page.goto('/');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [BAG_KEY, JSON.stringify(items)]);
  await page.reload();
}

function readStored(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

async function minor(page, testId) {
  return Number(await page.getByTestId(testId).getAttribute('data-minor'));
}

// Independent of src/lib/quote.js: integer minor units, half-up rounding once per step.
function expectedTotals(netMinor, pct) {
  const discount = Math.round((netMinor * pct) / 100);
  const after = netMinor - discount;
  const vat = Math.round((after * 27) / 100);
  return { net: netMinor, discount, after, vat, gross: after + vat };
}

async function expectTotals(page, totals) {
  expect(await minor(page, 'quote-net')).toBe(totals.net);
  expect(await minor(page, 'quote-discount')).toBe(totals.discount);
  expect(await minor(page, 'quote-net-after')).toBe(totals.after);
  expect(await minor(page, 'quote-vat')).toBe(totals.vat);
  expect(await minor(page, 'quote-gross')).toBe(totals.gross);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('product specification view', () => {
  test('catalog title links open the spec sheet with the chosen finish and every drawing view', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');

    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    await card.getByRole('radio', { name: 'Oak' }).check();
    await card.getByTestId('product-spec-link').click();

    await expect(page).toHaveURL(/\/catalog\/floating-shelf-110\?finish=oak$/);
    await expect(page).toHaveTitle('Floating Shelf 110 - Lumen');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Floating Shelf 110');
    await expect(page.getByTestId('detail-finish')).toHaveText('Nordic White Oak');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: /catalog/i })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const drawing = page.getByTestId('blueprint-svg');
    const front = page.getByTestId('blueprint-view-front');
    const side = page.getByTestId('blueprint-view-side');
    const mounting = page.getByTestId('blueprint-view-mounting');

    await expect(front).toHaveAttribute('aria-pressed', 'true');
    await expect(drawing).toHaveAttribute('data-view', 'front');
    await expect(drawing.getByTestId('dim-width')).toContainText('W 110');
    await expect(drawing.getByTestId('dim-height')).toContainText('H 8');
    await expect(drawing.getByTestId('blueprint-scale')).toHaveText('1:10 / LMN-SH-110');

    await side.click();
    await expect(side).toHaveAttribute('aria-pressed', 'true');
    await expect(front).toHaveAttribute('aria-pressed', 'false');
    await expect(drawing).toHaveAttribute('data-view', 'side');
    await expect(page.getByTestId('blueprint-title')).toHaveText('Side Section (Z-Depth & 24V Bus Channel)');
    await expect(drawing.getByTestId('dim-depth')).toContainText('Z 25');
    await expect(drawing.getByTestId('bus-channel')).toBeVisible();
    await expect(drawing).toContainText('24V DC bus channel');

    await mounting.click();
    await expect(drawing).toHaveAttribute('data-view', 'mounting');
    await expect(drawing.getByTestId('anchor-point')).toHaveCount(3);
    await expect(page.getByTestId('anchor-spacing')).toHaveText('27.5 cm');
    await expect(drawing.getByTestId('anchor-chain')).toContainText('27.5');

    // Polar distribution: 1150 lm in a cos^2 lobe peaks at 1150 * 3 / 2pi = 549.1 cd.
    const panel = page.getByTestId('photometric-panel');
    await expect(panel).toHaveAttribute('data-kind', 'polar');
    await expect(page.getByTestId('photometric-polar')).toBeVisible();
    expect((await page.getByTestId('polar-curve').getAttribute('points')).split(' ').length).toBeGreaterThan(100);
    await expect(page.getByTestId('peak-cd')).toHaveText('549 cd');
    await expect(page.getByTestId('lux-0.5')).toHaveText('2,196 lx');
    await expect(page.getByTestId('lux-1.0')).toHaveText('549 lx');
    await expect(page.getByTestId('lux-2.0')).toHaveText('137 lx');
    await page.getByTestId('probe-angle').fill('90');
    await expect(page.getByTestId('probe-readout')).toHaveText('90 deg / 0 cd / 0 lx at 1 m');

    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('detail-qty')).toHaveText('3');
    await page.getByTestId('detail-add-to-bag').click();
    await expect(page.getByRole('button', { name: 'Cart (3)' })).toBeVisible();
    await expect(page.getByTestId('detail-in-bag')).toHaveText('In bag 3 / Oak');

    await page.getByRole('radio', { name: 'Walnut' }).check();
    await expect(page).toHaveURL(/finish=walnut$/);
    await expect(page.getByTestId('detail-in-bag')).toHaveText('Not in bag / Walnut');

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the track bus shows its 24V current capacity and voltage drop instead of a polar curve', async ({ page }) => {
    await page.goto('/catalog/track-bus-200');
    await expect(page.getByTestId('photometric-panel')).toHaveAttribute('data-kind', 'bus');
    await expect(page.getByTestId('photometric-polar')).toHaveCount(0);
    await expect(page.getByTestId('bus-drop-curve')).toBeVisible();

    await expect(page.getByTestId('bus-current')).toHaveText('6.25 A');
    await expect(page.getByTestId('bus-max-run')).toHaveText('8.4 m');
    await expect(page.getByTestId('bus-end-voltage')).toHaveText('23.83 V');

    await page.getByTestId('bus-load-60').click();
    await expect(page.getByTestId('bus-load-60')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bus-current')).toHaveText('2.50 A');
    await expect(page.getByTestId('bus-max-run')).toHaveText('20.9 m');

    await page.getByTestId('blueprint-view-mounting').click();
    await expect(page.getByTestId('anchor-point')).toHaveCount(5);
    await expect(page.getByTestId('anchor-spacing')).toHaveText('48.5 cm');
  });

  test('unknown or hostile ids render a not-found state, and invalid finishes fall back', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    for (const id of ['lmn-unknown-999', 'constructor', '__proto__', '%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E']) {
      await page.goto(`/catalog/${id}`);
      await expect(page.getByTestId('product-not-found'), id).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('No part at this index.');
    }
    await expect(page.locator('main img')).toHaveCount(0);

    await page.goto('/catalog/directional-spot-monopoint?finish=walnut');
    await expect(page.getByTestId('detail-finish')).toHaveText('Brushed Obsidian Aluminum');
    await expect(page.getByTestId('lux-1.0')).toHaveText('1,226 lx');
    expect(errors).toEqual([]);
  });

  test('home page module titles link to their spec sheets', async ({ page }) => {
    await page.goto('/');
    const link = page.getByTestId('core-modules').getByTestId('product-spec-link').first();
    await expect(link).toHaveAttribute('href', /^\/catalog\/[a-z0-9-]+\?finish=[a-z]+$/);
    await link.click();
    await expect(page.getByTestId('product-detail')).toBeVisible();
  });
});

test.describe('workspace launchers', () => {
  test('Mount in 2D Wall Studio appends the part in the chosen finish at a clear spot', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog/linear-lightbar-60?finish=chalk');
    await page.getByTestId('launch-in-wall-studio').click();

    await expect(page).toHaveURL(/\/studio-2d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    const module = page.locator('[data-testid="wall-module"][data-product="linear-lightbar-60"]');
    await expect(module).toHaveCount(1);
    await expect(module).toHaveAttribute('data-finish', 'chalk');
    await expect(module).toHaveAttribute('data-conflict', 'false');
    await expect(module).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('studio-notice')).toHaveText('Linear Lightbar 60, Chalk mounted from the product page.');

    const stored = await readStored(page, WALL_KEY);
    expect(stored.items.map(({ productId, finish }) => ({ productId, finish }))).toEqual([
      { productId: 'linear-lightbar-60', finish: 'chalk' },
    ]);

    // A second launch lands beside the first without overlapping it.
    await page.goto('/catalog/linear-lightbar-60?finish=oak');
    await page.getByTestId('launch-in-wall-studio').click();
    await expect(page.locator('[data-testid="wall-module"][data-product="linear-lightbar-60"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="wall-module"][data-finish="oak"]')).toHaveAttribute('data-conflict', 'false');
    await expect(page.getByTestId('conflict-count')).toHaveText('0 conflicts');

    // History state is consumed: a reload neither repeats the notice nor re-selects.
    await page.reload();
    await expect(page.getByTestId('studio-notice')).toHaveText('');
    expect(errors).toEqual([]);
  });

  test('Place in 3D Room appends the part in the chosen finish to the stored room', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog/acoustic-art-frame-50x70?finish=walnut');
    await page.getByTestId('launch-in-room-3d').click();

    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expect(page.getByTestId('room-modules')).toHaveText('01');
    await expect(page.getByTestId('room-inspector-name')).toHaveText('Acoustic Art Frame 50x70');
    await expect(page.getByTestId('room-inspector').getByRole('radio', { name: 'Walnut' })).toBeChecked();
    await expect(page.getByTestId('room-notice')).toHaveText('Acoustic Art Frame 50x70, Walnut mounted from the product page.');

    const stored = await readStored(page, ROOM_KEY);
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]).toMatchObject({ productId: 'acoustic-art-frame-50x70', finish: 'walnut', led: true });
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('checkout and quote', () => {
  test('bag to checkout: currencies, trade code, exact integer totals, safe project fields and requisition', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await seedBag(page);

    await page.getByRole('button', { name: 'Cart (4)' }).click();
    const drawer = page.getByRole('dialog', { name: 'Cart' });
    await drawer.getByTestId('proceed-to-checkout').click();
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project Quote');

    // Driver provisioning completes the 24V specification.
    await expect(page.getByTestId('quote-line')).toHaveCount(3);
    const driver = page.getByTestId('quote-driver-line');
    await expect(driver).toHaveAttribute('data-sku', 'LMN-DR-060');
    await expect(page.getByTestId('quote-load')).toHaveText('56 W');
    await expect(page.getByTestId('quote-psu')).toHaveText('1x Lumen 60W 24V Driver / 93% of 60 W');

    await expect(page.getByTestId('currency-USD')).toHaveAttribute('aria-pressed', 'true');
    await expectTotals(page, expectedTotals(NET_USD * 100, 0));
    await expect(page.getByTestId('quote-gross')).toHaveText('USD 1,032.51');

    await page.getByTestId('currency-HUF').click();
    await expect(page.getByTestId('currency-HUF')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('quote-currency')).toHaveText('HUF / 1 USD = 360 HUF');
    expect(await readStored(page, CURRENCY_KEY)).toBe('HUF');

    await page.getByTestId('promo-input').fill('bogus99');
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-status')).toContainText('Code not recognised');
    expect(await minor(page, 'quote-discount')).toBe(0);

    await page.getByTestId('promo-input').fill('  trade15 ');
    await page.getByTestId('promo-apply').click();
    await expect(page.getByTestId('promo-status')).toHaveText('TRADE15 applied: Trade programme, 15% off net.');

    const huf = expectedTotals(NET_USD * 360, 15);
    expect(huf).toEqual({ net: 292680, discount: 43902, after: 248778, vat: 67170, gross: 315948 });
    await expectTotals(page, huf);
    await expect(page.getByTestId('quote-net')).toHaveText('HUF 292,680');
    await expect(page.getByTestId('quote-discount')).toHaveText('-HUF 43,902');
    await expect(page.getByTestId('quote-vat')).toHaveText('HUF 67,170');
    await expect(page.getByTestId('quote-gross')).toHaveText('HUF 315,948');
    const lineSum = await page
      .getByTestId('quote-bom')
      .locator('tbody td[data-minor]')
      .evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.dataset.minor), 0));
    expect(lineSum).toBe(huf.net);

    // EUR at 0.92 keeps cents: 74,796 net, half-up rounding on 15% and on 27% VAT.
    await page.getByTestId('currency-EUR').click();
    await expectTotals(page, expectedTotals(74796, 15));
    await expect(page.getByTestId('quote-gross')).toHaveText('EUR 807.43');

    await page.getByTestId('currency-HUF').click();
    await page.getByTestId('driver-toggle').uncheck();
    await expect(driver).toHaveCount(0);
    await expect(page.getByTestId('driver-excluded')).toBeVisible();
    await expectTotals(page, expectedTotals((NET_USD - 58) * 360, 15));
    await page.getByTestId('driver-toggle').check();
    await expectTotals(page, huf);

    // Empty project fields block the requisition.
    await page.getByTestId('submit-requisition').click();
    await expect(page.getByTestId('requisition-confirmed')).toHaveCount(0);
    await expect(page.getByTestId('project-reference')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('project-reference')).toBeFocused();
    await expect(page.getByTestId('project-client')).toHaveAttribute('aria-invalid', 'true');

    await page.getByTestId('project-reference').fill(XSS_REFERENCE);
    await page.getByTestId('project-client').fill(XSS_CLIENT);
    await page.getByTestId('project-notes').fill(XSS_NOTES);

    const sheet = page.getByTestId('quote-sheet');
    await expect(page.getByTestId('quote-project')).toHaveText(XSS_REFERENCE);
    await expect(page.getByTestId('quote-client')).toHaveText(XSS_CLIENT);
    await expect(page.getByTestId('quote-notes')).toContainText('<svg onload=alert(4)>');
    await expect(sheet.locator('img, script, svg')).toHaveCount(0);
    expect(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length)).toBe(0);

    await page.evaluate(() => {
      window.__printCalls = 0;
      window.print = () => {
        window.__printCalls += 1;
      };
    });
    await page.getByTestId('print-quote').click();
    expect(await page.evaluate(() => window.__printCalls)).toBe(1);

    const quoteId = await page.getByTestId('quote-id').textContent();
    expect(quoteId).toMatch(/^LMN-Q-\d{8}-[0-9A-Z]{6}$/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-quote').click()]);
    expect(download.suggestedFilename()).toBe(`lumen-quote-${quoteId}.json`);
    const payload = JSON.parse(await readFile(await download.path(), 'utf-8'));
    expect(payload).toMatchObject({
      format: 'lumen.quote',
      version: 1,
      quoteId,
      issuer: { name: 'Lumen Architectural Systems', address: '1052 Budapest, Fenyiv utca 14' },
      project: { reference: XSS_REFERENCE, preparedFor: XSS_CLIENT },
      currency: { code: 'HUF', minorUnitsPerMajor: 1, ratePerUsd: 360 },
      promo: { code: 'TRADE15', pct: 15 },
      electrical: { busVoltage: 24, loadW: 56, drivers: 1, capacityW: 60, driverIncluded: true },
      totals: { net: 292680, discount: 43902, netAfterDiscount: 248778, vat: 67170, gross: 315948 },
    });
    expect(payload.project.notes).toBe('javascript:alert(3)\n\n<svg onload=alert(4)> Plaster-in track before skim coat.');
    expect(payload.bom.map((line) => line.sku)).toEqual(['LMN-SH-110', 'LMN-CL-140', 'LMN-TR-200', 'LMN-DR-060']);
    expect(payload.totals.net - payload.totals.discount + payload.totals.vat).toBe(payload.totals.gross);

    await page.getByTestId('submit-requisition').click();
    const confirmed = page.getByTestId('requisition-confirmed');
    await expect(confirmed).toBeVisible();
    await expect(page.getByTestId('requisition-ref')).toHaveText(/^LMN-R-[0-9A-F]{8}$/);
    await expect(page.getByTestId('requisition-project')).toHaveText(XSS_REFERENCE);
    await expect(confirmed).toContainText('HUF 315,948');

    await page.reload();
    await expect(page.getByTestId('currency-HUF')).toHaveAttribute('aria-pressed', 'true');

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a tampered currency value falls back to USD and an empty bag shows no quote', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await page.evaluate((key) => localStorage.setItem(key, '{"__proto__":{"code":"HUF"}}'), CURRENCY_KEY);
    await page.goto('/checkout');
    await expect(page.getByTestId('checkout-empty')).toBeVisible();

    await seedBag(page, [{ id: 'modular-cube-36', finish: 'oak', qty: 1 }]);
    await page.goto('/checkout');
    await expect(page.getByTestId('currency-USD')).toHaveAttribute('aria-pressed', 'true');
    await expectTotals(page, expectedTotals((140 + 58) * 100, 0));
    expect(await page.evaluate(() => ({}).code)).toBeUndefined();
    expect(errors).toEqual([]);
  });
});

test.describe('layout and runtime guards', () => {
  test('spec sheets and checkout have no overflow from 360px to 1600px and no runtime or CSP errors', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await seedBag(page);

    for (const width of VIEWPORT_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });

      for (const id of ['floating-shelf-110', 'track-bus-200', 'corner-floor-column-140']) {
        await page.goto(`/catalog/${id}`);
        for (const view of ['front', 'side', 'mounting']) {
          await page.getByTestId(`blueprint-view-${view}`).click();
          await expect(page.getByTestId('blueprint-svg')).toHaveAttribute('data-view', view);
          expect(await horizontalOverflow(page), `${id} ${view} @ ${width}`).toBeLessThanOrEqual(0);
        }
      }

      await page.goto('/checkout');
      await page.getByTestId('currency-HUF').click();
      await page.getByTestId('project-reference').fill(XSS_REFERENCE);
      await expect(page.getByTestId('quote-sheet')).toBeVisible();
      expect(await horizontalOverflow(page), `checkout @ ${width}`).toBeLessThanOrEqual(0);
      const box = await page.getByTestId('quote-totals').boundingBox();
      expect(box.x + box.width, `totals @ ${width}`).toBeLessThanOrEqual(width);
    }

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
