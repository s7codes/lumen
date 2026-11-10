import { expect, test } from '@playwright/test';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const CINEMATIC_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const REVEAL_TARGETS = '.reveal-up, .reveal-cinematic';

function revealState(locator) {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return {
        revealed: el.getAttribute('data-revealed'),
        settled: el.hasAttribute('data-reveal-settled'),
        opacity: style.opacity,
        transform: style.transform,
        filter: style.filter,
        delay: style.transitionDelay.split(',')[0].trim(),
      };
    }),
  );
}

function revealTiming(locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      property: style.transitionProperty,
      duration: style.transitionDuration,
      easing: style.transitionTimingFunction,
    };
  });
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
  test('home media waits below the fold out of focus, then resolves from 1.05 scale and 8px blur', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-reveal', 'on');

    const grid = page.getByTestId('core-modules').locator('.modules__grid');
    const cells = grid.locator(':scope > li');
    await expect(grid).toHaveClass(/\breveal-stagger\b/);
    await expect(cells).toHaveCount(3);
    for (const cell of await cells.all()) await expect(cell).toHaveClass(/\breveal-cinematic\b/);
    await expect(page.getByTestId('surface-lab').locator('.reveal-cinematic')).toHaveCount(1);
    await expect(page.locator('#lab-title').locator('xpath=..')).toHaveClass(/\breveal-up\b/);

    // Below the fold nothing has been revealed: oversized, blurred, transparent.
    const before = await revealState(cells);
    for (const cell of before) {
      expect(cell).toMatchObject({ revealed: null, settled: false, opacity: '0', filter: 'blur(8px)' });
      expect(cell.transform).toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
    }
    expect(await revealTiming(cells.first())).toEqual({
      property: 'opacity, transform, filter',
      duration: '1.2s',
      easing: `${CINEMATIC_EASE}, ${CINEMATIC_EASE}, ${CINEMATIC_EASE}`,
    });

    // Copy rises out of a softer blur on the same curve.
    const head = page.locator('#modules-title').locator('xpath=..');
    const headBefore = (await revealState(head)).at(0);
    expect(headBefore).toMatchObject({ revealed: null, opacity: '0', filter: 'blur(4px)' });
    expect(headBefore.transform).toBe('matrix(1, 0, 0, 1, 0, 28)');
    expect((await revealTiming(head)).duration).toBe('1.1s, 1.1s, 1.1s');

    await grid.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(cells)).map((cell) => cell.revealed)).toEqual(['in', 'in', 'in']);
    // One row, one batch: 0, 100 and 200 ms.
    expect((await revealState(cells)).map((cell) => cell.delay)).toEqual(['0s', '0.1s', '0.2s']);
    // At rest the filter is none, not blur(0), so no containing block lingers.
    await expect
      .poll(async () =>
        (await revealState(cells)).map(({ opacity, transform, filter }) => `${opacity} ${transform} ${filter}`),
      )
      .toEqual(['1 none none', '1 none none', '1 none none']);
    await expect.poll(async () => (await revealState(cells)).every((cell) => cell.settled)).toBe(true);
    expect(await cells.first().evaluate((el) => getComputedStyle(el).willChange)).toBe('auto');

    // Walk the rest of the page: every reveal target ends up at rest.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += 400) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(40);
    }
    const all = page.locator(REVEAL_TARGETS);
    await expect.poll(async () => (await revealState(all)).every((cell) => cell.revealed !== null)).toBe(true);
    await expect
      .poll(async () => (await revealState(all)).every((cell) => cell.opacity === '1' && cell.filter === 'none'))
      .toBe(true);

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
    for (const cell of await cells.all()) await expect(cell).toHaveClass(/\breveal-cinematic\b/);

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
    expect((await revealState(last)).at(0)).toMatchObject({ revealed: null, opacity: '0', filter: 'blur(8px)' });
    await last.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(last)).at(0).revealed).toBe('in');
    await expect
      .poll(async () => (await revealState(last)).map(({ opacity, transform, filter }) => `${opacity} ${transform} ${filter}`))
      .toEqual(['1 none none']);

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
      expect(cell).toMatchObject({ opacity: '1', transform: 'none', filter: 'none' });
    }
    await expect(page.locator('.hero__title')).toHaveCSS('opacity', '1');
  });
});

// Inline tilt, glow custom properties and the layout footprint of a card.
function readTilt(card) {
  return card.evaluate((el) => {
    const glow = getComputedStyle(el, '::before');
    const match = el.style.transform.match(
      /^perspective\((\d+)px\) rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\)$/,
    );
    return {
      inline: el.style.transform,
      computed: getComputedStyle(el).transform,
      perspective: match ? Number(match[1]) : null,
      rx: match ? Number(match[2]) : 0,
      ry: match ? Number(match[3]) : 0,
      glowA: Number.parseFloat(el.style.getPropertyValue('--glow-a') || '0'),
      glowX: Number.parseFloat(el.style.getPropertyValue('--glow-x') || '0'),
      glowY: Number.parseFloat(el.style.getPropertyValue('--glow-y') || '0'),
      glowOpacity: Number.parseFloat(glow.opacity),
      glowImage: glow.backgroundImage,
      footprint: `${el.offsetWidth}x${el.offsetHeight}`,
    };
  });
}

async function settledCatalogCard(page, name) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/catalog');
  const card = page.getByRole('article', { name });
  await card.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await revealState(card.locator('xpath=..'))).at(0).transform).toBe('none');
  return card;
}

test.describe('product imagery', () => {
  test('a catalog card is a frosted bento tile with a 16px radius and a hairline edge', async ({ page }) => {
    const card = await settledCatalogCard(page, 'Floating Shelf 110');
    const tile = await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        radius: style.borderTopLeftRadius,
        border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        image: style.backgroundImage,
        blur: style.backdropFilter,
      };
    });
    expect(tile.radius).toBe('16px');
    expect(tile.border).toBe('1px solid rgba(255, 255, 255, 0.06)');
    expect(tile.image).toBe(
      'linear-gradient(145deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
    );
    expect(tile.blur).toBe('blur(16px)');
  });

  test('hovering a catalog card tilts it toward the pointer, lights a cursor glow and eases the drawing forward', async ({
    page,
  }) => {
    const card = await settledCatalogCard(page, 'Floating Shelf 110');
    const stage = card.locator('.product-card__figure');
    const drawing = stage.locator('svg.elev');

    await expect(stage).toHaveCSS('overflow', 'hidden');
    // No outline and no solid tile: the stage is a soft gradient only.
    const surface = await stage.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        border: style.borderTopWidth,
        color: style.backgroundColor,
        image: style.backgroundImage.startsWith('radial-gradient'),
      };
    });
    expect(surface).toEqual({ border: '0px', color: 'rgba(0, 0, 0, 0)', image: true });
    const timing = await drawing.evaluate((el) => {
      const style = getComputedStyle(el);
      return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
    });
    expect(timing).toEqual({ duration: '0.9s', easing: CINEMATIC_EASE });
    await expect(drawing).toHaveCSS('transform', 'none');

    // At rest the card carries no transform at all and the glow is dark.
    const rest = await readTilt(card);
    expect(rest).toMatchObject({ inline: '', computed: 'none', glowA: 0, glowOpacity: 0 });
    expect(rest.glowImage).toContain('radial-gradient');
    const stageFootprint = await stage.evaluate((el) => `${el.offsetWidth}x${el.offsetHeight}`);

    // Upper-left quadrant: that corner lifts toward the viewer, so rotateX
    // goes negative and rotateY positive, each capped at 4 degrees.
    const box = await card.boundingBox();
    const pointer = { x: box.width * 0.25, y: box.height * 0.2 };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + pointer.x, box.y + pointer.y, { steps: 6 });
    await expect(drawing).toHaveCSS('transform', 'matrix(1.045, 0, 0, 1.045, 0, 0)');
    await expect.poll(async () => (await readTilt(card)).glowA).toBeGreaterThan(0.95);
    const tilted = await readTilt(card);
    expect(tilted.perspective).toBe(1000);
    expect(tilted.rx).toBeLessThan(-1);
    expect(tilted.ry).toBeGreaterThan(1);
    expect(Math.abs(tilted.rx)).toBeLessThanOrEqual(4);
    expect(Math.abs(tilted.ry)).toBeLessThanOrEqual(4);
    expect(tilted.computed).toMatch(/^matrix3d\(/);
    expect(tilted.glowOpacity).toBeGreaterThan(0.95);
    // The glow sits under the pointer, measured from the card's top-left.
    expect(Math.abs(tilted.glowX - pointer.x)).toBeLessThan(16);
    expect(Math.abs(tilted.glowY - pointer.y)).toBeLessThan(16);
    // Tilt is paint only: the layout footprint of card and stage never moves.
    expect(tilted.footprint).toBe(rest.footprint);
    expect(await stage.evaluate((el) => `${el.offsetWidth}x${el.offsetHeight}`)).toBe(stageFootprint);

    await page.mouse.move(4, 4);
    await expect(drawing).toHaveCSS('transform', 'none');
    await expect
      .poll(async () => {
        const { inline, computed, glowA } = await readTilt(card);
        return { inline, computed, glowA };
      })
      .toEqual({ inline: '', computed: 'none', glowA: 0 });
  });

  test('reduced motion keeps the cursor glow but never tilts a card', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const card = await settledCatalogCard(page, 'Corner Floor Column 140');
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 4 });
    await expect.poll(async () => (await readTilt(card)).glowA).toBeGreaterThan(0.95);
    expect(await readTilt(card)).toMatchObject({ inline: '', computed: 'none' });
  });
});

test.describe('tactile keys', () => {
  test('a primary key lifts off a zero-blur plinth, pulls toward the pointer and settles back', async ({ page }) => {
    await page.goto('/');
    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    const key = card.getByRole('button', { name: /add to bag/i });
    await key.scrollIntoViewIfNeeded();
    // Wait for the cinematic reveal to finish scaling, or the pointer would aim at a moving key.
    await expect
      .poll(async () => (await revealState(card.locator('xpath=..'))).map(({ opacity, transform }) => `${opacity} ${transform}`))
      .toEqual(['1 none']);

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
