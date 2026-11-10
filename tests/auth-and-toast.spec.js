import { expect, test } from '@playwright/test';
import { PROJECTS_STORAGE_KEY, QUOTES_STORAGE_KEY } from '../src/api/client.js';
import { SESSION_STORAGE_KEY } from '../src/lib/auth.js';
import { formatUsd, padIndex } from '../src/lib/format.js';
import { layoutFromPreset, serializeLayout, summarizeWall, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const QUOTES_KEY = `lumen:${QUOTES_STORAGE_KEY}`;
const STORED_QUOTE = {
  ref: 'LMN-R-7F3A91C2',
  quoteId: 'LMN-Q-20261021-4K9Q2T',
  submittedAt: '2026-10-21T09:30:00.000Z',
  reference: 'Atelier Vesterbro, reading wall',
  preparedFor: 'Studio Halvorsen',
  currency: 'USD',
  grossMinor: 179800,
  lines: 6,
  loadW: 108,
  status: 'Pending review',
};
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };
// Test value for the local mock form only; the app discards it on submit.
const TEST_PASSWORD = 'nordic-test-0042';

function navbar(page) {
  return page.getByRole('banner');
}

function readSession(page) {
  return page.evaluate((key) => localStorage.getItem(key), SESSION_KEY);
}

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('authentication shell', () => {
  test('sign in through the modal updates the session, swaps the navbar control and opens /account', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);

    // Protected route: signed out, /account lands on the overview.
    await page.goto('/account');
    await expect(page).toHaveURL((url) => url.pathname === '/');
    expect(await readSession(page)).toBeNull();

    const signIn = navbar(page).getByRole('button', { name: 'Sign In' });
    await expect(navbar(page).getByTestId('account-link')).toHaveCount(0);

    // Escape closes the dialog and hands focus back to the trigger.
    await signIn.click();
    const dialog = page.getByRole('dialog', { name: 'Sign in' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(signIn).toBeFocused();

    // Invalid input stays local and explains itself.
    await signIn.click();
    await dialog.getByRole('button', { name: 'Sign In' }).click();
    await expect(dialog.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Email')).toBeFocused();
    await dialog.getByLabel('Email').fill('guest@lumen');
    await dialog.getByLabel('Password').fill('short');
    await dialog.getByRole('button', { name: 'Sign In' }).click();
    await expect(dialog).toBeVisible();
    expect(await readSession(page)).toBeNull();

    await dialog.getByLabel('Email').fill('  Guest@Lumen.com ');
    await dialog.getByLabel('Password').fill(TEST_PASSWORD);
    await dialog.getByRole('button', { name: 'Sign In' }).click();

    // AuthContext now holds the guest user: dialog closed, navbar swapped, session stored without the password.
    await expect(dialog).toBeHidden();
    const account = navbar(page).getByRole('link', { name: 'Account' });
    await expect(account).toBeVisible();
    await expect(account).toBeFocused();
    await expect(navbar(page).getByRole('button', { name: 'Sign In' })).toHaveCount(0);
    const stored = await readSession(page);
    expect(JSON.parse(stored)).toEqual(GUEST);
    expect(stored).not.toContain(TEST_PASSWORD);
    await expect(page.getByTestId('toast-message')).toHaveText('Signed in as guest@lumen.com.');

    await account.click();
    await expect(page).toHaveURL((url) => url.pathname === '/account');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Account');
    await expect(page.getByTestId('account-user')).toContainText('Studio Guest');
    await expect(page.getByTestId('account-user')).toContainText('guest@lumen.com');
    await expect(account).toHaveAttribute('aria-current', 'page');
    // Polled: the inversion eases over 120 ms. Flat surface, no glow.
    await expect
      .poll(() =>
        account.evaluate((el) => {
          const style = getComputedStyle(el);
          return { background: style.backgroundColor, color: style.color, shadow: style.boxShadow };
        }),
      )
      .toEqual({ background: 'rgb(255, 255, 255)', color: 'rgb(11, 11, 10)', shadow: 'none' });

    // The session survives a reload.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Account');

    // Signing out drops the session and the guard sends the visitor home.
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL((url) => url.pathname === '/');
    await expect(navbar(page).getByRole('button', { name: 'Sign In' })).toBeVisible();
    expect(await readSession(page)).toBeNull();

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a tampered session payload is treated as signed out', async ({ page }) => {
    await page.goto('/');
    const payloads = [
      '{"name":"Studio Guest","email":"<img src=x onerror=alert(1)>"}',
      '{"__proto__":{"admin":true},"name":"Studio Guest"}',
      '["guest@lumen.com"]',
      '{"name":"Studio Guest","email":"guest@lumen.com"',
    ];
    for (const raw of payloads) {
      await seed(page, [[SESSION_KEY, raw]]);
      await page.goto('/account');
      await expect(page, raw).toHaveURL((url) => url.pathname === '/');
      await expect(navbar(page).getByRole('button', { name: 'Sign In' })).toBeVisible();
      expect(await readSession(page), raw).toBeNull();
    }
    expect(await page.evaluate(() => ({}).admin)).toBeUndefined();
  });
});

test.describe('account dashboard', () => {
  test('lists the cloud-saved wall next to submitted quotes and opens its saved revision', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const layout = layoutFromPreset('nordic-reading-wall');
    const summary = summarizeWall(layout);
    const stored = { kind: 'wall', revision: 2, savedAt: '2026-11-02T08:15:00.000Z', data: serializeLayout(layout) };

    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [PROJECTS_KEY, JSON.stringify([stored])],
      [QUOTES_KEY, JSON.stringify([STORED_QUOTE])],
      // An empty local draft: opening the card must check the saved revision out over it.
      [WALL_KEY, JSON.stringify({ ...serializeLayout(layout), items: [] })],
    ]);
    await page.goto('/account');
    await expect(page.getByRole('heading', { level: 2, name: 'Saved Spatial Projects' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Order History' })).toBeVisible();
    await expect(page.getByTestId('projects-loading')).toBeVisible();
    await expect(page.getByTestId('account-fact-sync')).toHaveText('Syncing');

    const projects = page.getByTestId('saved-project');
    await expect(projects).toHaveCount(1);
    await expect(page.getByTestId('projects-loading')).toHaveCount(0);
    await expect(page.getByTestId('account-fact-sync')).toHaveText('Up to date');
    await expect(page.getByTestId('account-fact-projects')).toHaveText('01');
    const wall = page.locator('[data-testid="saved-project"][data-project="wall"]');
    await expect(wall.getByRole('heading', { level: 3 })).toHaveText('Wall A');
    await expect(wall.getByTestId('saved-project-modules')).toHaveText(padIndex(layout.items.length));
    await expect(wall.getByTestId('saved-project-price')).toHaveText(formatUsd(summary.priceUsd));
    await expect(wall.getByRole('img')).toHaveAttribute('aria-label', `Wall A elevation, ${layout.items.length} modules`);
    await expect(wall.locator('.project-card__module')).toHaveCount(layout.items.length);
    await expect(wall.getByTestId('saved-project-revision')).toHaveText('Rev 02');

    const orders = page.getByTestId('order-row');
    await expect(orders).toHaveCount(1);
    await expect(orders.first()).toContainText(STORED_QUOTE.quoteId);
    await expect(orders.first()).toContainText(STORED_QUOTE.reference);
    await expect(orders.first().getByTestId('order-gross')).toHaveText('USD 1,798.00');
    await expect(orders.first()).toContainText('Requisition LMN-R-7F3A91C2');

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }

    await wall.getByRole('link', { name: 'Open in Wall Studio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    await expect(page.getByTestId('wall-module')).toHaveCount(layout.items.length);
    expect(errors).toEqual([]);
  });

  test('shows hairline empty states when nothing is saved to the cloud, even with a local draft', async ({ page }) => {
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [WALL_KEY, JSON.stringify(serializeLayout(layoutFromPreset('nordic-reading-wall')))],
    ]);
    await page.goto('/account');
    const empty = page.getByTestId('saved-projects-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No spatial projects yet.');
    await expect(page.getByTestId('saved-project')).toHaveCount(0);
    await expect(page.getByTestId('order-history-empty')).toContainText('No quotes submitted yet.');
    await expect(page.getByTestId('order-row')).toHaveCount(0);
    await expect(page.getByTestId('account-fact-projects')).toHaveText('00');

    await empty.getByRole('link', { name: 'Start 2D Wall Studio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
  });

  test('profile, projects and quotes sit in bento tiles with Sign Out anchored top right of the profile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await seed(page, [[SESSION_KEY, JSON.stringify(GUEST)]]);
    await page.goto('/account');

    const profile = page.getByTestId('account-profile');
    const tiles = [profile, page.getByTestId('account-projects'), page.getByTestId('account-orders')];
    for (const tile of tiles) {
      await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
      const look = await tile.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          radius: style.borderTopLeftRadius,
          edge: style.borderTopColor,
          width: style.borderTopWidth,
          blur: style.backdropFilter,
        };
      });
      expect(look).toEqual({ radius: '16px', edge: 'rgba(255, 255, 255, 0.06)', width: '1px', blur: 'blur(16px)' });
    }

    // Profile spans the frame; projects and quotes share the row below it.
    const [profileBox, projectsBox, ordersBox] = await Promise.all(tiles.map((tile) => tile.boundingBox()));
    expect(Math.abs(profileBox.x - projectsBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(profileBox.x + profileBox.width - (ordersBox.x + ordersBox.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(projectsBox.y - ordersBox.y)).toBeLessThanOrEqual(1);
    expect(projectsBox.y).toBeGreaterThan(profileBox.y + profileBox.height);

    // Sign Out lives in the profile tile, on its top-right padding corner.
    const signOut = profile.getByTestId('sign-out');
    await expect(signOut).toBeVisible();
    const corner = await profile.evaluate((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        top: box.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop),
        right: box.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight),
      };
    });
    const signOutBox = await signOut.boundingBox();
    expect(Math.abs(signOutBox.x + signOutBox.width - corner.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(signOutBox.y - corner.top)).toBeLessThanOrEqual(1);
    await expect(profile.getByRole('heading', { level: 2 })).toHaveText(GUEST.name);
    await expect(page.getByTestId('account-user')).toContainText(GUEST.email);

    // A faint oak-amber wash falls in from the top right, fixed behind the content.
    const atmosphere = await page.getByTestId('account-page').evaluate((el) => {
      const glow = getComputedStyle(el, '::before');
      return { position: glow.position, image: glow.backgroundImage, events: glow.pointerEvents };
    });
    expect(atmosphere.position).toBe('fixed');
    expect(atmosphere.events).toBe('none');
    expect(atmosphere.image).toBe('radial-gradient(circle at 100% 0%, rgba(232, 146, 58, 0.05), rgba(0, 0, 0, 0) 40%)');

    // Phone width: the action drops under the identity and nothing overflows.
    await page.setViewportSize({ width: 360, height: 800 });
    const narrow = await signOut.boundingBox();
    const identity = await page.getByTestId('account-user').boundingBox();
    expect(narrow.y).toBeGreaterThanOrEqual(identity.y + identity.height);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('toast notifications', () => {
  test('a success toast floats in as a glass pill, bottom centre above every layer, and unmounts after four seconds', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/catalog');

    const card = page.getByRole('article', { name: 'Floating Shelf 110' });
    await card.getByRole('button', { name: /add to cart/i }).click();
    const shownAt = Date.now();

    const region = page.getByRole('region', { name: 'Notifications' });
    const toast = region.getByTestId('toast');
    await expect(toast).toHaveCount(1);
    await expect(toast).toHaveAttribute('data-tone', 'success');
    await expect(toast.getByTestId('toast-message')).toHaveText('Floating Shelf 110, Walnut added to cart.');
    await expect(region.getByRole('status')).toHaveAttribute('aria-live', 'polite');

    const placement = await region.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const root = document.documentElement;
      return {
        position: style.position,
        zIndex: style.zIndex,
        bottom: Math.round(root.clientHeight - rect.bottom),
      };
    });
    expect(placement).toEqual({ position: 'fixed', zIndex: '100', bottom: 24 });
    // Scaling from the centre during entry never moves the pill off the axis.
    const offAxis = await toast.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2);
    });
    expect(offAxis).toBeLessThan(1);

    // Translucent pill on a backdrop blur. Depth is a dark ambient shadow and a
    // hairline top highlight; no layer carries a coloured glow.
    const glass = await toast.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        animation: style.animationName,
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        backdrop: style.backdropFilter,
        layers: style.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim()),
      };
    });
    expect(glass.animation).toBe('toast-in');
    expect(glass.radius).toBe('999px');
    expect(glass.background).toBe('rgba(30, 29, 27, 0.56)');
    expect(glass.backdrop).toContain('blur(28px)');
    expect(glass.layers).toHaveLength(2);
    for (const layer of glass.layers) {
      expect(layer.endsWith('inset') || layer.startsWith('rgba(0, 0, 0,')).toBe(true);
    }

    // Still up at three seconds, unmounted shortly after the four-second mark.
    await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - shownAt)));
    expect(await toast.count()).toBe(1);
    await expect(toast).toHaveCount(0, { timeout: 3000 });
    expect(Date.now() - shownAt).toBeGreaterThan(3500);
    expect(errors).toEqual([]);
  });

  test('toasts stack, dismiss on demand and never block the controls underneath', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/catalog');
    for (const name of ['Floating Shelf 110', 'Modular Cube 36', 'Compact Sideboard 75']) {
      await page.getByRole('article', { name }).getByRole('button', { name: /add to cart/i }).click();
    }
    const toasts = page.getByTestId('toast');
    await expect(toasts).toHaveCount(3);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    // Toast bodies let the pointer through; only the dismiss key is a target.
    const pointer = await toasts.first().evaluate((el) => ({
      body: getComputedStyle(el).pointerEvents,
      dismiss: getComputedStyle(el.querySelector('button')).pointerEvents,
    }));
    expect(pointer.body).toBe('none');
    expect(pointer.dismiss).toBe('auto');

    await toasts.first().getByRole('button', { name: 'Dismiss notification' }).click();
    await expect(toasts).toHaveCount(2);

    // Planner save actions report through the same stack.
    await page.goto('/room-3d');
    await page.getByTestId('import-from-wall-studio').click();
    await page.getByTestId('export-to-wall-studio').click();
    await expect(page.getByTestId('toast-message').last()).toHaveText('Room saved to Wall Studio: 9 modules.');
  });
});
