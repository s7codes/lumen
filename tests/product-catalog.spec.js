import { expect, test } from '@playwright/test';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

const modeButton = (page, name) =>
  page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name });

function readTelemetry(card) {
  return card
    .getByTestId('product-telemetry')
    .evaluate((dl) =>
      Object.fromEntries(
        [...dl.querySelectorAll('.telemetry__cell')].map((cell) => [
          cell.querySelector('dt').textContent,
          cell.querySelector('dd').textContent,
        ]),
      ),
    );
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('product catalog', () => {
  test('category filter, search and sort narrow and order the index', async ({ page }) => {
    await page.goto('/catalog');
    const cards = page.getByRole('article');
    const names = cards.getByRole('heading', { level: 3 });
    const count = page.getByTestId('catalog-count');
    const filters = page.getByRole('group', { name: 'Category' });
    const search = page.getByRole('searchbox', { name: 'Search' });

    await expect(cards).toHaveCount(8);
    await expect(count).toHaveText('08 results');

    await filters.getByRole('button', { name: /^lighting/i }).click();
    await expect(filters.getByRole('button', { name: /^lighting/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL((url) => url.pathname === '/catalog' && url.search === '?category=lighting');
    await expect(names).toHaveText(['Linear Lightbar 60', 'Corner Floor Column 140', 'Directional Spot Monopoint']);

    await page.getByRole('combobox', { name: 'Sort' }).selectOption('price-desc');
    await expect(names).toHaveText(['Corner Floor Column 140', 'Linear Lightbar 60', 'Directional Spot Monopoint']);

    await search.fill('spot');
    await expect(names).toHaveText(['Directional Spot Monopoint']);
    await expect(count).toHaveText('01 result');

    await search.fill('LMN-TR');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No modules match "lmn-tr".')).toBeVisible();

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(cards).toHaveCount(8);
    await expect(search).toHaveValue('');
    await expect(page).toHaveURL((url) => url.search === '');

    await filters.getByRole('button', { name: /^hardware/i }).click();
    await expect(names).toHaveText(['Recessed 24V Track Bus 200']);
  });

  test('the category query is validated before it filters', async ({ page }) => {
    const all = page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /^all/i });

    for (const value of ['__proto__', 'constructor', '<img src=x onerror=alert(1)>', 'LIGHTING', '']) {
      await page.goto(`/catalog?category=${encodeURIComponent(value)}`);
      await expect(page.getByRole('article'), `category=${value}`).toHaveCount(8);
      await expect(all).toHaveAttribute('aria-pressed', 'true');
    }

    await page.goto('/catalog?category=surfaces');
    await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveText([
      'Acoustic Art Frame 50x70',
    ]);
  });

  test('finish swatches recolour the scale elevation drawing', async ({ page }) => {
    await page.goto('/catalog');
    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    const drawing = card.getByRole('img', { name: /front elevation of floating shelf 110/i });
    const baseStop = drawing.locator('.elev__stop-base').first();

    await expect(card).toHaveAttribute('data-finish', 'walnut');
    await expect(card.getByRole('radio', { name: 'Walnut' })).toBeChecked();
    await expect(baseStop).toHaveCSS('stop-color', 'rgb(91, 58, 38)');
    await expect(drawing).toHaveAttribute('aria-label', /FSC American Walnut/);

    await card.getByRole('radio', { name: 'Oak' }).check();
    await expect(card).toHaveAttribute('data-finish', 'oak');
    await expect(baseStop).toHaveCSS('stop-color', 'rgb(196, 165, 124)');
    await expect(drawing).toHaveAttribute('aria-label', /Nordic White Oak/);
    await expect(card.getByText('Nordic White Oak')).toBeVisible();

    await card.getByRole('radio', { name: 'Obsidian' }).check();
    await expect(baseStop).toHaveCSS('stop-color', 'rgb(44, 46, 48)');

    const filters = page.getByRole('group', { name: 'Category' });
    await filters.getByRole('button', { name: /^lighting/i }).click();
    await expect(card).toHaveCount(0);
    await filters.getByRole('button', { name: /^all/i }).click();
    await expect(card).toHaveAttribute('data-finish', 'obsidian');

    const spot = page.getByRole('article', { name: 'Directional Spot Monopoint' });
    await expect(spot.getByRole('radio')).toHaveCount(2);
    await expect(spot.getByRole('radio', { name: 'Walnut' })).toHaveCount(0);
  });

  test('architectural and technical modes swap editorial copy for engineering telemetry', async ({ page }) => {
    await page.goto('/catalog');
    const shelf = page.getByRole('article', { name: 'Floating Shelf 110' });
    const track = page.getByRole('article', { name: 'Recessed 24V Track Bus 200' });
    const telemetry = page.getByTestId('product-telemetry');

    await expect(telemetry).toHaveCount(0);
    await expect(shelf.getByText('LMN-SH-110')).toHaveCount(0);
    await expect(shelf.getByText('16 W')).toHaveCount(0);
    await expect(shelf.getByText(/concealed steel cleat/)).toBeVisible();
    await expect(shelf.locator('.elev__tech')).toHaveCount(0);

    await modeButton(page, /technical/i).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'technical');
    await expect(telemetry).toHaveCount(8);
    await expect(shelf.getByText('LMN-SH-110')).toBeVisible();
    await expect(shelf.getByText('16 W')).toBeVisible();
    expect(await readTelemetry(shelf)).toEqual({
      SKU: 'LMN-SH-110',
      '24V DC load': '16 W',
      Output: '1150 lm',
      Efficacy: '71.9 lm/W',
      CRI: '97+',
      CCT: '2700 K',
      Mounting: '3 pts',
      'Lead time': '1-2 wk',
    });
    expect(await readTelemetry(track)).toMatchObject({
      SKU: 'LMN-TR-200',
      '24V DC load': '0 W',
      Efficacy: '--',
      CRI: '--',
      Mounting: '5 pts',
    });
    await expect(shelf.getByText(/concealed steel cleat/)).toHaveCount(0);
    await expect(shelf.locator('.elev__dim-text').first()).toHaveText('110');
    await expect(shelf.locator('.elev__anchor')).toHaveCount(3);

    await modeButton(page, /architectural/i).click();
    await expect(telemetry).toHaveCount(0);
    await expect(shelf.getByText('LMN-SH-110')).toHaveCount(0);
    await expect(shelf.getByText(/concealed steel cleat/)).toBeVisible();
  });

  test('boots clean and never overflows from 360px to 1600px in either mode', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');

    for (const mode of ['architectural', 'technical']) {
      await storeDisplayMode(page, mode);
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/catalog');
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
        await expect(page.getByRole('article')).toHaveCount(8);
        expect(await horizontalOverflow(page), `${mode} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(await readCspViolations(page), `CSP violations in ${mode} mode`).toEqual([]);
    }

    expect(errors).toEqual([]);
  });
});
