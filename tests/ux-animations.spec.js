import { expect, test } from '@playwright/test';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const CINEMATIC_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const REVEAL_TARGETS = '.reveal-up, .reveal-cinematic, .reveal-card';

function revealState(locator) {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return {
        revealed: el.getAttribute('data-revealed'),
        settled: el.hasAttribute('data-reveal-settled'),
        opacity: style.opacity,
        transform: style.transform,
        scale: style.scale,
        filter: style.filter,
        delay: style.transitionDelay.split(',')[0].trim(),
        animationDelay: style.animationDelay,
      };
    }),
  );
}

function cardEntrance(locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      name: style.animationName,
      duration: style.animationDuration,
      easing: style.animationTimingFunction,
    };
  });
}

// Waits for a product card's entrance to finish and its compositor hints to drop.
async function waitForCardAtRest(card) {
  await expect
    .poll(async () => {
      const [state] = await revealState(card);
      return `${state.opacity} ${state.scale} ${state.filter} ${state.settled}`;
    })
    .toBe('1 none none true');
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
  test('home media resolves from 1.05 scale and 8px blur; product cards grow in from 0.95', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-reveal', 'on');

    const grid = page.getByTestId('core-modules').locator('.modules__grid');
    const cells = grid.locator('.product-card');
    await expect(grid).toHaveClass(/\breveal-stagger\b/);
    await expect(cells).toHaveCount(3);
    for (const cell of await cells.all()) await expect(cell).toHaveClass(/\breveal-card\b/);
    const lab = page.getByTestId('surface-lab').locator('.reveal-cinematic');
    await expect(lab).toHaveCount(1);
    await expect(page.locator('#lab-title').locator('xpath=..')).toHaveClass(/\breveal-up\b/);

    // Below the fold the lab stage waits oversized, blurred and transparent.
    const labBefore = (await revealState(lab)).at(0);
    expect(labBefore).toMatchObject({ revealed: null, settled: false, opacity: '0', filter: 'blur(8px)' });
    expect(labBefore.transform).toBe('matrix(1.05, 0, 0, 1.05, 0, 0)');
    expect(await revealTiming(lab)).toEqual({
      property: 'opacity, transform, filter',
      duration: '1.2s',
      easing: `${CINEMATIC_EASE}, ${CINEMATIC_EASE}, ${CINEMATIC_EASE}`,
    });

    // Cards wait transparent at 0.95 on the individual scale property, so the
    // transform property stays free.
    for (const cell of await revealState(cells)) {
      expect(cell).toMatchObject({ revealed: null, settled: false, opacity: '0', scale: '0.95', transform: 'none' });
    }

    // Copy rises out of a softer blur on the same curve.
    const head = page.locator('#modules-title').locator('xpath=..');
    const headBefore = (await revealState(head)).at(0);
    expect(headBefore).toMatchObject({ revealed: null, opacity: '0', filter: 'blur(4px)' });
    expect(headBefore.transform).toBe('matrix(1, 0, 0, 1, 0, 28)');
    expect((await revealTiming(head)).duration).toBe('1.1s, 1.1s, 1.1s');

    await grid.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(cells)).map((cell) => cell.revealed)).toEqual(['in', 'in', 'in']);
    expect(await cardEntrance(cells.first())).toEqual({
      name: 'lumen-card-in',
      duration: '1s',
      easing: CINEMATIC_EASE,
    });
    // One row, one batch: 0, 100 and 200 ms, staggered through the grid cells.
    expect((await revealState(cells)).map((cell) => cell.animationDelay)).toEqual(['0s', '0.1s', '0.2s']);
    // At rest the filter is none, not blur(0), so no containing block lingers.
    await expect
      .poll(async () =>
        (await revealState(cells)).map(
          ({ opacity, transform, scale, filter }) => `${opacity} ${transform} ${scale} ${filter}`,
        ),
      )
      .toEqual(['1 none none none', '1 none none none', '1 none none none']);
    await expect.poll(async () => (await revealState(cells)).every((cell) => cell.settled)).toBe(true);
    expect(await cells.first().evaluate((el) => getComputedStyle(el).willChange)).toBe('auto');

    // Walk the rest of the page: every reveal target ends up at rest. Each stop holds
    // for two animation frames, so the observer gets a rendering pass at every
    // position however few frames a loaded runner draws.
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= total; y += 400) {
      await page.evaluate(
        (top) =>
          new Promise((resolve) => {
            window.scrollTo(0, top);
            requestAnimationFrame(() => requestAnimationFrame(resolve));
          }),
        y,
      );
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

    const cells = page.locator('.product-grid .product-card');
    await expect(page.locator('.product-grid')).toHaveClass(/\breveal-stagger\b/);
    const count = await cells.count();
    expect(count).toBeGreaterThan(4);
    for (const cell of await cells.all()) await expect(cell).toHaveClass(/\breveal-card\b/);

    // The first row is in view on load and staggers left to right.
    await expect.poll(async () => (await revealState(cells.first())).at(0).revealed).toBe('in');
    const firstRowTop = await cells.first().evaluate((el) => el.parentElement.offsetTop);
    const rowSize = await cells.evaluateAll(
      (els, top) => els.filter((el) => el.parentElement.offsetTop === top).length,
      firstRowTop,
    );
    expect(rowSize).toBeGreaterThan(1);
    const firstRow = (await revealState(cells)).slice(0, rowSize);
    expect(firstRow.map((cell) => cell.animationDelay)).toEqual(
      Array.from({ length: rowSize }, (_, i) => (i === 0 ? '0s' : `${(i / 10).toFixed(1)}s`)),
    );

    const last = cells.last();
    expect((await revealState(last)).at(0)).toMatchObject({ revealed: null, opacity: '0', scale: '0.95' });
    await last.scrollIntoViewIfNeeded();
    await expect.poll(async () => (await revealState(last)).at(0).revealed).toBe('in');
    await expect
      .poll(async () =>
        (await revealState(last)).map(({ opacity, scale, filter }) => `${opacity} ${scale} ${filter}`),
      )
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
    const cells = page.getByTestId('core-modules').locator('.modules__grid .product-card');
    await expect(cells).toHaveCount(3);
    for (const cell of await revealState(cells)) {
      expect(cell).toMatchObject({ opacity: '1', transform: 'none', scale: 'none', filter: 'none' });
    }
    await expect(page.locator('.hero__title')).toHaveCSS('opacity', '1');
  });
});

// Inline transform, cursor-light custom properties and the layout footprint of a card.
// The light is painted inside the plinth, on its ::after layer.
function readTilt(card) {
  return card.evaluate((el) => {
    const glow = getComputedStyle(el.querySelector('.product-card__figure'), '::after');
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
  await waitForCardAtRest(card);
  return card;
}

test.describe('product imagery', () => {
  test('a catalog card is a naked plinth: a square 4:3 plaster wall over the specification on bare paper', async ({
    page,
  }) => {
    const card = await settledCatalogCard(page, 'Floating Shelf 110');
    const tile = await card.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        radius: style.borderTopLeftRadius,
        top: style.borderTopWidth,
        bottom: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`,
        surface: style.backgroundColor,
        image: style.backgroundImage,
        blur: style.backdropFilter,
      };
    });
    // No outer frame, no fill, no corner radius: one hairline closes the card.
    expect(tile).toEqual({
      radius: '0px',
      top: '0px',
      bottom: '1px solid rgba(20, 19, 17, 0.14)',
      surface: 'rgba(0, 0, 0, 0)',
      image: 'none',
      blur: 'none',
    });

    // The plinth: square, 4:3, a limestone-taupe plaster wall (never a black void),
    // flush with the card's top and sides.
    const plinth = card.locator('.product-card__figure');
    const stage = await plinth.evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return { radius: style.borderTopLeftRadius, surface: style.backgroundColor, ratio: box.width / box.height };
    });
    expect(stage.radius).toBe('0px');
    expect(stage.surface).toBe('rgb(61, 55, 49)');
    expect(stage.ratio).toBeCloseTo(4 / 3, 1);
    const [cardBox, plinthBox] = await Promise.all([card.boundingBox(), plinth.boundingBox()]);
    expect(Math.abs(plinthBox.y - cardBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(plinthBox.width - cardBox.width)).toBeLessThanOrEqual(1);

    // Everything below the plinth sits on the paper; swatches are square, the key is matte carbon.
    const body = card.locator('.product-card__body');
    expect((await body.boundingBox()).y).toBeGreaterThanOrEqual(plinthBox.y + plinthBox.height - 1);
    await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(card.getByRole('heading', { level: 3 })).toHaveCSS('font-weight', '400');
    await expect(card.locator('.swatch__chip').first()).toHaveCSS('border-top-left-radius', '0px');
    const add = card.getByRole('button', { name: /add to cart/i });
    await expect(add).toHaveCSS('background-color', 'rgb(20, 19, 17)');
    await expect(add).toHaveCSS('color', 'rgb(250, 249, 246)');
    await expect(add).toHaveCSS('border-top-left-radius', '0px');
  });

  test('hovering a catalog card lights the plinth under the pointer and eases the drawing forward; the card never tilts', async ({
    page,
  }) => {
    const card = await settledCatalogCard(page, 'Floating Shelf 110');
    const stage = card.locator('.product-card__figure');
    const drawing = stage.locator('svg.elev');

    await expect(stage).toHaveCSS('overflow', 'hidden');
    // No outline: the plinth is umber plaster under the fixture's soft wall-wash scallop.
    const surface = await stage.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        border: style.borderTopWidth,
        color: style.backgroundColor,
        image: style.backgroundImage.startsWith('radial-gradient'),
      };
    });
    expect(surface).toEqual({ border: '0px', color: 'rgb(61, 55, 49)', image: true });
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

    // Upper-left of the plinth: the light pools under the pointer in the fixture's
    // own colour temperature, and the object on the plinth holds still.
    const box = await card.boundingBox();
    const pointer = { x: box.width * 0.25, y: box.height * 0.2 };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + pointer.x, box.y + pointer.y, { steps: 6 });
    await expect(drawing).toHaveCSS('transform', 'matrix(1.045, 0, 0, 1.045, 0, 0)');
    await expect.poll(async () => (await readTilt(card)).glowA).toBeGreaterThan(0.95);
    const lit = await readTilt(card);
    expect(lit).toMatchObject({ inline: '', computed: 'none', perspective: null });
    expect(lit.glowOpacity).toBeGreaterThan(0.95);
    expect(lit.glowImage).toContain('rgba(255, 167, 87, 0.16)');
    // The light sits under the pointer, measured from the card's top-left.
    expect(Math.abs(lit.glowX - pointer.x)).toBeLessThan(16);
    expect(Math.abs(lit.glowY - pointer.y)).toBeLessThan(16);
    // Light is paint only: the layout footprint of card and plinth never moves.
    expect(lit.footprint).toBe(rest.footprint);
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
  test('a primary key is a matte carbon slab: it deepens on hover and never lifts, drifts or casts a plinth', async ({
    page,
  }) => {
    await page.goto('/');
    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    const key = card.getByRole('button', { name: /add to cart/i });
    await key.scrollIntoViewIfNeeded();
    // Wait for the card entrance to finish scaling, or the pointer would aim at a moving key.
    await waitForCardAtRest(card);

    const rest = await readKey(key);
    expect(rest).toMatchObject({ x: 0, y: 0, shadowX: 0, shadowY: 0, blur: 0 });
    await expect(key).toHaveCSS('box-shadow', 'none');
    await expect(key).toHaveCSS('background-color', 'rgb(20, 19, 17)');
    await expect(key).toHaveCSS('border-top-left-radius', '0px');
    await expect(key).toHaveCSS('font-family', /Inter Tight/);
    const restBox = await key.boundingBox();

    // Hover: the surface deepens to #2b2925; the plus turns a quarter, the key stays put.
    await page.mouse.move(restBox.x + restBox.width / 2, restBox.y + restBox.height / 2);
    await expect(key).toHaveCSS('background-color', 'rgb(43, 41, 37)');
    // rotate(90deg) computes to matrix(~0, 1, -1, ~0, 0, 0).
    await expect
      .poll(() =>
        key
          .locator('svg.glyph-plus')
          .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).b.toFixed(3)),
      )
      .toBe('1.000');

    // Toward the right edge nothing pulls the key: no translate, no plinth, no glow.
    await page.mouse.move(restBox.x + restBox.width - 3, restBox.y + restBox.height / 2, { steps: 4 });
    expect(await readKey(key)).toMatchObject({ x: 0, y: 0, shadowX: 0, shadowY: 0, blur: 0 });
    const held = await key.boundingBox();
    expect(Math.abs(held.x - restBox.x) + Math.abs(held.y - restBox.y)).toBeLessThan(0.5);

    // The naked secondary key is one carbon hairline that inverts on hover.
    const explore = page.getByRole('link', { name: 'Explore Full Catalog' });
    await explore.scrollIntoViewIfNeeded();
    await expect(explore).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(explore).toHaveCSS('border-top-color', 'rgb(20, 19, 17)');
    await explore.hover();
    await expect(explore).toHaveCSS('background-color', 'rgb(20, 19, 17)');
    await expect(explore).toHaveCSS('color', 'rgb(250, 249, 246)');
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
    await expect(sync).toHaveAccessibleName('Sync Wall to Cart');
  });
});
