import { expect, test } from '@playwright/test';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const REVEAL_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function revealState(locator) {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return {
        revealed: el.getAttribute('data-revealed'),
        opacity: style.opacity,
        transform: style.transform,
        delay: style.transitionDelay.split(',')[0].trim(),
      };
    }),
  );
}

// Offsets and blur of a single box-shadow layer, in px.
function readKey(locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const [x = '0', y = '0'] = style.translate === 'none' ? [] : style.translate.split(' ');
    // + 0 folds a computed -0px into 0.
    const lengths = (style.boxShadow.match(/-?\d*\.?\d+px/g) ?? []).map((value) => Number.parseFloat(value) + 0);
    return {
      x: Number.parseFloat(x) + 0,
      y: Number.parseFloat(y) + 0,
      shadowX: lengths[0] ?? 0,
      shadowY: lengths[1] ?? 0,
      blur: lengths[2] ?? 0,
      layers: style.boxShadow.split(/,(?![^(]*\))/).length,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('scroll reveal', () => {
  test('home sections wait below the fold, then slide up and fade in with a staggered grid', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-reveal', 'on');

    const grid = page.getByTestId('core-modules').locator('.modules__grid');
    const cells = grid.locator(':scope > li');
    await expect(grid).toHaveClass(/\breveal-stagger\b/);
    await expect(cells).toHaveCount(3);
    for (const cell of await cells.all()) await expect(cell).toHaveClass(/\breveal-up\b/);
    await expect(page.locator('#lab-title').locator('xpath=..')).toHaveClass(/\breveal-up\b/);

    // Below the fold nothing has been revealed yet: offset 40px down, transparent.
    const before = await revealState(cells);
    for (const cell of before) {
      expect(cell).toMatchObject({ revealed: null, opacity: '0' });
      expect(cell.transform).toBe('matrix(1, 0, 0, 1, 0, 40)');
    }
    const timing = await cells.first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
    });
    expect(timing).toEqual({ duration: '0.8s, 0.8s', easing: `${REVEAL_EASE}, ${REVEAL_EASE}` });

    await grid.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(cells)).map((cell) => cell.revealed)).toEqual(['in', 'in', 'in']);
    // One row, one batch: 0, 100 and 200 ms.
    expect((await revealState(cells)).map((cell) => cell.delay)).toEqual(['0s', '0.1s', '0.2s']);
    await expect
      .poll(async () => (await revealState(cells)).map(({ opacity, transform }) => `${opacity} ${transform}`))
      .toEqual(['1 none', '1 none', '1 none']);

    // Walk the rest of the page: every reveal target ends up at rest.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    const all = page.locator('.reveal-up');
    await expect.poll(async () => (await revealState(all)).every((cell) => cell.revealed !== null)).toBe(true);
    await expect.poll(async () => (await revealState(all)).every((cell) => cell.opacity === '1')).toBe(true);

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('catalog cards cascade row by row and keep revealing after a filter', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/catalog');

    const cells = page.locator('.product-grid > li');
    await expect(page.locator('.product-grid')).toHaveClass(/\breveal-stagger\b/);
    const count = await cells.count();
    expect(count).toBeGreaterThan(4);

    // The first row is in view on load and staggers left to right.
    await expect.poll(async () => (await revealState(cells.first())).at(0).revealed).toBe('in');
    const firstRowTop = await cells.first().evaluate((el) => el.offsetTop);
    const rowSize = await cells.evaluateAll((els, top) => els.filter((el) => el.offsetTop === top).length, firstRowTop);
    expect(rowSize).toBeGreaterThan(1);
    const firstRow = (await revealState(cells)).slice(0, rowSize);
    expect(firstRow.map((cell) => cell.delay)).toEqual(
      Array.from({ length: rowSize }, (_, i) => (i === 0 ? '0s' : `${(i / 10).toFixed(1)}s`)),
    );

    const last = cells.last();
    expect((await revealState(last)).at(0)).toMatchObject({ revealed: null, opacity: '0' });
    await last.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(last)).at(0).revealed).toBe('in');
    await expect.poll(async () => (await revealState(last)).at(0).opacity).toBe('1');

    // Filtering mounts fresh cards; they reveal as soon as they are on screen.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('group', { name: 'Category' }).getByRole('button', { name: /^hardware/i }).click();
    await expect.poll(() => cells.count()).toBeLessThan(count);
    await expect
      .poll(async () => (await revealState(cells)).every((cell) => cell.revealed !== null && cell.opacity === '1'))
      .toBe(true);
    expect(errors).toEqual([]);
  });

  test('reduced motion shows every section at rest with no travel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const cells = page.getByTestId('core-modules').locator('.modules__grid > li');
    for (const cell of await revealState(cells)) {
      expect(cell).toMatchObject({ opacity: '1', transform: 'none' });
    }
    await expect(page.locator('.hero__title')).toHaveCSS('opacity', '1');
  });
});

test.describe('tactile keys', () => {
  test('a primary key lifts off a zero-blur plinth, pulls toward the pointer and settles back', async ({ page }) => {
    await page.goto('/');
    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    const key = card.getByRole('button', { name: /add to bag/i });
    await key.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(card.locator('xpath=..'))).at(0).opacity).toBe('1');

    const rest = await readKey(key);
    expect(rest).toMatchObject({ x: 0, y: 0, shadowY: 0, blur: 0, layers: 1 });

    const box = await key.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => (await readKey(key)).y).toBeCloseTo(-2, 1);
    await expect.poll(async () => (await readKey(key)).shadowY).toBeCloseTo(4, 1);
    expect((await readKey(key)).blur).toBe(0);
    // The plus turns a quarter: rotate(90deg) computes to matrix(~0, 1, -1, ~0, 0, 0).
    await expect
      .poll(() =>
        key
          .locator('svg.glyph-plus')
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).b.toFixed(3)),
      )
      .toBe('1.000');

    // Toward the right edge the cap drifts right (at most 4px) and the plinth
    // stays where the key rests, so it trails on the left.
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 4 });
    await expect.poll(async () => (await readKey(key)).x).toBeGreaterThan(2.5);
    const pulled = await readKey(key);
    expect(pulled.x).toBeLessThanOrEqual(4);
    expect(Math.abs(pulled.shadowX + pulled.x)).toBeLessThan(0.5);
    expect(pulled.blur).toBe(0);

    await page.mouse.move(box.x + box.width / 2, box.y - 120);
    await expect.poll(async () => readKey(key)).toMatchObject({ x: 0, y: 0, shadowX: 0, shadowY: 0, blur: 0 });
  });

  test('arrow keys slide their arrow 4px and the sync keys carry one', async ({ page }) => {
    await page.goto('/studio-2d');
    await page.getByRole('button', { name: 'Load preset Nordic Reading Wall' }).click();
    const sync = page.getByTestId('sync-wall-to-bag');
    const arrow = sync.locator('svg');
    await expect(arrow).toHaveCount(1);
    await sync.scrollIntoViewIfNeeded();
    await expect(arrow).toHaveCSS('transform', 'none');
    await sync.hover();
    await expect(arrow).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 4, 0)');
    await expect(sync).toHaveAccessibleName('Sync Wall to Bag');
  });
});
