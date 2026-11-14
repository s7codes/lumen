import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { BAG_STORAGE_KEY } from '../src/lib/bag.js';
import { computeBusTopology, FEED_DATUM, formatBusTelemetry } from '../src/lib/bus-topology.js';
import { LOOP_OHM_PER_M } from '../src/lib/electrical.js';
import { ACTIVE_NAMES_STORAGE_KEY } from '../src/lib/project-library.js';
import { buildQuote } from '../src/lib/quote.js';
import { createRoomState, importFromWallStudio, ROOM_STORAGE_KEY, roomFromWallLayout, serializeRoomState } from '../src/lib/room-3d.js';
import { decodeSceneParam, encodeSceneParam, SCENE_MAX_LENGTH } from '../src/lib/scene-codec.js';
import { createLayout, layoutFromPreset } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

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
const BUS_ROOM = roomFromWallLayout(createRoomState(), BUS_WALL);

async function seed(page, entries) {
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
  }, entries);
}

function lastToast(page) {
  return page.getByTestId('toast').last();
}

async function openRoomWith(page, state, name) {
  await page.goto('/');
  const entries = [[ROOM_KEY, JSON.stringify(serializeRoomState(state))]];
  if (name) entries.push([NAMES_KEY, JSON.stringify({ wall: 'Wall', room: name })]);
  await seed(page, entries);
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

/** Reads the room's modules from the DOM mirror. */
async function readRoomItems(page) {
  return page.getByTestId('room-module').evaluateAll((nodes) =>
    nodes.map((el) => ({
      uid: el.dataset.uid,
      productId: el.dataset.product,
      finish: el.dataset.finish,
      xCm: Number(el.dataset.xCm),
      yCm: Number(el.dataset.yCm),
      led: el.dataset.led === 'true',
    })),
  );
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('24V bus topology', () => {
  test('a mounted track bus becomes the feed and the room summary reports the same run', async ({ page }) => {
    const expected = computeBusTopology(NORDIC);
    const track = NORDIC.items.find((item) => item.productId === 'track-bus-200');
    expect(expected.origin).toMatchObject({ xCm: track.xCm, yCm: track.yCm + 1.5, kind: 'track' });
    expect(expected.nodes.some((node) => node.uid === track.uid)).toBe(false);

    await openRoomWith(page, ROOM);
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
  test('a legacy wall link restores its modules and name on the north wall in a fresh context', async ({ browser }) => {
    const url = `http://127.0.0.1:4173/studio-2d?scene=${encodeSceneParam('wall', NORDIC, 'Halvorsen Living Wall')}`;
    expect(new URL(url).searchParams.get('scene').length).toBeLessThanOrEqual(SCENE_MAX_LENGTH);

    const context = await browser.newContext();
    const fresh = await context.newPage();
    await installCspRecorder(fresh);
    const freshErrors = collectRuntimeErrors(fresh);
    await fresh.goto(url);
    await expect(fresh.getByTestId('toast-message').last()).toHaveText('Loaded shared scene: Halvorsen Living Wall.');
    await expect(fresh).toHaveURL(/\/room-3d$/);
    await expect(fresh.getByTestId('project-name-input')).toHaveValue('Halvorsen Living Wall');
    await expect(fresh.getByTestId('room-viewport')).toHaveAttribute('data-room-width', String(NORDIC.wall.widthCm));
    await expect(fresh.getByTestId('room-module')).toHaveCount(NORDIC.items.length);
    expect(await readRoomItems(fresh)).toEqual(
      NORDIC.items.map(({ uid, productId, finish, xCm, yCm, led }) => ({ uid, productId, finish, xCm, yCm, led })),
    );

    // Stripped from the address bar, so a reload keeps the local draft and does not re-announce.
    await fresh.reload();
    await expect(fresh.getByTestId('room-module')).toHaveCount(NORDIC.items.length);
    await expect(fresh.getByTestId('toast')).toHaveCount(0);

    expect(freshErrors).toEqual([]);
    expect(await readCspViolations(fresh)).toEqual([]);
    await context.close();
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

  test('tampered, oversized and hostile scene links are rejected and the draft is kept', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    const b64 = (text) => Buffer.from(text, 'utf8').toString('base64url');
    const wallLink = encodeSceneParam('wall', NORDIC, 'Wall A');
    const hostile = [
      ['bad alphabet', '%3Cscript%3Ealert(1)%3C%2Fscript%3E'],
      ['oversized', 'A'.repeat(SCENE_MAX_LENGTH + 4)],
      ['not json', b64('lumen-not-a-scene')],
      ['prototype key', b64('{"v":1,"k":"w","n":"x","__proto__":{"polluted":1},"w":[300,250,0,0,"ambient"],"i":[]}')],
      ['escaped prototype key', b64('{"v":1,"k":"w","n":"x","\\u005f_proto__":{},"w":[300,250,0,0,"ambient"],"i":[]}')],
      ['constructor key', b64('{"v":1,"k":"w","n":"x","w":[300,250,0,0,"ambient"],"i":[],"constructor":{"prototype":{}}}')],
      ['unknown part', b64('{"v":1,"k":"w","n":"x","w":[300,250,0,0,"ambient"],"i":[["evil-part","oak",0,0,1,0]]}')],
      ['truncated', wallLink.slice(0, -7)],
    ];

    await openRoomWith(page, BUS_ROOM, 'Draft Room');
    for (const [i, [label, raw]] of hostile.entries()) {
      // Legacy wall addresses redirect first, keeping the query, then reject the same way.
      const path = i % 2 === 0 ? '/room-3d' : '/studio-2d';
      await page.goto(`${path}?scene=${raw}&ref=keep`);
      const toast = page.getByTestId('toast').last();
      await expect(toast, label).toHaveAttribute('data-tone', 'error');
      await expect(toast.getByTestId('toast-message'), label).toHaveText('Shared scene link is invalid.');
      await expect(page, label).toHaveURL(/\/room-3d\?ref=keep$/);
      await expect(page.getByTestId('room-module'), label).toHaveCount(BUS_ROOM.items.length);
      await expect(page.getByTestId('project-name-input'), label).toHaveValue('Draft Room');
    }
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();

    // A script-shaped name is data: it loads as plain text and never reaches the DOM as markup.
    const xssName = '<img src=x onerror=alert(1)>';
    await page.goto(`/room-3d?scene=${encodeSceneParam('wall', BUS_WALL, xssName)}`);
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
