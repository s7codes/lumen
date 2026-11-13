import { expect, test } from '@playwright/test';
import { LATENCY_MS, PROJECTS_STORAGE_KEY, QUOTES_STORAGE_KEY } from '../src/api/client.js';
import { SESSION_STORAGE_KEY } from '../src/lib/auth.js';
import { padIndex } from '../src/lib/format.js';
import { createRoomState, importFromWallStudio, ROOM_STORAGE_KEY, serializeRoomState } from '../src/lib/room-3d.js';
import { layoutFromPreset, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { holdProjectSaves } from './support/cloud-gates.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const PROJECTS_KEY = `lumen:${PROJECTS_STORAGE_KEY}`;
const QUOTES_KEY = `lumen:${QUOTES_STORAGE_KEY}`;
const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const BAG_KEY = 'lumen:lumen_bag_v1';
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };
const WALL = layoutFromPreset('nordic-reading-wall');
const ROOM = importFromWallStudio(createRoomState()).state;

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function readJson(page, key) {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('lumen cloud client', () => {
  test('wall studio saves through a simulated round trip with a locked, spinning save key', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [[WALL_KEY, JSON.stringify(serializeLayout(WALL))]]);
    await page.goto('/studio-2d');

    const save = page.getByTestId('save-wall-to-cloud');
    await expect(save).toHaveAccessibleName('Save to Cloud');
    await expect(save).toBeEnabled();

    const release = await holdProjectSaves(page);
    const started = Date.now();
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saving');
    await expect(save).toBeDisabled();
    await expect(save).toHaveAccessibleName('Saving to Lumen Cloud...');
    await expect(save.locator('.cloud-save__ring')).toBeVisible();
    // Nothing is written until the round trip resolves.
    expect(await readJson(page, PROJECTS_KEY)).toBeNull();
    release();

    await expect(save).toHaveAttribute('data-state', 'saved');
    expect(Date.now() - started).toBeGreaterThanOrEqual(LATENCY_MS.min - 50);
    await expect(save).toHaveAccessibleName('Project Saved');
    await expect(page.getByTestId('toast-message').last()).toHaveText('Wall A saved to Lumen Cloud. Revision 01.');

    const stored = await readJson(page, PROJECTS_KEY);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'wall', revision: 1 });
    expect(stored[0].data.items).toHaveLength(WALL.items.length);

    await expect(save).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
    await expect(save).toHaveAccessibleName('Save to Cloud');

    // A burst of clicks while in flight commits exactly one revision. The save is held
    // in flight for the whole burst, so no click can land after it settles.
    const releaseBurst = await holdProjectSaves(page);
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saving');
    await save.click({ force: true }).catch(() => {});
    await save.dispatchEvent('click');
    releaseBurst();
    await expect(save).toHaveAttribute('data-state', 'saved');
    expect((await readJson(page, PROJECTS_KEY))[0].revision).toBe(2);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('save is disabled on an empty wall and the save key never shifts width between states', async ({ page }) => {
    await page.goto('/studio-2d');
    const save = page.getByTestId('save-wall-to-cloud');
    await expect(page.getByTestId('wall-module')).toHaveCount(0);
    await expect(save).toBeDisabled();

    await seed(page, [[WALL_KEY, JSON.stringify(serializeLayout(WALL))]]);
    await page.reload();
    const idleWidth = await save.evaluate((el) => el.getBoundingClientRect().width);
    const release = await holdProjectSaves(page);
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saving');
    expect(await save.evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(idleWidth, 0);

    // The spinner is a hairline arc, never a glowing status dot.
    const ring = await save.locator('.cloud-save__ring').evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow,
      animation: getComputedStyle(el).animationName,
    }));
    expect(ring).toEqual({ shadow: 'none', animation: 'cloud-save-spin' });
    release();
    await expect(save).toHaveAttribute('data-state', 'saved');

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test('room planner saves its own project slot and the account lists both, newest first', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [WALL_KEY, JSON.stringify(serializeLayout(WALL))],
      [ROOM_KEY, JSON.stringify(serializeRoomState(ROOM))],
    ]);

    await page.goto('/studio-2d');
    await page.getByTestId('save-wall-to-cloud').click();
    await expect(page.getByTestId('save-wall-to-cloud')).toHaveAttribute('data-state', 'saved');

    await page.goto('/room-3d');
    const save = page.getByTestId('save-room-to-cloud');
    await save.click();
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(page.getByTestId('toast-message').last()).toHaveText('Room saved to Lumen Cloud. Revision 01.');

    await page.goto('/account');
    await expect(page.getByTestId('projects-loading')).toBeVisible();
    const cards = page.getByTestId('saved-project');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute('data-project', 'room');
    await expect(cards.nth(1)).toHaveAttribute('data-project', 'wall');
    await expect(cards.nth(0).getByTestId('saved-project-modules')).toHaveText(padIndex(ROOM.items.length));
    expect(errors).toEqual([]);
  });

  test('tampered cloud records are dropped on read and never reach the account', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const good = { kind: 'wall', revision: 1, savedAt: '2026-11-01T10:00:00.000Z', data: serializeLayout(WALL) };
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [
        PROJECTS_KEY,
        JSON.stringify([
          { ...good, kind: '__proto__' },
          { ...good, revision: -4 },
          { ...good, savedAt: 'javascript:alert(1)' },
          { ...good, data: { format: 'lumen.wall', version: 99, items: [] } },
          good,
        ]),
      ],
      [
        QUOTES_KEY,
        JSON.stringify([
          { ref: 'LMN-R-<img src=x>', quoteId: 'LMN-Q-20261021-4K9Q2T' },
          {
            ref: 'LMN-R-0A1B2C3D',
            quoteId: 'LMN-Q-20261021-4K9Q2T',
            submittedAt: '2026-10-21T09:30:00.000Z',
            reference: '<script>alert(2)</script>',
            preparedFor: 'Studio',
            currency: 'XXX',
            grossMinor: 100,
            lines: 1,
            loadW: 0,
            status: 'Pending review',
          },
        ]),
      ],
    ]);
    await page.goto('/account');
    await expect(page.getByTestId('saved-project')).toHaveCount(1);
    await expect(page.getByTestId('order-history-empty')).toBeVisible();
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('checkout submits the requisition through the client and the account tracks it', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/');
    await seed(page, [
      [SESSION_KEY, JSON.stringify(GUEST)],
      [BAG_KEY, JSON.stringify([{ id: 'modular-cube-36', finish: 'oak', qty: 2 }])],
    ]);
    await page.goto('/checkout');
    await page.getByTestId('project-reference').fill('Nordic Residence - Living Wall');
    await page.getByTestId('project-client').fill('Studio Halvorsen Arkitekter');

    const submit = page.getByTestId('submit-requisition');
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText('Submitting to Lumen Cloud...');
    await expect(page.getByTestId('requisition-confirmed')).toHaveCount(0);

    await expect(page.getByTestId('requisition-confirmed')).toBeVisible();
    await expect(submit).toBeEnabled();
    const ref = await page.getByTestId('requisition-ref').textContent();
    expect(ref).toMatch(/^LMN-R-[0-9A-F]{8}$/);
    expect((await readJson(page, QUOTES_KEY))[0]).toMatchObject({ ref, status: 'Pending review' });

    await page.goto('/account');
    const row = page.getByTestId('order-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Nordic Residence - Living Wall');
    await expect(row).toContainText(`Requisition ${ref}`);
    await expect(page.getByTestId('account-fact-quotes')).toHaveText('01');
    expect(errors).toEqual([]);
  });

  test('an empty cart renders the hairline empty state with a path into the studio', async ({ page }) => {
    await page.goto('/checkout');
    const empty = page.getByTestId('checkout-empty');
    await expect(empty).toContainText('No parts specified yet.');
    const art = empty.locator('svg.empty-art');
    await expect(art).toBeVisible();
    expect(await art.locator('.empty-art__edge').first().evaluate((el) => getComputedStyle(el).strokeWidth)).toBe('0.8px');
    await expect(empty.locator('.empty-state__title')).toHaveCSS('color', 'rgb(161, 161, 170)');
    await empty.getByRole('link', { name: 'Start 2D Wall Studio' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
  });
});
