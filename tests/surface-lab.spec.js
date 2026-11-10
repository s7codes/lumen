import { expect, test } from '@playwright/test';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
  storeDisplayMode,
  VIEWPORT_WIDTHS,
} from './support/runtime-guards.js';

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('surface and dimming lab', () => {
  test('dimmer, colour temperature and surface drive the bench and live telemetry', async ({ page }) => {
    await page.goto('/');
    const lab = page.getByTestId('surface-lab');
    const bench = lab.getByTestId('lab-bench');
    const dimmer = lab.getByRole('slider', { name: 'Dimmer' });
    const readout = (key) => lab.getByTestId(`lab-${key}`);
    const benchVar = (name) => bench.evaluate((el, prop) => el.style.getPropertyValue(prop), name);

    await lab.scrollIntoViewIfNeeded();
    await expect(dimmer).toHaveValue('72');
    await expect(bench).toHaveAttribute('data-kelvin', '2700');
    await expect(bench).toHaveAttribute('data-material', 'walnut');
    await expect(readout('load')).toHaveText('11.5 W');
    await expect(readout('output')).toHaveText('828 lm');
    await expect(readout('reflected')).toHaveText('116 lm');

    await dimmer.fill('40');
    await expect(readout('level')).toHaveText('40%');
    await expect(readout('load')).toHaveText('6.4 W');
    await expect(readout('output')).toHaveText('460 lm');
    await expect(readout('efficacy')).toHaveText('71.9 lm/W');
    expect(await benchVar('--lab-level')).toBe('0.400');

    const warmLight = await benchVar('--lab-light');
    await lab.getByRole('radio', { name: '3500K Neutral Studio' }).check();
    await expect(bench).toHaveAttribute('data-kelvin', '3500');
    await expect(readout('cct')).toHaveText('3500 K');
    await expect(readout('output')).toHaveText('497 lm');
    await expect(readout('efficacy')).toHaveText('77.6 lm/W');
    const neutralLight = await benchVar('--lab-light');
    expect(Number(neutralLight.split(',')[2])).toBeGreaterThan(Number(warmLight.split(',')[2]));

    await lab.getByRole('radio', { name: '2400K Candle' }).check();
    await expect(readout('output')).toHaveText('405 lm');
    await expect(readout('efficacy')).toHaveText('63.3 lm/W');

    await lab.getByRole('radio', { name: 'Matte Chalk' }).check();
    await expect(bench).toHaveAttribute('data-material', 'chalk');
    await expect(readout('lrv')).toHaveText('82%');
    await expect(readout('reflected')).toHaveText('332 lm');
    expect(await benchVar('--slat-base')).toBe('#e4dfd5');
    await expect
      .poll(() => bench.locator('.lab-bench__slat').first().evaluate((el) => getComputedStyle(el).backgroundImage))
      .toContain('rgb(228, 223, 213)');

    await dimmer.fill('0');
    await expect(readout('load')).toHaveText('0.0 W');
    await expect(readout('output')).toHaveText('0 lm');
    await expect(readout('efficacy')).toHaveText('--');
    await expect(readout('reflected')).toHaveText('0 lm');
  });

  test('the dimmer is a native range input that follows the keyboard', async ({ page }) => {
    await page.goto('/');
    const dimmer = page.getByRole('slider', { name: 'Dimmer' });
    await dimmer.focus();

    await page.keyboard.press('End');
    await expect(page.getByTestId('lab-level')).toHaveText('100%');
    await expect(page.getByTestId('lab-load')).toHaveText('16.0 W');
    await expect(page.getByTestId('lab-output')).toHaveText('1150 lm');

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('lab-level')).toHaveText('99%');

    await page.keyboard.press('Home');
    await expect(page.getByTestId('lab-level')).toHaveText('0%');
  });

  test('technical mode overlays the isolux contours on the bench', async ({ page }) => {
    await page.goto('/');
    const contours = page.getByTestId('lab-bench').locator('.lab-bench__isolux');
    await expect(contours).toBeHidden();

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: /technical/i }).click();
    await expect(contours).toBeVisible();
    await expect(contours.locator('.lab-bench__contour')).toHaveCount(3);
  });
});

test.describe('core modules', () => {
  test('previews the flagship modules, adds to the bag and links to the full catalog', async ({ page }) => {
    await page.goto('/');
    const modules = page.getByTestId('core-modules');
    const cards = modules.getByRole('article');

    await expect(cards).toHaveCount(3);
    await expect(cards.getByRole('heading', { level: 3 })).toHaveText([
      'Floating Shelf 110',
      'Corner Floor Column 140',
      'Acoustic Art Frame 50x70',
    ]);

    const frame = modules.getByRole('article', { name: 'Acoustic Art Frame 50x70' });
    await frame.getByRole('radio', { name: 'Chalk' }).check();
    await frame.getByRole('button', { name: /add to bag/i }).click();

    await expect(page.getByRole('button', { name: 'Cart (1)' })).toBeVisible();
    await expect(frame.getByTestId('in-bag')).toHaveText('In bag 1');
    await expect(page.getByRole('region', { name: 'Notifications' }).getByTestId('toast-message')).toHaveText(
      'Acoustic Art Frame 50x70, Chalk added to bag.',
    );

    await modules.getByRole('link', { name: 'Explore Full Catalog' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/catalog');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog');
    await expect(page.getByRole('button', { name: 'Cart (1)' })).toBeVisible();
  });
});

test.describe('home showcase integrity', () => {
  test('boots clean and never overflows from 360px to 1600px in either mode', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');

    for (const mode of ['architectural', 'technical']) {
      await storeDisplayMode(page, mode);
      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode);
        await expect(page.getByTestId('core-modules').getByRole('article')).toHaveCount(3);
        expect(await horizontalOverflow(page), `${mode} at ${width}px`).toBeLessThanOrEqual(0);
      }
      expect(await readCspViolations(page), `CSP violations in ${mode} mode`).toEqual([]);
    }

    expect(errors).toEqual([]);
  });
});
