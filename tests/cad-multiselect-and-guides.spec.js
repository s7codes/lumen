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
} from '../src/lib/wall-studio.js';

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
const SIZE = Object.fromEntries(ITEMS.map((item) => [item.uid, getProduct(item.productId).dimsCm]));

// Marquee selection, alignment and smart guides drove the retired 2D Wall Studio
// canvas. The 3D Room Planner and the agent tools still call the same group
// operations on wall layouts, so the model stays covered here in Node.

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
