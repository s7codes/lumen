import { expect, test } from '@playwright/test';
import { safeJsonParse } from '../src/security/sanitize.js';

const VIEWS = [
  { path: '/', heading: /light and storage on one modular spine/i },
  { path: '/catalog', heading: 'Catalog' },
  { path: '/room-3d', heading: 'Room Planner' },
  { path: '/checkout', heading: 'Project Quote' },
];

const HOME_TITLE = 'Lumen - Architectural Lighting & Modular Systems';

// Three pages: the overview, the 3D Room Planner and the catalog.
const NAV_SEQUENCE = [
  { link: /catalog/i, path: '/catalog', heading: 'Catalog', title: 'Catalog - Lumen' },
  { link: /3d room/i, path: '/room-3d', heading: 'Room Planner', title: 'Room Planner - Lumen' },
  { link: /overview/i, path: '/', heading: /light and storage/i, title: HOME_TITLE },
];

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

function readCspViolations(page) {
  return page.evaluate(() => window.__cspViolations);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
});

test.describe('app shell', () => {
  test('every view boots with zero console errors, page errors or CSP violations', async ({ page }) => {
    const errors = collectRuntimeErrors(page);

    for (const view of VIEWS) {
      await page.goto(view.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(view.heading);
      await page.waitForLoadState('networkidle');
      expect(await readCspViolations(page), `CSP violations on ${view.path}`).toEqual([]);
    }

    expect(errors).toEqual([]);
  });

  test('ships the strict Content Security Policy in the document head', async ({ page }) => {
    await page.goto('/');
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self';");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  test('navbar routes between all views client-side without a document reload', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);

    await page.evaluate(() => {
      window.__lumenSessionMarker = 'alive';
    });
    let documentRequests = 0;
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documentRequests += 1;
    });

    const nav = page.getByRole('navigation', { name: 'Primary' });
    // Overview, 3D Room and Catalog: the 2D Wall Studio is retired, and
    // Visual | Specs lives only inside the 3D Room Planner.
    await expect(nav.getByRole('link')).toHaveText(['Overview', '3D Room', 'Catalog']);
    await expect(nav.getByRole('link', { name: '3D Room' })).toHaveAttribute('href', '/room-3d');
    await expect(page.locator('header.navbar').getByTestId('mode-switch')).toHaveCount(0);
    await expect(page.locator('header.navbar')).not.toContainText(/wall studio|specs/i);

    for (const step of NAV_SEQUENCE) {
      await nav.getByRole('link', { name: step.link }).click();

      await expect(page).toHaveURL((url) => url.pathname === step.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(step.heading);
      await expect(nav.getByRole('link', { name: step.link })).toHaveAttribute('aria-current', step.currentAs ?? 'page');
      await expect(page).toHaveTitle(step.title);
      expect(await page.evaluate(() => window.__lumenSessionMarker)).toBe('alive');
    }

    expect(documentRequests).toBe(0);
    expect(errors).toEqual([]);
  });

  test('ambient hero surface moves its light coordinates with the pointer', async ({ page }) => {
    await page.goto('/');
    const surface = page.getByTestId('ambient-surface');
    await expect(surface).toBeVisible();

    const readLight = () =>
      surface.evaluate((el) => ({
        x: Number.parseFloat(el.style.getPropertyValue('--light-x')),
        y: Number.parseFloat(el.style.getPropertyValue('--light-y')),
      }));

    const rest = await readLight();
    expect(rest.x).toBeCloseTo(74, 0);
    expect(rest.y).toBeCloseTo(34, 0);

    const box = await surface.boundingBox();
    const target = { x: 0.15, y: 0.7 };
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
    await page.mouse.move(box.x + box.width * target.x, box.y + box.height * target.y, { steps: 10 });

    await expect.poll(async () => (await readLight()).x).toBeLessThan(rest.x - 10);

    // The spring settles on the pointer position within a second or so.
    await expect
      .poll(async () => {
        const light = await readLight();
        return Math.abs(light.x - target.x * 100) < 1 && Math.abs(light.y - target.y * 100) < 1;
      })
      .toBe(true);

    // Leaving the surface returns the light to its resting position.
    await page.mouse.move(box.x + box.width * 0.5, 5);
    await expect
      .poll(async () => {
        const light = await readLight();
        return Math.abs(light.x - rest.x) < 1 && Math.abs(light.y - rest.y) < 1;
      })
      .toBe(true);
  });

  test('hero copy holds a measured left inset at a 7rem cap and leaves the right track open', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 2560, height: 1440 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const hero = page.getByTestId('ambient-surface');
      const copy = page.getByTestId('hero-copy');
      const title = page.locator('.hero__title');
      await expect(title).toHaveCSS('opacity', '1');

      const heroBox = await hero.boundingBox();
      const copyBox = await copy.boundingBox();
      const label = `${viewport.width}x${viewport.height}`;
      // Off the edge on a 9vw inset capped at 220px, not centred in the frame.
      const inset = Math.min(220, viewport.width * 0.09);
      expect(copyBox.x - heroBox.x, label).toBeGreaterThanOrEqual(inset - 1);
      expect(copyBox.x - heroBox.x, label).toBeLessThanOrEqual(inset + 1);
      // The headline tops out at 7rem of the current root size.
      const type = await title.evaluate((el) => ({
        size: Number.parseFloat(getComputedStyle(el).fontSize),
        root: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      }));
      expect(type.size, label).toBeLessThanOrEqual(type.root * 7 + 0.5);
      expect(type.size, label).toBeGreaterThan(type.root * 4.5);
      // The widest rendered line of copy stops well short of the lamp at rest (74%).
      const inkRight = await copy.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let right = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) right = Math.max(right, rect.right);
        }
        return right;
      });
      expect(inkRight, label).toBeLessThan(heroBox.x + heroBox.width * 0.66);
      // Lowered into the frame: the copy sits in the lower part of the hero.
      expect(copyBox.y - heroBox.y, label).toBeGreaterThan(heroBox.height * 0.08);
      expect(heroBox.y + heroBox.height - (copyBox.y + copyBox.height), label).toBeLessThan(heroBox.height * 0.1);
    }

    // The hero is a light architectural interior: carbon type over smooth
    // sand-stone plaster (#c6b9a5), above the warm Flos paper (#faf9f6).
    await expect(page.locator('.hero__title')).toHaveCSS('color', 'rgb(20, 19, 17)');
    await expect(page.locator('.hero__title')).toHaveCSS('font-weight', '360');
    await expect(page.locator('.hero__lede')).toHaveCSS('color', 'rgba(20, 19, 17, 0.8)');
    await expect(page.getByTestId('ambient-surface')).toHaveCSS('background-color', 'rgb(198, 185, 165)');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 249, 246)');
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(20, 19, 17)');
  });

  test('home content below the hero alternates flush paper with full-bleed bands: square corners, hairline rules, no tiles or glass', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const look = (locator) =>
      locator.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          radius: style.borderTopLeftRadius,
          surface: style.backgroundColor,
          image: style.backgroundImage,
          blur: style.backdropFilter,
          top: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          bottom: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`,
          left: `${style.borderLeftWidth} ${style.borderLeftStyle} ${style.borderLeftColor}`,
        };
      });
    const HAIRLINE = '1px solid rgba(20, 19, 17, 0.14)';
    const CARBON_RULE = '1px solid rgb(20, 19, 17)';

    // Spec ledger: three flush columns between two hairlines, split by vertical hairlines.
    const specs = page.locator('.spec-strip__item');
    await expect(specs).toHaveCount(3);
    for (const [i, item] of (await specs.all()).entries()) {
      const cell = await look(item);
      expect(cell).toMatchObject({ radius: '0px', surface: 'rgba(0, 0, 0, 0)', image: 'none', blur: 'none', top: HAIRLINE, bottom: HAIRLINE });
      expect(cell.left).toBe(i === 0 ? '0px none rgb(20, 19, 17)' : HAIRLINE);
    }
    await expect(page.locator('.spec-strip__item.bento, .entry-card.bento, .modules__foot.bento, .lab-panel.bento')).toHaveCount(0);

    // Section heads: calm and centred, the lede under the title, no rule beneath.
    const head = page.locator('#lab-title').locator('xpath=..');
    expect((await look(head)).bottom).toBe('0px none rgb(20, 19, 17)');
    await expect(head).toHaveCSS('text-align', 'center');
    const [titleBox, ledeBox] = await Promise.all([page.locator('#lab-title').boundingBox(), head.locator('.section-head__lede').boundingBox()]);
    expect(ledeBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
    expect(Math.abs(ledeBox.x + ledeBox.width / 2 - (titleBox.x + titleBox.width / 2))).toBeLessThanOrEqual(1);

    // Surface lab on its travertine band: the umber-plaster bench and its paper
    // specification sheet share one square frame.
    const rig = await look(page.locator('.lab__rig'));
    expect(rig).toMatchObject({ radius: '0px', top: '1px solid rgba(20, 19, 17, 0.16)' });
    expect(await look(page.getByTestId('lab-bench'))).toMatchObject({ radius: '0px', surface: 'rgb(44, 40, 36)' });
    expect(await look(page.getByTestId('lab-panel'))).toMatchObject({ radius: '0px', surface: 'rgb(250, 249, 246)', blur: 'none' });
    const [benchBox, panelBox] = await Promise.all([page.getByTestId('lab-bench').boundingBox(), page.getByTestId('lab-panel').boundingBox()]);
    expect(Math.abs(benchBox.x + benchBox.width - panelBox.x)).toBeLessThanOrEqual(1);

    // Core modules close on a carbon rule.
    expect(await look(page.locator('.modules__foot'))).toMatchObject({ radius: '0px', surface: 'rgba(0, 0, 0, 0)', top: CARBON_RULE });
    // Workspaces: three square portrait cards side by side, captions straight on the paper.
    const cards = page.locator('.entry-card');
    await expect(cards).toHaveCount(3);
    for (const card of await cards.all()) {
      expect(await look(card)).toMatchObject({ radius: '0px', surface: 'rgba(0, 0, 0, 0)', image: 'none', blur: 'none' });
    }
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - boxes[0].width)).toBeLessThanOrEqual(1);
    }
    expect(boxes[1].x).toBeGreaterThan(boxes[0].x + boxes[0].width - 1);
    expect(boxes[2].x).toBeGreaterThan(boxes[1].x + boxes[1].width - 1);
  });

  test('a fresh document load starts at the top instead of inheriting another page scroll', async ({
    page,
  }) => {
    await page.goto('/catalog');
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

    await page.goto('/checkout');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project Quote');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
  });

  test('the retired 2D Wall Studio addresses land in the 3D Room Planner', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    for (const path of ['/studio-2d', '/studio']) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === '/room-3d');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
      await expect(page).toHaveTitle('Room Planner - Lumen');
    }
    expect(errors).toEqual([]);
  });

  test('navbar utility keys are borderless small capitals on one row, flush right, with no display mode toggle', async ({
    page,
  }) => {
    for (const width of [1280, 1600, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const navbar = page.locator('header.navbar');
      // A flush alabaster gallery bar over one hairline.
      const bar = await navbar.evaluate((el) => {
        const style = getComputedStyle(el);
        return { surface: style.backgroundColor, rule: `${style.borderBottomWidth} ${style.borderBottomStyle} ${style.borderBottomColor}`, blur: style.backdropFilter };
      });
      expect(bar).toEqual({ surface: 'rgba(250, 249, 246, 0.92)', rule: '1px solid rgba(20, 19, 17, 0.12)', blur: 'blur(12px)' });
      // Search, Sign In and Cart only: Visual | Specs lives in the 3D Room Planner.
      await expect(navbar.getByTestId('mode-switch')).toHaveCount(0);
      const pills = [navbar.getByTestId('command-palette-trigger'), navbar.getByTestId('sign-in'), navbar.getByRole('button', { name: 'Cart (0)' })];
      const looks = [];
      for (const pill of pills) {
        looks.push(
          await pill.evaluate((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return {
              radius: style.borderTopLeftRadius,
              edge: style.borderTopWidth,
              edgeColor: style.borderTopColor,
              surface: style.backgroundColor,
              shadow: style.boxShadow,
              height: box.height,
              mid: box.top + box.height / 2,
              left: box.left,
              right: box.right,
            };
          }),
        );
      }
      // Sign In and Cart: no pill, no border, no fill, carbon ink.
      for (const look of looks.slice(1)) {
        expect(look, `${width}px`).toMatchObject({ radius: '0px', edge: '0px', surface: 'rgba(0, 0, 0, 0)', shadow: 'none', height: 32 });
      }
      for (const look of looks) {
        expect(Math.abs(look.mid - looks[0].mid), `${width}px`).toBeLessThanOrEqual(0.5);
      }
      // Left to right in source order, the cart closing the row on the frame's right inset.
      expect(looks[0].right).toBeLessThan(looks[1].left);
      expect(looks[1].right).toBeLessThan(looks[2].left);
      const frameRight = await navbar.locator('.navbar__inner').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.right - Number.parseFloat(getComputedStyle(el).paddingRight);
      });
      expect(Math.abs(looks[2].right - frameRight), `${width}px`).toBeLessThanOrEqual(1);
      // Small tracked capitals in the sans face (0.75rem, 0.08em), never mono.
      for (const pill of pills.slice(1)) {
        await expect(pill).toHaveCSS('border-top-width', '0px');
        await expect(pill).toHaveCSS('text-transform', 'uppercase');
        await expect(pill).toHaveCSS('font-size', '12px');
        await expect(pill).toHaveCSS('letter-spacing', '0.96px');
        await expect(pill).toHaveCSS('color', 'rgb(20, 19, 17)');
        await expect(pill).toHaveCSS('font-family', /Inter Tight/);
      }
    }

  });

  test('cart trigger opens a modal drawer that closes on Escape and returns focus', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Cart (0)' });
    await trigger.click();

    const drawer = page.getByRole('dialog', { name: 'Cart' });
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('shell never overflows horizontally from phone to wide desktop', async ({ page }) => {
    for (const width of [360, 768, 1024, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      for (const view of VIEWS) {
        await page.goto(view.path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${view.path} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('structural grid stays a 2% drafting-film texture on the storefront, sections get 160px of air', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const column = page.locator('.structural-grid__col').first();
    await expect(column).toHaveCSS('border-left-color', 'rgba(20, 19, 17, 0.02)');
    // 12.5vw at 1280 wide.
    await expect(page.getByTestId('core-modules')).toHaveCSS('padding-top', '160px');
    await expect(page.getByTestId('surface-lab')).toHaveCSS('padding-top', '160px');

    // Specs is a planner preference: the drafting grid comes forward inside
    // the 3D Room Planner, and the storefront stays in Visual whatever is stored.
    await page.goto('/room-3d');
    await page.getByTestId('studio-header').getByRole('button', { name: /technical/i }).click();
    await expect(column).toHaveCSS('border-left-color', 'rgba(20, 19, 17, 0.06)');
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Catalog' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'architectural');
    await expect(column).toHaveCSS('border-left-color', 'rgba(20, 19, 17, 0.02)');
  });

  test('display mode switch persists through validated storage and rejects tampered values', async ({
    page,
  }) => {
    await page.goto('/room-3d');
    const html = page.locator('html');
    const header = page.getByTestId('studio-header');
    await expect(html).toHaveAttribute('data-mode', 'architectural');

    await header.getByRole('button', { name: /technical/i }).click();
    await expect(html).toHaveAttribute('data-mode', 'technical');
    await expect(header.getByRole('button', { name: /technical/i })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(html).toHaveAttribute('data-mode', 'technical');

    // The storefront always reads in Visual, even with Specs stored.
    for (const path of ['/', '/catalog', '/checkout']) {
      await page.goto(path);
      await expect(html, path).toHaveAttribute('data-mode', 'architectural');
    }
    await page.goto('/room-3d');
    await expect(html).toHaveAttribute('data-mode', 'technical');

    await page.evaluate(() => {
      localStorage.setItem('lumen:display-mode', '"<img src=x onerror=alert(1)>"');
    });
    await page.reload();
    await expect(html).toHaveAttribute('data-mode', 'architectural');

    await page.evaluate(() => {
      localStorage.setItem('lumen:display-mode', '{"__proto__":{"polluted":true}}');
    });
    await page.reload();
    await expect(html).toHaveAttribute('data-mode', 'architectural');
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
  });
});

test.describe('safeJsonParse', () => {
  test('strips prototype-pollution keys at every depth without touching Object.prototype', () => {
    const payload =
      '{"__proto__":{"polluted":true},' +
      '"constructor":{"prototype":{"polluted":true}},' +
      '"nested":{"__proto__":{"polluted":true},"ok":1},' +
      '"list":[{"prototype":{"polluted":true},"keep":2}]}';

    const result = safeJsonParse(payload);

    expect(result).toEqual({ nested: { ok: 1 }, list: [{ keep: 2 }] });
    expect(Object.hasOwn(result, '__proto__')).toBe(false);
    expect(Object.hasOwn(result, 'constructor')).toBe(false);
    expect(Object.hasOwn(result.nested, '__proto__')).toBe(false);
    expect(Object.hasOwn(result.list[0], 'prototype')).toBe(false);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);

    const merged = { ...result, ...result.nested };
    expect(merged.polluted).toBeUndefined();
    expect({}.polluted).toBeUndefined();
  });

  test('returns the fallback for malformed, non-string, oversized or over-deep input', () => {
    expect(safeJsonParse('{"unterminated":', { fallback: 'bad' })).toBe('bad');
    expect(safeJsonParse(42)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse('')).toBeNull();
    expect(safeJsonParse(JSON.stringify('x'.repeat(64)), { maxLength: 32, fallback: 'big' })).toBe('big');

    const deep = '['.repeat(40) + ']'.repeat(40);
    expect(safeJsonParse(deep, { fallback: 'deep' })).toBe('deep');
    expect(safeJsonParse('[[["ok"]]]', { maxDepth: 3 })).toEqual([[['ok']]]);
    expect(safeJsonParse('[[["ok"]]]', { maxDepth: 2, fallback: 'deep' })).toBe('deep');
  });

  test('passes clean payloads through unchanged', () => {
    const clean = { id: 'p-01', finish: 'walnut', output: 640, dims: [1200, 40, 40], dimmable: true };
    expect(safeJsonParse(JSON.stringify(clean))).toEqual(clean);
  });
});
