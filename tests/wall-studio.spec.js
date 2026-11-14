import { expect, test } from '@playwright/test';
import { PRODUCTS } from '../src/data/products.js';
import { WALL_PRESETS } from '../src/data/wall-presets.js';
import {
  aggregateBagLines,
  commitHistory,
  createHistory,
  createLayout,
  cutsSlope,
  findConflicts,
  HISTORY_LIMIT,
  layoutFromPreset,
  MAX_WALL_ITEMS,
  mountProduct,
  redoHistory,
  sanitizeLayout,
  undoHistory,
  updateWall,
} from '../src/lib/wall-studio.js';

// The 2D Wall Studio page is retired: every wall is planned in the 3D Room
// Planner. The wall layout engine stays, because the room's walls, the
// blueprint sheet, legacy ?scene= links and saved wall projects all run
// through it, so its model is covered here in Node.

test.describe('wall studio model', () => {
  test('every preset is collision-free and inside its wall', () => {
    expect(WALL_PRESETS.map((preset) => preset.name)).toEqual([
      'Nordic Reading Wall',
      'Acoustic Media Spine',
      'Attic Study Alcove',
    ]);
    for (const preset of WALL_PRESETS) {
      const layout = layoutFromPreset(preset.id);
      expect(findConflicts(layout).size, preset.name).toBe(0);
      expect(sanitizeLayout(JSON.parse(JSON.stringify(layout))), preset.name).toEqual(layout);
    }
  });

  test('auto placement never collides while the wall has room', () => {
    let layout = createLayout();
    for (let round = 0; round < 3; round += 1) {
      for (const product of PRODUCTS) {
        const result = mountProduct(layout, product.id);
        if (!result?.clear) continue;
        layout = result.layout;
        expect(findConflicts(layout).size, `${product.id} round ${round}`).toBe(0);
      }
    }
    expect(layout.items.length).toBeGreaterThan(12);
    expect(layout.items.length).toBeLessThanOrEqual(MAX_WALL_ITEMS);
  });

  test('slope test is exact on the hypotenuse and resizing pulls modules inside', () => {
    const wall = { widthCm: 300, heightCm: 250, slope: true };
    // Hypotenuse: x + y = 300 + 250 - 90 = 460. A 10 x 10 box touching it is clear.
    expect(cutsSlope({ x: 220, y: 220, w: 10, h: 10 }, wall)).toBe(false);
    expect(cutsSlope({ x: 221, y: 220, w: 10, h: 10 }, wall)).toBe(true);
    expect(cutsSlope({ x: 221, y: 220, w: 10, h: 10 }, { ...wall, slope: false })).toBe(false);

    const layout = layoutFromPreset('nordic-reading-wall');
    const narrow = updateWall(layout, { widthCm: 180, heightCm: 200 });
    const track = narrow.items.find((item) => item.productId === 'track-bus-200');
    expect(track).toMatchObject({ xCm: 0, yCm: 197 });
    expect(findConflicts(narrow).get(track.uid).bounds).toBe(true);
    expect(updateWall(layout, { widthCm: 300 })).toBe(layout);
  });

  test('history keeps 30 steps and a new edit clears redo', () => {
    let history = createHistory(createLayout());
    for (let i = 1; i <= HISTORY_LIMIT + 5; i += 1) {
      history = commitHistory(history, updateWall(history.present, { widthCm: 180 + i }));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.present.wall.widthCm).toBe(180 + HISTORY_LIMIT + 5);

    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) history = undoHistory(history);
    expect(history.past).toHaveLength(0);
    expect(history.present.wall.widthCm).toBe(185);
    expect(history.future).toHaveLength(HISTORY_LIMIT);

    history = redoHistory(history);
    expect(history.present.wall.widthCm).toBe(186);
    history = commitHistory(history, updateWall(history.present, { heightCm: 300 }));
    expect(history.future).toHaveLength(0);
    expect(commitHistory(history, history.present)).toBe(history);
  });

  test('aggregates modules into bag lines by part and finish', () => {
    expect(
      aggregateBagLines([
        { productId: 'modular-cube-36', finish: 'oak' },
        { productId: 'floating-shelf-110', finish: 'walnut' },
        { productId: 'modular-cube-36', finish: 'oak' },
        { productId: 'modular-cube-36', finish: 'chalk' },
      ]),
    ).toEqual([
      { id: 'modular-cube-36', finish: 'oak', qty: 2 },
      { id: 'floating-shelf-110', finish: 'walnut', qty: 1 },
      { id: 'modular-cube-36', finish: 'chalk', qty: 1 },
    ]);
  });
});
