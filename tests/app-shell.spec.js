import { expect, test } from '@playwright/test';
import { safeJsonParse } from '../src/security/sanitize.js';

const VIEWS = [
  { path: '/', heading: /light and storage on one modular spine/i },
  { path: '/catalog', heading: 'Catalog' },
  { path: '/room-3d', heading: 'Room Planner' },
  { path: '/studio-2d', heading: 'Wall Studio' },
];

const NAV_SEQUENCE = [
  { link: /catalog/i, path: '/catalog', heading: 'Catalog', title: 'Catalog - Lumen' },
  { link: /3d room/i, path: '/room-3d', heading: 'Room Planner', title: 'Room Planner - Lumen' },
  { link: /wall studio/i, path: '/studio-2d', heading: 'Wall Studio', title: 'Wall Studio - Lumen' },
  {
    link: /overview/i,
    path: '/',
    heading: /light and storage/i,
    title: 'Lumen - Architectural Lighting & Modular Systems',
  },
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

    for (const step of NAV_SEQUENCE) {
      const link = nav.getByRole('link', { name: step.link });
      await link.click();

      await expect(page).toHaveURL((url) => url.pathname === step.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(step.heading);
      await expect(link).toHaveAttribute('aria-current', 'page');
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

  test('a fresh document load starts at the top instead of inheriting another page scroll', async ({
    page,
  }) => {
    await page.goto('/studio-2d');
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);

    await page.goto('/catalog');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(400);
  });

  test('bag trigger opens a modal drawer that closes on Escape and returns focus', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Bag (0)' });
    await trigger.click();

    const drawer = page.getByRole('dialog', { name: 'Bag' });
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

  test('structural grid stays a 1% subliminal texture in architectural mode, sections get 160px of air', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const column = page.locator('.structural-grid__col').first();
    await expect(column).toHaveCSS('border-left-color', 'rgba(242, 238, 231, 0.01)');
    // 12.5vw at 1280 wide.
    await expect(page.getByTestId('core-modules')).toHaveCSS('padding-top', '160px');
    await expect(page.getByTestId('surface-lab')).toHaveCSS('padding-top', '160px');

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Technical' }).click();
    await expect(column).toHaveCSS('border-left-color', 'rgba(232, 146, 58, 0.07)');
  });

  test('display mode switch persists through validated storage and rejects tampered values', async ({
    page,
  }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-mode', 'architectural');

    await page.getByRole('button', { name: /technical/i }).click();
    await expect(html).toHaveAttribute('data-mode', 'technical');
    await expect(page.getByRole('button', { name: /technical/i })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
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
