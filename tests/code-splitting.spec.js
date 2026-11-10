import { expect, test } from '@playwright/test';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|WallStudioPage|RoomCanvas)-[\w-]+\.js$/;

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('code splitting', () => {
  test('the overview never downloads planner or WebGL chunks', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);

    await page.getByRole('link', { name: 'Open room planner' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    expect(scripts.some((path) => /RoomPlannerPage-/.test(path))).toBe(true);
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a slow planner chunk shows the centered loading frame, then the workspace', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/RoomPlannerPage-[\w-]+\.js$/, async (route) => {
      await gate;
      await route.continue();
    });

    await page.goto('/room-3d', { waitUntil: 'commit' });
    const fallback = page.getByTestId('route-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('role', 'status');
    await expect(fallback).toContainText('Loading spatial engine');
    await expect(fallback.getByTestId('lumen-mark')).toBeVisible();

    const center = await fallback.locator('.route-fallback__center').boundingBox();
    const frame = await fallback.boundingBox();
    expect(Math.abs(center.x + center.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(2);
    expect(Math.abs(center.y + center.height / 2 - (frame.y + frame.height / 2))).toBeLessThan(2);

    release();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expect(fallback).toHaveCount(0);
  });

  test('a failed chunk download lands on a reload prompt instead of a blank frame', async ({ page }) => {
    await page.route(/\/assets\/WallStudioPage-[\w-]+\.js$/, (route) => route.abort());
    await page.goto('/studio-2d');
    const error = page.getByTestId('route-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText('Workspace did not load.');
    await expect(error.getByRole('button', { name: 'Reload' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible();
  });
});
