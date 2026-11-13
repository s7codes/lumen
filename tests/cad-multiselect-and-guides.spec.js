import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import {
  alignModules,
  computeSmartGuides,
  createLayout,
  distributeModules,
  EYE_DATUM_CM,
  moveModules,
  removeModules,
  updateModules,
  WALL_STORAGE_KEY,
} from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;

// Three staggered parts of different widths, plus a locked lightbar up high.
//   m1 cube 36 x 36      x  20..56   y 100..136
//   m2 sconce 10 x 80    x  90..100  y 120..200
//   m3 sideboard 75 x 38 x 200..275  y  60..98
//   m4 lightbar 60 x 5   x 200..260  y 220..225 (locked)
const ITEMS = [
  { uid: 'm1', productId: 'modular-cube-36', finish: 'oak', xCm: 20, yCm: 100, led: true, locked: false },
  { uid: 'm2', productId: 'wall-sconce-80', finish: 'chalk', xCm: 90, yCm: 120, led: true, locked: false },
  { uid: 'm3', productId: 'compact-sideboard-75', finish: 'walnut', xCm: 200, yCm: 60, led: true, locked: false },
  { uid: 'm4', productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 200, yCm: 220, led: true, locked: true },
];
const WALL = { widthCm: 300, heightCm: 250, slope: false, snap: false, surface: 'ambient' };
const SEED = { format: 'lumen.wall', version: 1, wall: WALL, items: ITEMS };
const SIZE = Object.fromEntries(ITEMS.map((item) => [item.uid, getProduct(item.productId).dimsCm]));

// Seeded from the overview, which never writes the wall key: seeding on the studio
// itself races its mount-time save, which can land after the seed on a loaded runner.
async function openSeededStudio(page) {
  await page.goto('/');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [WALL_KEY, JSON.stringify(SEED)]);
  await page.goto('/studio-2d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
  await expect(page.getByTestId('wall-module')).toHaveCount(4);
  // Raw mouse gestures do not scroll, so bring the whole elevation on screen.
  await page.getByTestId('wall-canvas').evaluate((el) => el.scrollIntoView({ block: 'center' }));
}

function mod(page, uid) {
  return page.locator(`[data-testid="wall-module"][data-uid="${uid}"]`);
}

async function positions(page) {
  return page.getByTestId('wall-module').evaluateAll((els) =>
    Object.fromEntries(els.map((el) => [el.dataset.uid, { x: Number(el.dataset.xCm), y: Number(el.dataset.yCm) }])),
  );
}

async function selectedUids(page) {
  return page.locator('[data-testid="wall-module"][data-selected]').evaluateAll((els) => els.map((el) => el.dataset.uid));
}

// Wall cm -> viewport px. y is measured up from the floor line.
async function wallPoint(page, xCm, yCm) {
  const canvas = page.getByTestId('wall-canvas');
  const box = await canvas.boundingBox();
  const ppcm = Number(await canvas.getAttribute('data-ppcm'));
  return { x: box.x + xCm * ppcm, y: box.y + box.height - yCm * ppcm, ppcm };
}

async function centreOf(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function multiInspector(page) {
  return page.getByTestId('multi-select-inspector');
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('cad multi-selection', () => {
  test('shift + click and marquee select groups that move as one undoable step by keys and pointer', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openSeededStudio(page);

    await mod(page, 'm1').click();
    await expect(page.getByTestId('inspector-name')).toHaveText('Modular Cube 36');
    await mod(page, 'm2').click({ modifiers: ['Shift'] });
    expect(await selectedUids(page)).toEqual(['m1', 'm2']);
    await expect(page.getByTestId('multi-select-title')).toHaveText('Multi-Selection (2 modules)');
    await mod(page, 'm2').click({ modifiers: ['Shift'] });
    expect(await selectedUids(page)).toEqual(['m1']);
    await expect(multiInspector(page)).toHaveCount(0);
    await expect(page.getByTestId('inspector-name')).toHaveText('Modular Cube 36');

    // Rubber band from the upper left to the lower right; it stops short of the
    // lightbar at 220 cm.
    const from = await wallPoint(page, 8, 210);
    const to = await wallPoint(page, 290, 40);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    const marquee = page.getByTestId('marquee-selection-box');
    await expect(marquee).toBeVisible();
    const band = await marquee.boundingBox();
    expect(Math.abs(band.width - (to.x - from.x))).toBeLessThan(2);
    expect(Math.abs(band.height - (to.y - from.y))).toBeLessThan(2);
    await page.mouse.up();
    await expect(marquee).toBeHidden();

    expect(await selectedUids(page)).toEqual(['m1', 'm2', 'm3']);
    await expect(multiInspector(page)).toBeVisible();
    await expect(page.getByTestId('multi-select-title')).toHaveText('Multi-Selection (3 modules)');
    await expect(page.getByTestId('item-readout')).toHaveText('3 modules / X 20 cm / Y 60 cm / 255 x 140 cm');

    // The marquee leaves focus on the wall, so keys act on the whole group.
    const start = await positions(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    let now = await positions(page);
    for (const uid of ['m1', 'm2', 'm3']) expect(now[uid]).toEqual({ x: start[uid].x + 1, y: start[uid].y + 10 });
    expect(now.m4).toEqual(start.m4);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    expect(await positions(page)).toEqual(start);

    // Pointer drag on any member carries the group. It is clamped at the right
    // wall edge by the sideboard (275 -> 300), so the shared shift is +25 cm.
    const grab = await centreOf(mod(page, 'm1'));
    const { ppcm } = await wallPoint(page, 0, 0);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 20 * ppcm, grab.y - 10 * ppcm, { steps: 5 });
    await page.mouse.move(grab.x + 60 * ppcm, grab.y - 10 * ppcm, { steps: 5 });
    await expect(page.locator('[data-testid="wall-module"][data-dragging]')).toHaveCount(3);
    await page.mouse.up();
    now = await positions(page);
    for (const uid of ['m1', 'm2', 'm3']) expect(now[uid]).toEqual({ x: start[uid].x + 25, y: start[uid].y + 10 });
    expect(now.m3.x + SIZE.m3.w).toBe(WALL.widthCm);
    expect(await selectedUids(page)).toEqual(['m1', 'm2', 'm3']);

    await page.keyboard.press('Control+z');
    expect(await positions(page)).toEqual(start);
    await page.keyboard.press('Control+y');
    expect((await positions(page)).m1).toEqual({ x: 45, y: 110 });
    await page.keyboard.press('Control+z');

    // A plain click on a member narrows the group back to that module.
    await mod(page, 'm2').click();
    expect(await selectedUids(page)).toEqual(['m2']);

    // Select All takes the unlocked modules; Escape clears; Delete removes the
    // group as one step and leaves the locked lightbar in place.
    await page.keyboard.press('Control+a');
    expect(await selectedUids(page)).toEqual(['m1', 'm2', 'm3']);
    await page.keyboard.press('Escape');
    expect(await selectedUids(page)).toEqual([]);
    await page.getByTestId('wall-canvas').focus();
    await page.keyboard.press('Control+a');
    expect(await selectedUids(page)).toEqual(['m1', 'm2', 'm3']);
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('wall-module')).toHaveCount(1);
    await expect(mod(page, 'm4')).toHaveCount(1);
    await expect(page.getByTestId('studio-notice')).toHaveText('Removed 3 modules.');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('wall-module')).toHaveCount(4);
    expect(await positions(page)).toEqual(start);

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('aligns and distributes three staggered modules, with batch finish, channel and undo', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openSeededStudio(page);
    await mod(page, 'm1').click();
    await mod(page, 'm2').click({ modifiers: ['Shift'] });
    await mod(page, 'm3').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('multi-select-title')).toHaveText('Multi-Selection (3 modules)');
    const start = await positions(page);

    // Top: every top edge meets the highest one (sconce, 120 + 80 = 200).
    await page.getByTestId('align-top').click();
    await expect(page.getByTestId('studio-notice')).toHaveText('Aligned top edges.');
    let now = await positions(page);
    for (const uid of ['m1', 'm2', 'm3']) {
      expect(now[uid].y + SIZE[uid].h).toBe(200);
      expect(now[uid].x).toBe(start[uid].x);
    }
    expect(now.m4).toEqual(start.m4);
    await page.keyboard.press('Control+z');
    expect(await positions(page)).toEqual(start);

    await page.getByTestId('align-left').click();
    now = await positions(page);
    for (const uid of ['m1', 'm2', 'm3']) expect(now[uid]).toEqual({ x: 20, y: start[uid].y });
    await page.keyboard.press('Control+z');
    expect(await positions(page)).toEqual(start);

    await page.getByTestId('align-bottom').click();
    for (const uid of ['m1', 'm2', 'm3']) expect((await positions(page))[uid].y).toBe(60);
    await page.keyboard.press('Control+z');

    // Distribute: the cube and the sideboard hold, the sconce moves so both
    // gaps equal (255 - 121) / 2 = 67 cm.
    await page.getByTestId('distribute-horizontal').click();
    await expect(page.getByTestId('studio-notice')).toHaveText('Distributed horizontally.');
    now = await positions(page);
    expect(now.m1.x).toBe(20);
    expect(now.m3.x).toBe(200);
    expect(now.m2).toEqual({ x: 123, y: 120 });
    const gapA = now.m2.x - (now.m1.x + SIZE.m1.w);
    const gapB = now.m3.x - (now.m2.x + SIZE.m2.w);
    expect(gapA).toBe(67);
    expect(gapB).toBe(67);
    await page.keyboard.press('Control+z');
    expect(await positions(page)).toEqual(start);
    expect(await selectedUids(page)).toEqual(['m1', 'm2', 'm3']);

    // Batch finish and LED channel are one undo step each.
    await expect(multiInspector(page).locator('.swatches__name')).toHaveText('Mixed');
    await multiInspector(page).getByRole('radio', { name: 'Obsidian' }).check();
    for (const uid of ['m1', 'm2', 'm3']) await expect(mod(page, uid)).toHaveAttribute('data-finish', 'obsidian');
    await expect(multiInspector(page).getByTestId('batch-finish-obsidian')).toBeChecked();
    await page.keyboard.press('Control+z');
    await expect(mod(page, 'm1')).toHaveAttribute('data-finish', 'oak');
    await expect(mod(page, 'm2')).toHaveAttribute('data-finish', 'chalk');

    const led = page.getByTestId('batch-led');
    await expect(led).toHaveAttribute('aria-checked', 'true');
    await led.click();
    for (const uid of ['m1', 'm2', 'm3']) await expect(mod(page, uid)).toHaveAttribute('data-led', 'false');
    await expect(led).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Control+z');
    for (const uid of ['m1', 'm2', 'm3']) await expect(mod(page, uid)).toHaveAttribute('data-led', 'true');

    await page.getByTestId('batch-remove').click();
    await expect(page.getByTestId('wall-module')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('wall-module')).toHaveCount(4);

    expect(errors).toEqual([]);
  });

  test('smart guides light up on the wall centreline and on a sibling edge while dragging', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openSeededStudio(page);
    const guides = page.getByTestId('smart-alignment-guides');
    await expect(guides).toHaveCount(0);

    // Sconce centre 95 -> 150: onto the centreline of the 300 cm wall.
    const { ppcm } = await wallPoint(page, 0, 0);
    let grab = await centreOf(mod(page, 'm2'));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x + 30 * ppcm, grab.y, { steps: 5 });
    await page.mouse.move(grab.x + 55 * ppcm, grab.y, { steps: 5 });
    await expect(guides).toBeVisible();
    const centre = guides.locator('[data-testid="smart-guide"][data-kind="wall-centre"]');
    await expect(centre).toHaveCount(1);
    await expect(centre).toHaveAttribute('data-at', String(WALL.widthCm / 2));
    await expect(centre).toHaveAttribute('data-edge', 'center-x');
    expect(Math.abs(Number(await centre.getAttribute('data-delta')))).toBeLessThanOrEqual(2);
    await expect(centre.locator('line')).toHaveCount(3);
    await expect(centre.locator('text')).toContainText('CL 150');
    await page.mouse.up();
    await expect(guides).toHaveCount(0);

    // Sideboard bottom 60 -> 100: level with the cube's bottom edge.
    grab = await centreOf(mod(page, 'm3'));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y - 20 * ppcm, { steps: 5 });
    await page.mouse.move(grab.x, grab.y - 40 * ppcm, { steps: 5 });
    const sibling = guides.locator('[data-testid="smart-guide"][data-kind="module"][data-axis="y"][data-at="100"]');
    await expect(sibling).toHaveCount(1);
    await expect(sibling).toHaveAttribute('data-edge', 'bottom');
    await expect(sibling).toHaveAttribute('data-exact', 'true');
    await page.mouse.up();
    await expect(guides).toHaveCount(0);
    expect((await positions(page)).m3).toEqual({ x: 200, y: 100 });

    expect(errors).toEqual([]);
  });
});

test.describe('cad multi-selection model', () => {
  const layout = createLayout(WALL, ITEMS);
  const uids = ['m1', 'm2', 'm3'];
  const byUid = (next) => Object.fromEntries(next.items.map((item) => [item.uid, item]));

  test('group moves are rigid, clamped to the wall and skip locked members', () => {
    const moved = byUid(moveModules(layout, [...uids, 'm4'], 500, -500));
    expect(moved.m3.xCm + SIZE.m3.w).toBe(300);
    expect(moved.m1.xCm - 20).toBe(moved.m3.xCm - 200);
    expect(moved.m3.yCm).toBe(0);
    expect(moved.m1.yCm - 100).toBe(-60);
    expect(moved.m4).toMatchObject({ xCm: 200, yCm: 220 });
    expect(moveModules(layout, uids, 0, 0)).toBe(layout);
    expect(moveModules(layout, uids, Number.NaN, 4)).toBe(layout);
    expect(moveModules(layout, ['m4'], 10, 0)).toBe(layout);
  });

  test('align needs two unlocked modules and lands on the bounding box', () => {
    expect(alignModules(layout, ['m1', 'm4'], 'left')).toBe(layout);
    expect(alignModules(layout, uids, '__proto__')).toBe(layout);
    const right = byUid(alignModules(layout, uids, 'right'));
    for (const uid of uids) expect(right[uid].xCm + SIZE[uid].w).toBe(275);
    const middle = byUid(alignModules(layout, uids, 'center-y'));
    for (const uid of uids) expect(Math.abs(middle[uid].yCm + SIZE[uid].h / 2 - 130)).toBeLessThanOrEqual(0.5);
    const centre = byUid(alignModules(layout, uids, 'center-x'));
    for (const uid of uids) expect(Math.abs(centre[uid].xCm + SIZE[uid].w / 2 - 147.5)).toBeLessThanOrEqual(0.5);
  });

  test('distribute equalizes gaps, or centres when the parts overrun the span', () => {
    expect(distributeModules(layout, ['m1', 'm2'], 'horizontal')).toBe(layout);
    const vertical = byUid(distributeModules(layout, uids, 'vertical'));
    // Sorted by centre: m3 (79), m1 (118), m2 (160). The span 60..200 is shorter
    // than the 154 cm of parts, so centres step evenly: m1 centre 119.5.
    expect(vertical.m3.yCm).toBe(60);
    expect(vertical.m2.yCm).toBe(120);
    expect(vertical.m1.yCm).toBe(102);
    expect(vertical.m1.xCm).toBe(20);
  });

  test('batch updates and removal respect product finishes and locks', () => {
    const recoloured = byUid(updateModules(layout, [...uids, 'm4'], { finish: 'chalk', xCm: 0 }));
    expect(recoloured.m1).toMatchObject({ finish: 'chalk', xCm: 20 });
    expect(recoloured.m4.finish).toBe('chalk');
    expect(updateModules(layout, uids, { finish: 'gold' })).toBe(layout);
    const left = removeModules(layout, [...uids, 'm4']);
    expect(left.items.map((item) => item.uid)).toEqual(['m4']);
  });

  test('smart guides report the centreline, the eye datum and sibling edges within 2 cm', () => {
    const items = ITEMS.map((item) => (item.uid === 'm2' ? { ...item, xCm: 146, yCm: 104 } : item));
    const guides = computeSmartGuides(WALL, items, 'm2');
    const centre = guides.find((g) => g.kind === 'wall-centre');
    expect(centre).toMatchObject({ axis: 'x', at: 150, edge: 'center-x', delta: 1, from: 0, to: 250 });
    const eye = guides.find((g) => g.kind === 'eye-level');
    expect(eye).toMatchObject({ axis: 'y', at: EYE_DATUM_CM, edge: 'center-y', delta: -1 });
    // Bottom at 104 sits 4 cm off the cube's bottom edge: outside tolerance.
    expect(guides.find((g) => g.kind === 'module' && g.axis === 'y' && g.at === 100)).toBeUndefined();
    const near = computeSmartGuides(WALL, items.map((item) => (item.uid === 'm2' ? { ...item, yCm: 101 } : item)), ['m2']);
    expect(near.find((g) => g.kind === 'module' && g.at === 100)).toMatchObject({ edge: 'bottom', delta: 1, targets: ['m1'] });
    expect(computeSmartGuides(WALL, ITEMS, ['m2']).some((g) => Math.abs(g.delta) > 2)).toBe(false);
    expect(computeSmartGuides(WALL, ITEMS, [])).toEqual([]);
  });
});
