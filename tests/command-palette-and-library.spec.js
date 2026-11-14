import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { MAX_STORED_PROJECTS, PROJECTS_STORAGE_KEY } from '../src/api/client.js';
import { PRODUCTS } from '../src/data/products.js';
import { SESSION_STORAGE_KEY } from '../src/lib/auth.js';
import { formatUsd } from '../src/lib/format.js';
import { buildRoomObj } from '../src/lib/obj-export.js';
import { projectIdFor, sanitizeProjectName } from '../src/lib/project-library.js';
import {
  createRoomState,
  furnitureLayout,
  importFromWallStudio,
  ROOM_STORAGE_KEY,
  serializeRoomState,
} from '../src/lib/room-3d.js';
import { layoutFromPreset, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { holdProjectSaves } from './support/cloud-gates.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const BAG_KEY = 'lumen:lumen_bag_v1';
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };
const WALL = layoutFromPreset('nordic-reading-wall');
const BASE_ROOM = importFromWallStudio(createRoomState()).state;
const ROOM = { ...BASE_ROOM, room: { ...BASE_ROOM.room, furniture: 'sofa-200' } };
const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|RoomCanvas)-[\w-]+\.js$/;

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function readJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

function palette(page) {
  return page.getByRole('dialog', { name: 'Command palette' });
}

function lastToast(page) {
  return page.getByTestId('toast-message').last();
}

/**
 * Saves under `name`. The request is held in flight until the pending state
 * has been read, so a loaded runner cannot finish the 500 ms round trip
 * before the first check lands.
 */
async function saveNamed(page, testId, name) {
  const input = page.getByTestId('project-name-input');
  await input.fill(name);
  const save = page.getByTestId(testId);
  const release = await holdProjectSaves(page);
  await save.click();
  await expect(save).toHaveAttribute('data-state', 'saving');
  release();
  await expect(save).toHaveAttribute('data-state', 'saved');
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('command palette', () => {
  test('opens on Ctrl+K and from the navbar key, filters modules and opens one with Enter', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.keyboard.press('Control+k');
    const dialog = palette(page);
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-testid', 'command-palette');
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Search lighting, furniture, or pages...');
    // An opaque sheet: no frosted glass behind it.
    await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');

    const items = page.getByTestId('command-palette-item');
    await expect(items.and(page.locator('[data-group="workspaces"]'))).toHaveText([
      /Overview/,
      /Catalog/,
      /3D Room Planner/,
      /Project Quote/,
      /Account/,
    ]);
    await expect(items.and(page.locator('[data-group="modules"]'))).toHaveCount(PRODUCTS.length);
    // Visual | Specs is a planner setting: the storefront palette offers no mode command.
    await expect(items.and(page.locator('[data-group="commands"]'))).toHaveText([
      /Set Currency: USD/,
      /Set Currency: EUR/,
      /Set Currency: HUF/,
      /Open Cart Drawer/,
    ]);

    // Ctrl+K toggles closed; Escape closes and hands focus back to the pill.
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeHidden();
    const trigger = page.getByTestId('command-palette-trigger');
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Meta+k');
    await expect(dialog).toBeVisible();
    const lightbar = PRODUCTS.find((product) => product.id === 'linear-lightbar-60');
    await input.fill('lightbar');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(lightbar.name);
    await expect(items.first()).toContainText(lightbar.sku);
    await expect(items.first()).toContainText(`${lightbar.watts} W / ${formatUsd(lightbar.priceUsd)}`);
    await expect(items.first()).toHaveAttribute('aria-selected', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', await items.first().getAttribute('id'));

    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL((url) => url.pathname === `/catalog/${lightbar.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(lightbar.name);

    await trigger.click();
    await input.fill('qqzz-no-such-part');
    await expect(items).toHaveCount(0);
    await expect(page.getByTestId('command-palette-empty')).toBeVisible();

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the spotlight shows names, plain subtitles and price tags in Visual mode and its codes in Specs', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = palette(page);
    await expect(dialog).toHaveAttribute('data-mode', 'architectural');
    // A crisp white index sheet: a carbon hairline frame, square corners, a carbon
    // head rule along the top and a 540 px column.
    const look = await dialog.evaluate((el) => {
      const style = getComputedStyle(el);
      const head = getComputedStyle(el, '::before');
      return {
        background: style.backgroundColor,
        border: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
        width: el.offsetWidth,
        headRule: `${head.height} ${head.backgroundColor}`,
      };
    });
    expect(look).toEqual({
      background: 'rgb(250, 248, 244)',
      border: 'rgba(20, 19, 17, 0.16)',
      radius: '0px',
      shadow: 'none',
      width: 540,
      headRule: '2px rgb(20, 19, 17)',
    });

    const pendant = PRODUCTS.find((product) => product.id === 'linear-pendant-150');
    await page.getByTestId('command-palette-input').fill('pendant');
    const row = page.getByTestId('command-palette-item').filter({ hasText: pendant.name });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.palette__label')).toHaveText('Linear Suspension Pendant 150');
    await expect(row.locator('.palette__summary')).toHaveText('Lighting - 150 x 12 cm');
    await expect(row.locator('.palette__summary')).toBeVisible();
    const price = row.getByTestId('command-palette-price');
    await expect(price).toBeVisible();
    await expect(price).toHaveText(`${pendant.watts} W / ${formatUsd(pendant.priceUsd)}`);
    expect(await price.evaluate((el) => el.innerText.trim())).toBe('$420');
    // Square geometry inside the panel: the row and the price tag, no pills.
    await expect(row).toHaveCSS('border-top-left-radius', '0px');
    await expect(price).toHaveCSS('border-top-left-radius', '0px');
    // The SKU and the wattage stay in the DOM for search, out of sight in Visual mode.
    const code = row.getByTestId('command-palette-code');
    await expect(code).toHaveText('LMN-PD-150');
    await expect(code).toBeHidden();
    await expect(row).toContainText('LMN-PD-150');
    // Group labels in plain language, no result counters, one calm line of keyboard help.
    await page.getByTestId('command-palette-input').fill('');
    await expect(dialog.locator('.palette__group-label > span:first-child')).toHaveText(['Pages', 'Products', 'Actions']);
    await expect(dialog.locator('.palette__group-count').first()).toBeHidden();
    await expect(page.getByTestId('command-palette-footer')).toHaveText(/^Up\/Down to navigate - Enter to open - Esc to close/);
    await expect(page.getByTestId('command-palette-footer').locator('.palette__hint')).toBeVisible();
    await expect(page.getByTestId('command-palette-footer').locator('kbd')).toHaveCount(0);
    await expect(page.getByTestId('command-palette-count')).toHaveText(`${PRODUCTS.length + 9} results`);
    await page.keyboard.press('Escape');

    // Inside the 3D Room Planner the palette gains the mode command, and Specs
    // brings the codes and the wattage back.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: '3D Room' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette-count')).toHaveText(`${PRODUCTS.length + 10} results`);
    await page.getByTestId('command-palette-input').fill('technical');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'technical');
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-palette-input').fill('pendant');
    await expect(row.getByTestId('command-palette-code')).toBeVisible();
    expect(await row.getByTestId('command-palette-price').evaluate((el) => el.innerText.trim())).toBe(
      `${pendant.watts} W / ${formatUsd(pendant.priceUsd)}`,
    );
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('runs mode and currency commands from the keyboard', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [[BAG_KEY, JSON.stringify([{ id: 'modular-cube-36', finish: 'oak', qty: 2 }])]]);
    await page.goto('/checkout');
    await expect(page.getByTestId('quote-currency')).toHaveText('USD / Base currency');

    // On the storefront there is no mode command to find.
    await page.keyboard.press('Control+k');
    const input = page.getByTestId('command-palette-input');
    await input.fill('specs mode');
    const items = page.getByTestId('command-palette-item');
    await expect(items).toHaveCount(0);

    // Arrow keys move through the matches and wrap at both ends.
    await input.fill('currency');
    await expect(items).toHaveText([/Set Currency: USD/, /Set Currency: EUR/, /Set Currency: HUF/]);
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(0).locator('[data-badge]')).toHaveText('Current');
    await page.keyboard.press('ArrowUp');
    await expect(items.nth(2)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Enter');

    // The open checkout re-prices live through the shared currency store.
    await expect(page.getByTestId('quote-currency')).toHaveText('EUR / 1 USD = 0.92 EUR');
    await expect(page.getByTestId('currency-EUR')).toHaveAttribute('aria-pressed', 'true');
    await expect(lastToast(page)).toHaveText('Quote currency set to EUR, Euro.');
    expect(await readJson(page, 'lumen:lumen_currency_v1')).toBe('EUR');

    // Inside the planner the mode command runs from the keyboard.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: '3D Room' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await page.keyboard.press('Control+k');
    await input.fill('technical');
    await expect(items.first()).toHaveText(/Switch to Specs Mode/);
    await page.keyboard.press('Enter');
    await expect(palette(page)).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'technical');
    await expect(lastToast(page)).toHaveText('Display mode: Specs.');
    expect(await readJson(page, 'lumen:display-mode')).toBe('technical');

    await page.keyboard.press('Control+k');
    await input.fill('mode');
    await expect(items.first()).toHaveText(/Switch to Visual Mode/);
    await input.fill('cart');
    await page.keyboard.press('Enter');
    const cart = page.getByRole('dialog', { name: 'Cart' });
    await expect(cart).toBeVisible();
    await expect(palette(page)).toHaveCount(0);
    // The drawer it opens is the editorial sheet: a plain title, no second bag icon, square keys only.
    await expect(cart.getByRole('heading', { level: 2 })).toHaveText('Cart');
    await expect(cart.getByTestId('bag-glyph')).toHaveCount(0);
    await expect(cart.getByRole('button', { name: 'Close' })).toHaveCSS('border-top-left-radius', '0px');
    const radii = await cart.evaluate((el) => [...el.querySelectorAll('a, button')].map((key) => parseFloat(getComputedStyle(key).borderTopLeftRadius)));
    expect(Math.max(...radii)).toBe(0);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the palette key is a borderless 32px typographic key and the row never overflows', async ({ page }) => {
    for (const width of [360, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const trigger = page.getByTestId('command-palette-trigger');
      const look = await trigger.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          height: el.getBoundingClientRect().height,
          radius: style.borderTopLeftRadius,
          surface: style.backgroundColor,
          shadow: style.boxShadow,
        };
      });
      expect(look, `${width}px`).toEqual({ height: 32, radius: '0px', surface: 'rgba(0, 0, 0, 0)', shadow: 'none' });
      await expect(trigger).toHaveCSS('border-top-width', '0px');
      await expect(trigger).toHaveAccessibleName('Search commands');
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);

      const controls = await page.locator('.navbar__controls').boundingBox();
      expect(controls.x + controls.width, `${width}px controls`).toBeLessThanOrEqual(width);
    }

    await page.setViewportSize({ width: 360, height: 800 });
    await page.getByTestId('command-palette-trigger').click();
    // Polled: the panel resolves from scale 1.04 to 1 on entry.
    await expect.poll(async () => (await palette(page).boundingBox()).x).toBeGreaterThanOrEqual(15);
    const box = await palette(page).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(345);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('navbar intent warms planner chunks while a cold overview loads none', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);

    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('link', { name: /3d room/i }).hover();
    await expect.poll(() => scripts.some((path) => /\/RoomPlannerPage-/.test(path))).toBe(true);
    await expect.poll(() => scripts.some((path) => /\/RoomCanvas-/.test(path))).toBe(true);
    expect(page.url()).toMatch(/\/$/);

    await expect(nav.getByRole('link', { name: /wall studio/i })).toHaveCount(0);

    // A second hover reuses the warmed chunk, and 3D Room opens the planner on it.
    const before = scripts.length;
    await nav.getByRole('link', { name: /3d room/i }).hover();
    await nav.getByRole('link', { name: /3d room/i }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    expect(scripts.slice(before).filter((path) => /\/RoomPlannerPage-/.test(path))).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('named cloud project library', () => {
  test('project ids are deterministic, single-token and default to the legacy slot', () => {
    expect(projectIdFor('wall', 'Wall A')).toBe('wall');
    expect(projectIdFor('wall', '  wall   a ')).toBe('wall');
    expect(projectIdFor('room', 'Room')).toBe('room');
    expect(projectIdFor('room', '')).toBe('room');
    expect(projectIdFor('wall', 'North Elevation')).toBe('wall-north-elevation');
    expect(projectIdFor('room', 'Loft <img src=x onerror=alert(1)>')).toBe('room-loft-img-src-x-onerror-alert-1');
    expect(projectIdFor('wall', 'Kitchen')).toBe(projectIdFor('wall', 'KITCHEN'));
    expect(projectIdFor('wall', '\u5ba2\u5385')).toMatch(/^wall-n[0-9a-z]+$/);
    expect(sanitizeProjectName('a\u0000b\nc'.padEnd(80, 'x'), 'wall')).toHaveLength(48);
    expect(sanitizeProjectName('a\u0000b\nc', 'wall')).toBe('ab c');
  });

  test('three named rooms save separately, list on /account and delete one', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [ROOM_KEY, JSON.stringify(serializeRoomState(ROOM))],
    ]);

    await page.goto('/room-3d');
    const name = page.getByTestId('project-name-input');
    await expect(name).toHaveValue('Room');
    await saveNamed(page, 'save-room-to-cloud', 'North Elevation');
    await expect(lastToast(page)).toHaveText('North Elevation saved to Lumen Cloud. Revision 01.');
    await saveNamed(page, 'save-room-to-cloud', 'Reading Nook');
    await expect(lastToast(page)).toHaveText('Reading Nook saved to Lumen Cloud. Revision 01.');
    await expect(page.getByTestId('save-room-to-cloud')).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
    await saveNamed(page, 'save-room-to-cloud', 'Reading Nook');
    await expect(lastToast(page)).toHaveText('Reading Nook saved to Lumen Cloud. Revision 02.');

    // The name travels with the draft: a reload keeps it.
    await page.reload();
    await expect(name).toHaveValue('Reading Nook');

    await expect(page.getByTestId('save-room-to-cloud')).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
    await saveNamed(page, 'save-room-to-cloud', '  Loft\tPlan  ');
    await expect(lastToast(page)).toHaveText('Loft Plan saved to Lumen Cloud. Revision 01.');
    await expect(name).toHaveValue('Loft Plan');

    const stored = await readJson(page, PROJECTS_KEY);
    expect(stored.map((record) => [record.id, record.name, record.revision])).toEqual([
      ['room-loft-plan', 'Loft Plan', 1],
      ['room-reading-nook', 'Reading Nook', 2],
      ['room-north-elevation', 'North Elevation', 1],
    ]);

    await page.goto('/account');
    const cards = page.getByTestId('saved-project');
    await expect(cards).toHaveCount(3);
    await expect(cards.getByRole('heading', { level: 3 })).toHaveText(['Loft Plan', 'Reading Nook', 'North Elevation']);
    await expect(page.getByTestId('account-fact-projects')).toHaveText('03');
    const nook = page.locator('[data-project-id="room-reading-nook"]');
    await expect(nook.getByTestId('saved-project-revision')).toHaveText('Rev 02');

    const north = page.locator('[data-project-id="room-north-elevation"]');
    const remove = north.getByTestId('delete-saved-project');
    await expect(remove).toHaveAccessibleName('Delete North Elevation');
    await remove.click();
    await expect(north).toHaveAttribute('aria-busy', 'true');
    await expect(remove).toBeDisabled();
    await expect(north.getByRole('link', { name: 'Open Room Planner' })).toHaveAttribute('aria-disabled', 'true');
    await expect(north).toHaveCount(0);
    await expect(lastToast(page)).toHaveText('North Elevation deleted from Lumen Cloud.');
    await expect(cards).toHaveCount(2);
    await expect(page.getByTestId('account-fact-projects')).toHaveText('02');
    expect((await readJson(page, PROJECTS_KEY)).map((record) => record.id)).toEqual(['room-loft-plan', 'room-reading-nook']);

    await page.reload();
    await expect(cards).toHaveCount(2);

    // Opening a named project checks out its revision and its name over the current draft.
    await seed(page, [['lumen:lumen_project_names_v1', JSON.stringify({ wall: 'Wall A', room: 'Room' })]]);
    await nook.getByRole('link', { name: 'Open Room Planner' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expect(page.getByTestId('project-name-input')).toHaveValue('Reading Nook');

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a full library refuses a new name, still revises an existing one, and drops forged ids', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const data = serializeRoomState(ROOM);
    const library = Array.from({ length: MAX_STORED_PROJECTS }, (_, i) => ({
      id: `room-plan-${i + 1}`,
      kind: 'room',
      name: `Plan ${i + 1}`,
      revision: 1,
      savedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      data,
    }));
    const forged = [
      { ...library[0], id: 'wall-plan-1' },
      { ...library[0], id: '__proto__' },
      { ...library[0], id: 'room-<img>' },
    ];
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [ROOM_KEY, JSON.stringify(data)],
      [PROJECTS_KEY, JSON.stringify([...forged, ...library])],
    ]);

    await page.goto('/account');
    await expect(page.getByTestId('saved-project')).toHaveCount(MAX_STORED_PROJECTS);
    await expect(page.getByTestId('saved-project').first().getByRole('heading', { level: 3 })).toHaveText('Plan 12');

    await page.goto('/room-3d');
    const save = page.getByTestId('save-room-to-cloud');
    await page.getByTestId('project-name-input').fill('Plan 13');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'error');
    await expect(lastToast(page)).toHaveText(
      `Lumen Cloud holds ${MAX_STORED_PROJECTS} projects. Delete one from your account to save a new name.`,
    );
    expect(await readJson(page, PROJECTS_KEY)).toHaveLength(MAX_STORED_PROJECTS + forged.length);

    await saveNamed(page, 'save-room-to-cloud', 'Plan 3');
    await expect(lastToast(page)).toHaveText('Plan 3 saved to Lumen Cloud. Revision 02.');
    const stored = await readJson(page, PROJECTS_KEY);
    expect(stored).toHaveLength(MAX_STORED_PROJECTS);
    expect(stored[0]).toMatchObject({ id: 'room-plan-3', revision: 2 });
    expect(stored.some((record) => record.id === 'wall-plan-1' || record.id === '__proto__')).toBe(false);
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    // The rejected save was an expected API fault, surfaced as a toast only.
    expect(errors).toEqual([]);
  });
});

test.describe('wavefront export', () => {
  test('room planner exports a valid OBJ with sanitized object names', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [[ROOM_KEY, JSON.stringify(serializeRoomState(ROOM))]]);
    await page.goto('/room-3d');
    await expect(page.getByTestId('room-modules')).toHaveText(String(ROOM.items.length).padStart(2, '0'));
    await page.getByTestId('project-name-input').fill('Loft <North>\u00e9 / 01');

    const exportButton = page.getByTestId('export-room-obj');
    await expect(exportButton).toHaveText('Export 3D .OBJ');
    const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
    expect(download.suggestedFilename()).toBe('lumen-room-loft_north_e_01.obj');
    await expect(lastToast(page)).toContainText('exported as Wavefront .OBJ.');
    await expect(page.getByTestId('room-bridge-status')).toContainText('Exported Wavefront OBJ');

    const text = await readFile(await download.path(), 'utf-8');
    expect(text).toBe(buildRoomObj(ROOM, 'Loft <North>\u00e9 / 01'));
    expect(text.startsWith('# Lumen 3D Export\n')).toBe(true);
    expect(/^[\n\x20-\x7e]*$/.test(text)).toBe(true);

    const lines = text.trimEnd().split('\n');
    const record = /^(?:|#[\x20-\x7e]*|o [A-Za-z0-9_-]+|v -?\d+(?:\.\d+)? -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?|vn -?[01] -?[01] -?[01]|f(?: \d+\/\/\d+){3,4})$/;
    for (const line of lines) expect(line, line).toMatch(record);

    const vertices = lines.filter((line) => line.startsWith('v ')).map((line) => line.slice(2).split(' ').map(Number));
    const normals = lines.filter((line) => line.startsWith('vn ')).map((line) => line.slice(3).split(' ').map(Number));
    const objects = lines.filter((line) => line.startsWith('o ')).map((line) => line.slice(2));
    const faces = lines.filter((line) => line.startsWith('f '));
    const furniture = furnitureLayout(ROOM.room);
    expect(normals).toHaveLength(6);
    expect(objects[0]).toBe('room_envelope');
    expect(objects.filter((name) => name.startsWith('furniture_sofa-200_'))).toHaveLength(furniture.parts.length);
    expect(objects.filter((name) => name.startsWith('module_'))).toHaveLength(ROOM.items.length);
    expect(objects).toHaveLength(1 + furniture.parts.length + ROOM.items.length);
    // Floor plus all four walls, then six faces per box.
    expect(faces).toHaveLength(5 + 6 * (furniture.parts.length + ROOM.items.length));

    // Every face indexes real records and winds counter-clockwise around its normal.
    const { widthCm, depthCm, heightCm } = ROOM.room;
    for (const [x, y, z] of vertices) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(widthCm);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(heightCm);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(depthCm);
    }
    for (const face of faces) {
      const corners = face.slice(2).split(' ').map((corner) => corner.split('//').map(Number));
      for (const [v, n] of corners) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(vertices.length);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(6);
      }
      const [a, b, c] = corners.map(([v]) => vertices[v - 1]);
      const u = b.map((value, i) => value - a[i]);
      const w = c.map((value, i) => value - a[i]);
      const cross = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const normal = normals[corners[0][1] - 1];
      expect(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2], face).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
