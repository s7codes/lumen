import { expect, test } from '@playwright/test';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

/** Faces of the visual painted in exactly this colour. */
function facesIn(visual, hex) {
  return visual.locator(`polygon[fill="${hex}"]`);
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

    await expect(cards).toHaveCount(12);
    await expect(count).toHaveText('12 results');

    await filters.getByRole('button', { name: /^lighting/i }).click();
    await expect(filters.getByRole('button', { name: /^lighting/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL((url) => url.pathname === '/catalog' && url.search === '?category=lighting');
    await expect(names).toHaveText([
      'Linear Lightbar 60',
      'Corner Floor Column 140',
      'Directional Spot Monopoint',
      'Linear Suspension Pendant 150',
      'Vertical Architectural Sconce 80',
    ]);

    await page.getByRole('combobox', { name: 'Sort' }).selectOption('price-desc');
    await expect(names).toHaveText([
      'Linear Suspension Pendant 150',
      'Corner Floor Column 140',
      'Vertical Architectural Sconce 80',
      'Linear Lightbar 60',
      'Directional Spot Monopoint',
    ]);

    await search.fill('spot');
    await expect(names).toHaveText(['Directional Spot Monopoint']);
    await expect(count).toHaveText('01 result');

    await search.fill('LMN-TR');
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No modules match "lmn-tr".')).toBeVisible();

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(cards).toHaveCount(12);
    await expect(search).toHaveValue('');
    await expect(page).toHaveURL((url) => url.search === '');

    await filters.getByRole('button', { name: /^hardware/i }).click();
    await expect(names).toHaveText(['Recessed 24V Track Bus 200', 'Recessed 24V DALI-2 Bus Hub']);
  });

  test('the category query is validated before it filters', async ({ page }) => {
    const all = page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /^all/i });

    for (const value of ['__proto__', 'constructor', '<img src=x onerror=alert(1)>', 'LIGHTING', '']) {
      await page.goto(`/catalog?category=${encodeURIComponent(value)}`);
      await expect(page.getByRole('article'), `category=${value}`).toHaveCount(12);
      await expect(all).toHaveAttribute('aria-pressed', 'true');
    }

    await page.goto('/catalog?category=surfaces');
    await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveText([
      'Acoustic Art Frame 50x70',
      'Acoustic Wall Baffle 120',
    ]);
  });

  test('finish swatches refinish the part inside its lit interior', async ({ page }) => {
    await page.goto('/catalog');
    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    const visual = card.getByTestId('product-visual');
    await expect(visual).toHaveAttribute('aria-label', /^Floating Shelf 110 in FSC American Walnut, 110 x 8 cm, shown in a daylight gallery interior with its 2700K light on$/);

    await expect(card).toHaveAttribute('data-finish', 'walnut');
    await expect(card.getByRole('radio', { name: 'Walnut' })).toBeChecked();
    expect(await facesIn(visual, '#5b3a26').count()).toBeGreaterThan(0);

    await card.getByRole('radio', { name: 'Oak' }).check();
    await expect(card).toHaveAttribute('data-finish', 'oak');
    await expect(visual).toHaveAttribute('aria-label', /Nordic White Oak/);
    await expect.poll(() => facesIn(visual, '#c4a57c').count()).toBeGreaterThan(0);
    await expect(facesIn(visual, '#5b3a26')).toHaveCount(0);
    await expect(card.getByText('Nordic White Oak')).toBeVisible();

    await card.getByRole('radio', { name: 'Obsidian' }).check();
    await expect.poll(() => facesIn(visual, '#2c2e30').count()).toBeGreaterThan(0);

    const filters = page.getByRole('group', { name: 'Category' });
    await filters.getByRole('button', { name: /^lighting/i }).click();
    await expect(card).toHaveCount(0);
    await filters.getByRole('button', { name: /^all/i }).click();
    await expect(card).toHaveAttribute('data-finish', 'obsidian');

    const spot = page.getByRole('article', { name: 'Directional Spot Monopoint' });
    await expect(spot.getByRole('radio')).toHaveCount(2);
    await expect(spot.getByRole('radio', { name: 'Walnut' })).toHaveCount(0);
  });

  test('the storefront always reads in Visual: editorial copy on every card, even with Specs stored', async ({ page }) => {
    await page.goto('/catalog');
    await storeDisplayMode(page, 'technical');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'architectural');
    await expect(page.getByTestId('mode-switch')).toHaveCount(0);
    const shelf = page.getByRole('article', { name: 'Floating Shelf 110' });
    await expect(page.getByTestId('product-telemetry')).toHaveCount(0);
    await expect(shelf.getByText('LMN-SH-110')).toHaveCount(0);
    await expect(shelf.getByText(/concealed steel cleat/)).toBeVisible();
    await expect(shelf.locator('.swatches__surface')).toHaveText('Oiled solid timber, FSC 100%');
    await expect(page.locator('.catalog__toolbar')).toContainText('Daylight interiors / 2700K');
  });

  test('boots clean and never overflows from 360px to 1600px in either mode', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');

    for (const mode of ['architectural', 'technical']) {
      await storeDisplayMode(page, mode);
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/catalog');
        // The stored planner preference never reaches the storefront.
        await expect(page.locator('html')).toHaveAttribute('data-mode', 'architectural');
        await expect(page.getByRole('article')).toHaveCount(12);
        expect(await horizontalOverflow(page), `${mode} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(await readCspViolations(page), `CSP violations in ${mode} mode`).toEqual([]);
    }

    expect(errors).toEqual([]);
  });
});
