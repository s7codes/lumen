import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { BAG_STORAGE_KEY } from '../src/lib/bag.js';
import { computeBusTopology, FEED_DATUM, formatBusTelemetry } from '../src/lib/bus-topology.js';
import { LOOP_OHM_PER_M } from '../src/lib/electrical.js';
import { ACTIVE_NAMES_STORAGE_KEY } from '../src/lib/project-library.js';
import { buildQuote } from '../src/lib/quote.js';
import { createRoomState, importFromWallStudio, ROOM_STORAGE_KEY, serializeRoomState } from '../src/lib/room-3d.js';
import { decodeSceneParam, encodeSceneParam, SCENE_MAX_LENGTH } from '../src/lib/scene-codec.js';
import { createLayout, layoutFromPreset, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations, storeDisplayMode } from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const BAG_KEY = `lumen:${BAG_STORAGE_KEY}`;
const NAMES_KEY = `lumen:${ACTIVE_NAMES_STORAGE_KEY}`;

const BUS_WALL = createLayout({ widthCm: 300, heightCm: 250 }, [
  { uid: 'm1', productId: 'linear-lightbar-60', finish: 'oak', xCm: 40, yCm: 150, led: true, locked: false },
  { uid: 'm2', productId: 'modular-cube-36', finish: 'walnut', xCm: 200, yCm: 100, led: true, locked: false },
  { uid: 'm3', productId: 'floating-shelf-110', finish: 'chalk', xCm: 120, yCm: 40, led: false, locked: false },
]);
const NORDIC = layoutFromPreset('nordic-reading-wall');
const ROOM = importFromWallStudio(createRoomState()).state;

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function lastToast(page) {
  return page.getByTestId('toast').last();
}

function overlay(page) {
  return page.getByTestId('bus-topology-overlay');
}

async function openStudioWith(page, layout, name) {
  await page.goto('/');
  const entries = [[WALL_KEY, JSON.stringify(serializeLayout(layout))]];
  if (name) entries.push([NAMES_KEY, JSON.stringify({ wall: name, room: 'Room' })]);
  await seed(page, entries);
  await page.goto('/studio-2d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
}

/** Rebuilds the visible wall from the DOM so expectations follow whatever the UI placed. */
async function readWall(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="wall-canvas"]');
    return {
      wall: { widthCm: Number(canvas.dataset.widthCm), heightCm: Number(canvas.dataset.heightCm) },
      items: [...document.querySelectorAll('[data-testid="wall-module"]')].map((el) => ({
        uid: el.dataset.uid,
        productId: el.dataset.product,
        finish: el.dataset.finish,
        xCm: Number(el.dataset.xCm),
        yCm: Number(el.dataset.yCm),
        led: el.dataset.led === 'true',
      })),
    };
  });
}

async function expectOverlayMatches(page) {
  const expected = computeBusTopology(await readWall(page));
  const node = overlay(page);
  await expect(node).toHaveAttribute('data-nodes', String(expected.nodes.length));
  await expect(node).toHaveAttribute('data-run-m', String(expected.totalRunM));
  await expect(node).toHaveAttribute('data-current-a', String(expected.currentA));
  await expect(node).toHaveAttribute('data-drop-pct', String(expected.voltageDropPct));
  await expect(node).toHaveAttribute('data-within-spec', 'true');
  await expect(page.getByTestId('bus-node')).toHaveCount(expected.nodes.length);
  await expect(page.getByTestId('bus-segment')).toHaveCount(expected.segments.length);
  await expect(page.getByTestId('bus-node').locator('.wall-bus__node-label')).toHaveText(
    expected.nodes.map((n) => n.label),
  );
  await expect(page.getByTestId('bus-run-telemetry')).toHaveText(formatBusTelemetry(expected));
  return expected;
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('24V bus topology', () => {
  test('the 24V Bus switch draws the routed chain and follows added and moved modules', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openStudioWith(page, BUS_WALL);

    const expected = computeBusTopology(BUS_WALL);
    await expect(overlay(page)).toHaveCount(0);
    await expect(page.getByTestId('bus-run-telemetry')).toHaveText(formatBusTelemetry(expected));
    await expect(page.getByTestId('bus-run-telemetry')).toHaveText(/^Run \d+\.\d m \/ \d+\.\d{2} A \/ \d+\.\d{2} V drop \(\d+\.\d%\)$/);

    const toggle = page.getByTestId('toggle-bus-topology');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(overlay(page)).toBeVisible();

    // The unlit shelf stays off the chain; feed at the utility datum.
    const origin = page.getByTestId('bus-psu-origin');
    await expect(origin).toHaveAttribute('data-kind', 'datum');
    await expect(origin).toHaveText('PSU 24V FEED');
    await expect(page.locator('[data-testid="bus-node"][data-uid="m3"]')).toHaveCount(0);
    await expect(page.getByTestId('bus-run-callout')).toHaveCount(2);
    await expect(page.getByTestId('bus-run-callout').first()).toHaveText(`${expected.nodes[0].hopM.toFixed(2)} m`);
    const first = await expectOverlayMatches(page);
    expect(first.currentA).toBeCloseTo((14 + 12) / 24, 3);

    const leftBefore = await origin.evaluate((el) => parseFloat(el.style.left));
    const ppcm = Number(await page.getByTestId('wall-canvas').getAttribute('data-ppcm'));
    expect(leftBefore).toBeCloseTo(FEED_DATUM.xCm * ppcm, 1);

    await page.getByRole('button', { name: 'Mount Acoustic Art Frame 50x70', exact: true }).click();
    await expect(page.getByTestId('wall-module')).toHaveCount(4);
    const added = await expectOverlayMatches(page);
    expect(added.nodes).toHaveLength(3);
    expect(added.currentA).toBeCloseTo((14 + 12 + 15) / 24, 3);

    const cube = page.locator('[data-testid="wall-module"][data-uid="m2"]');
    const cubeNode = page.locator('[data-testid="bus-node"][data-uid="m2"]');
    const nodeBottom = () => cubeNode.evaluate((el) => parseFloat(el.style.bottom));
    const bottomBefore = await nodeBottom();
    await cube.click();
    await cube.press('Shift+ArrowRight');
    await cube.press('Shift+ArrowUp');
    await expect(cube).toHaveAttribute('data-x-cm', '210');
    await expect(cube).toHaveAttribute('data-y-cm', '110');
    const moved = await expectOverlayMatches(page);
    expect(moved.nodes.find((n) => n.uid === 'm2')).toMatchObject({ xCm: 228, yCm: 110 });
    expect(await nodeBottom()).toBeCloseTo(bottomBefore + 10 * ppcm, 1);
    expect(moved.voltageDropPct).toBeLessThan(3);

    await toggle.click();
    await expect(overlay(page)).toHaveCount(0);

    await page.getByTestId('mode-switch').getByRole('button', { name: 'Technical' }).click();
    await expect(page.locator('.studio-layout')).toHaveAttribute('data-mode', 'technical');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(overlay(page)).toBeVisible();
    await expectOverlayMatches(page);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('a mounted track bus becomes the feed and the room summary reports the same run', async ({ page }) => {
    await page.goto('/');
    await storeDisplayMode(page, 'technical');
    await openStudioWith(page, NORDIC);

    const expected = computeBusTopology(NORDIC);
    const track = NORDIC.items.find((item) => item.productId === 'track-bus-200');
    await expect(page.getByTestId('bus-psu-origin')).toHaveAttribute('data-kind', 'track');
    await expect(page.locator(`[data-testid="bus-node"][data-uid="${track.uid}"]`)).toHaveCount(0);
    expect(expected.origin).toMatchObject({ xCm: track.xCm, yCm: track.yCm + 1.5, kind: 'track' });
    await expectOverlayMatches(page);

    await seed(page, [[ROOM_KEY, JSON.stringify(serializeRoomState(ROOM))]]);
    await page.goto('/room-3d');
    await expect(page.getByTestId('room-modules')).toHaveText('09');
    await expect(page.getByTestId('bus-run-telemetry')).toHaveText(formatBusTelemetry(computeBusTopology(ROOM)));
    await expect(page.getByTestId('bus-run-telemetry')).toHaveAttribute('data-within-spec', 'true');
  });

  test('chain math: daisy-chain drop is cumulative and the 3% SELV limit is enforced', () => {
    const single = computeBusTopology(
      createLayout({ widthCm: 300, heightCm: 250 }, [
        { uid: 'm1', productId: 'linear-lightbar-60', finish: 'oak', xCm: 100, yCm: 150, led: true },
      ]),
    );
    const hopM = (Math.abs(130 - FEED_DATUM.xCm) + Math.abs(150 - FEED_DATUM.yCm)) / 100;
    expect(single.totalRunM).toBeCloseTo(hopM, 2);
    expect(single.segments).toEqual([
      { x1: 20, y1: 30, x2: 130, y2: 30, order: 1, toUid: 'm1' },
      { x1: 130, y1: 30, x2: 130, y2: 150, order: 1, toUid: 'm1' },
    ]);
    expect(single.voltageDropV).toBeCloseTo((14 / 24) * LOOP_OHM_PER_M * hopM, 3);

    // Two nodes: the first hop carries both loads, the second only the far one.
    const pair = computeBusTopology(
      createLayout({ widthCm: 300, heightCm: 250 }, [
        { uid: 'm1', productId: 'linear-lightbar-60', finish: 'oak', xCm: 200, yCm: 30, led: true },
        { uid: 'm2', productId: 'linear-lightbar-60', finish: 'oak', xCm: 50, yCm: 30, led: true },
      ]),
    );
    expect(pair.nodes.map((n) => n.uid)).toEqual(['m2', 'm1']);
    const drop = (28 / 24) * LOOP_OHM_PER_M * 0.6 + (14 / 24) * LOOP_OHM_PER_M * 1.5;
    expect(pair.voltageDropV).toBeCloseTo(drop, 3);

    const overload = computeBusTopology({
      wall: { widthCm: 400, heightCm: 320 },
      items: Array.from({ length: 48 }, (_, i) => ({
        uid: `m${i + 1}`,
        productId: 'corner-floor-column-140',
        finish: 'oak',
        xCm: (i % 12) * 32,
        yCm: Math.floor(i / 12) * 60,
        led: true,
      })),
    });
    expect(overload.currentA).toBeCloseTo((48 * 24) / 24, 3);
    expect(overload.voltageDropPct).toBeGreaterThan(3);
    expect(overload.withinSpec).toBe(false);

    const empty = computeBusTopology(createLayout());
    expect(empty).toMatchObject({ totalRunM: 0, currentA: 0, voltageDropV: 0, withinSpec: true, nodes: [] });
  });
});

test.describe('shareable scene links', () => {
  test('wall: Share Link copies a URL that restores modules and name in a fresh context', async ({ page, browser }) => {
    const errors = collectRuntimeErrors(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openStudioWith(page, NORDIC, 'Halvorsen Living Wall');

    const share = page.getByTestId('copy-share-link');
    await share.click();
    await expect(lastToast(page)).toContainText('Shareable scene link copied.');
    await expect(lastToast(page)).toHaveAttribute('data-tone', 'success');
    const url = await share.getAttribute('data-share-url');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4173\/studio-2d\?scene=[A-Za-z0-9_-]+$/);
    expect(new URL(url).searchParams.get('scene').length).toBeLessThanOrEqual(SCENE_MAX_LENGTH);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await installCspRecorder(fresh);
    const freshErrors = collectRuntimeErrors(fresh);
    await fresh.goto(url);
    await expect(fresh.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Halvorsen Living Wall.');
    await expect(fresh).toHaveURL(/\/studio-2d$/);
    await expect(fresh.getByTestId('project-name-input')).toHaveValue('Halvorsen Living Wall');
    const restored = await readWall(fresh);
    expect(restored.wall).toEqual({ widthCm: NORDIC.wall.widthCm, heightCm: NORDIC.wall.heightCm });
    expect(restored.items).toEqual(
      NORDIC.items.map(({ uid, productId, finish, xCm, yCm, led }) => ({ uid, productId, finish, xCm, yCm, led })),
    );

    // Stripped from the address bar, so a reload keeps the local draft and does not re-announce.
    await fresh.reload();
    await expect(fresh.getByTestId('wall-module')).toHaveCount(NORDIC.items.length);
    await expect(fresh.getByTestId('toast')).toHaveCount(0);

    expect(freshErrors).toEqual([]);
    expect(await readCspViolations(fresh)).toEqual([]);
    await context.close();
    expect(errors).toEqual([]);
  });

  test('room: Share Link restores the room, camera, modules and name in a fresh context', async ({ page, browser }) => {
    const errors = collectRuntimeErrors(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const room = { ...ROOM, room: { ...ROOM.room, depthCm: 340, furniture: 'sofa-200', lighting: 'daylight' } };
    await page.goto('/');
    await seed(page, [
      [ROOM_KEY, JSON.stringify(serializeRoomState(room))],
      [NAMES_KEY, JSON.stringify({ wall: 'Wall A', room: 'Atelier Lounge' })],
    ]);
    await page.goto('/room-3d');
    await expect(page.getByTestId('room-modules')).toHaveText('09');

    const share = page.getByTestId('copy-share-link');
    await share.click();
    await expect(lastToast(page)).toContainText('Shareable scene link copied.');
    const url = await share.getAttribute('data-share-url');
    expect(url).toMatch(/\/room-3d\?scene=[A-Za-z0-9_-]+$/);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await installCspRecorder(fresh);
    const freshErrors = collectRuntimeErrors(fresh);
    await fresh.goto(url);
    await expect(fresh.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Atelier Lounge.');
    await expect(fresh).toHaveURL(/\/room-3d$/);
    await expect(fresh.getByTestId('project-name-input')).toHaveValue('Atelier Lounge');
    await expect(fresh.getByTestId('room-modules')).toHaveText('09');
    await expect(fresh.getByTestId('bus-run-telemetry')).toHaveText(formatBusTelemetry(computeBusTopology(room)));
    await expect
      .poll(() => fresh.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY))
      .toEqual(serializeRoomState(room));

    expect(freshErrors).toEqual([]);
    expect(await readCspViolations(fresh)).toEqual([]);
    await context.close();
    expect(errors).toEqual([]);
  });

  test('tampered, oversized, wrong-kind and hostile scene links are rejected and the draft is kept', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
    const wallLink = encodeSceneParam('wall', NORDIC, 'Wall A');
    const hostile = [
      ['bad alphabet', '%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
      ['oversized', 'A'.repeat(SCENE_MAX_LENGTH + 4)],
      ['not json', b64('lumen-not-a-scene')],
      ['wrong kind', encodeSceneParam('room', ROOM, 'Room')],
      ['prototype key', b64('{"v":1,"k":"w","n":"x","__proto__":{"polluted":1},"w":[300,250,0,0,"ambient"],"i":[]}')],
      ['escaped prototype key', b64('{"v":1,"k":"w","n":"x","\\u005f_proto__":{},"w":[300,250,0,0,"ambient"],"i":[]}')],
      ['constructor key', b64('{"v":1,"k":"w","n":"x","w":[300,250,0,0,"ambient"],"i":[],"constructor":{"prototype":{}}}')],
      ['unknown part', b64('{"v":1,"k":"w","n":"x","w":[300,250,0,0,"ambient"],"i":[["evil-part","oak",0,0,1,0]]}')],
      ['truncated', wallLink.slice(0, -7)],
    ];

    await openStudioWith(page, BUS_WALL, 'Draft Wall');
    for (const [label, raw] of hostile) {
      await page.goto(`/studio-2d?scene=${raw}&ref=keep`);
      const toast = page.getByTestId('toast').last();
      await expect(toast, label).toHaveAttribute('data-tone', 'error');
      await expect(toast.getByTestId('toast-message'), label).toHaveText('Shared scene link is invalid.');
      await expect(page, label).toHaveURL(/\/studio-2d\?ref=keep$/);
      await expect(page.getByTestId('wall-module'), label).toHaveCount(BUS_WALL.items.length);
      await expect(page.getByTestId('project-name-input'), label).toHaveValue('Draft Wall');
    }
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();

    // A script-shaped name is data: it loads as plain text and never reaches the DOM as markup.
    const xssName = '<img src=x onerror=alert(1)>';
    await page.goto(`/studio-2d?scene=${encodeSceneParam('wall', BUS_WALL, xssName)}`);
    await expect(page.getByTestId('project-name-input')).toHaveValue(xssName);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);

    for (const [, raw] of hostile) expect(decodeSceneParam('wall', decodeURIComponent(raw))).toBeNull();
    expect(decodeSceneParam('wall', null)).toBeNull();
    expect(decodeSceneParam('room', wallLink)).toBeNull();
    expect(decodeSceneParam('wall', wallLink).state.items).toEqual(NORDIC.items);
  });
});

test.describe('installation schedule', () => {
  test('checkout totals anchors, wall span, trunk cable and SELV circuits on screen and in print', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const bag = [
      { id: 'floating-shelf-110', finish: 'oak', qty: 2 },
      { id: 'track-bus-200', finish: 'obsidian', qty: 1 },
      { id: 'directional-spot-monopoint', finish: 'chalk', qty: 3 },
      { id: 'corner-floor-column-140', finish: 'walnut', qty: 1 },
    ];
    await page.goto('/');
    await seed(page, [[BAG_KEY, JSON.stringify(bag)]]);
    await page.goto('/checkout');

    // shelf 3x2 + track 5 + spot 1x3 + column 1; span counts wall and recessed parts only.
    const anchors = 3 * 2 + 5 + 3 + 1;
    const spanCm = 110 * 2 + 200;
    const loadW = 16 * 2 + 7 * 3 + 24;
    const cableM = Math.ceil((3 + spanCm / 100 + 0.5 * 6) * 2) / 2;
    expect(buildQuote({ items: bag, currencyCode: 'USD' }).installation).toMatchObject({
      totalAnchors: anchors,
      totalLinearWidthCm: spanCm,
      recommendedCableM: cableM,
      circuits: 1,
    });
    expect(loadW).toBeLessThanOrEqual(150);

    const schedule = page.getByTestId('installation-schedule');
    await expect(schedule).toBeVisible();
    await expect(schedule).toContainText('Installation & Hardware Schedule');
    await expect(page.getByTestId('install-anchors')).toHaveText(`${anchors} pcs`);
    await expect(page.getByTestId('install-span')).toHaveText(`${spanCm} cm / 4.20 m`);
    await expect(page.getByTestId('install-cable')).toHaveText(`${cableM.toFixed(1)} m`);
    await expect(page.getByTestId('install-circuits')).toHaveText('1 x 150 W');

    await page.emulateMedia({ media: 'print' });
    await expect(schedule).toBeVisible();
    await expect(page.getByTestId('install-anchors')).toBeVisible();
    await page.emulateMedia({ media: 'screen' });

    // 8 columns at 24 W is 192 W: two SELV circuits, each with its own lead-in.
    await seed(page, [[BAG_KEY, JSON.stringify([{ id: 'corner-floor-column-140', finish: 'oak', qty: 8 }])]]);
    await page.reload();
    await expect(page.getByTestId('install-circuits')).toHaveText('2 x 150 W');
    await expect(page.getByTestId('install-anchors')).toHaveText('8 pcs');
    await expect(page.getByTestId('install-span')).toHaveText('0 cm / 0.00 m');
    await expect(page.getByTestId('install-cable')).toHaveText(`${(2 * 3 + 8 * 0.5).toFixed(1)} m`);

    const passive = buildQuote({ items: [{ id: 'track-bus-200', finish: 'chalk', qty: 2 }], currencyCode: 'USD' });
    expect(passive.installation).toMatchObject({ totalAnchors: 10, totalLinearWidthCm: 400, recommendedCableM: 0, circuits: 0 });
    expect(getProduct('track-bus-200').mount).toBe('recessed');

    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
