import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import { SESSION_STORAGE_KEY } from '../src/lib/auth.js';
import { accountDiffSources, plannerDiffSources } from '../src/lib/diff-sources.js';
import { formatInt, formatUsd } from '../src/lib/format.js';
import { compareProjectStates, formatSignedDelta, pairModules } from '../src/lib/project-diff.js';
import { projectIdFor } from '../src/lib/project-library.js';
import { createRoomState, ROOM_STORAGE_KEY, serializeRoomState, updateRoomItem } from '../src/lib/room-3d.js';
import {
  createLayout,
  mountProduct,
  serializeLayout,
  updateItem,
  WALL_STORAGE_KEY,
} from '../src/lib/wall-studio.js';
import { holdProjectSaves } from './support/cloud-gates.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const SESSION_KEY = `lumen:${SESSION_STORAGE_KEY}`;
const GUEST = { name: 'Studio Guest', email: 'guest@lumen.com' };

const ITEMS = [
  { uid: 'm1', productId: 'floating-shelf-110', finish: 'walnut', xCm: 40, yCm: 150, led: true, locked: false },
  { uid: 'm2', productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 40, yCm: 200, led: true, locked: false },
  { uid: 'm3', productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 200, yCm: 60, led: true, locked: false },
];
// 300 / 250 on the wall and 300 / 280 / 250 in the room: three-digit values in every dimension well.
const WALL = createLayout({ widthCm: 300, heightCm: 250, surface: 'ambient' }, ITEMS);
const ROOM = createRoomState(
  { widthCm: 300, depthCm: 280, heightCm: 250, furniture: 'none', lighting: 'night' },
  ITEMS.map(({ locked, ...item }) => item),
);

const PLANNERS = [
  {
    path: '/studio-2d',
    key: WALL_KEY,
    data: serializeLayout(WALL),
    disclosure: 'wall-dimensions',
    fields: { 'wall-width': '300', 'wall-height': '250' },
    save: 'save-wall-to-cloud',
    sync: 'sync-wall-to-bag',
  },
  {
    path: '/room-3d',
    key: ROOM_KEY,
    data: serializeRoomState(ROOM),
    disclosure: 'room-dimensions',
    fields: { 'room-width': '300', 'room-depth': '280', 'room-height': '250' },
    save: 'save-room-to-cloud',
    sync: 'sync-room-to-bag',
    settle: settleWorkstation,
  },
];

async function seed(page, entries) {
  await page.goto('/');
  await page.evaluate((pairs) => {
    for (const [key, value] of pairs) localStorage.setItem(key, JSON.stringify(value));
  }, entries);
}

/**
 * The room planner's engine boot lifts with a 0.99 to 1 settle scale on the
 * workstation. Two box reads that straddle a frame of it disagree by a pixel,
 * so layout is measured once the workstation has landed at full size.
 */
async function settleWorkstation(page) {
  const workstation = page.locator('.room3d-workstation');
  await expect(workstation).toHaveAttribute('data-boot', 'done', { timeout: 20_000 });
  await expect.poll(() => workstation.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
}

function wallModule(page, uid) {
  return page.locator(`[data-testid="wall-module"][data-uid="${uid}"]`);
}

function diffModal(page) {
  return page.getByTestId('project-diff-modal');
}

/** Text width of the input's value in its own font, and the clear space either side of it. */
function measureWell(input) {
  return input.evaluate((el) => {
    const style = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.textContent = el.value;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    // The computed `font` shorthand can serialize empty, so the longhands are copied one by one.
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'letterSpacing']) {
      probe.style[prop] = style[prop];
    }
    document.body.append(probe);
    const textWidth = probe.getBoundingClientRect().width;
    probe.remove();
    const padLeft = parseFloat(style.paddingLeft);
    const padRight = parseFloat(style.paddingRight);
    return {
      appearance: style.appearance,
      numeric: style.fontVariantNumeric,
      padLeft,
      padRight,
      spare: el.clientWidth - padLeft - padRight - textWidth,
      overflow: el.scrollWidth - el.clientWidth,
    };
  });
}

// The minifier may split the vendor-prefixed selector list into one rule per pseudo-element.
function spinRulesShip(page) {
  return page.evaluate(() => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    });
    const hides = (pseudo) =>
      rules.some((rule) => rule.selectorText?.includes(`[type="number"]${pseudo}`) && rule.style.display === 'none');
    return hides('::-webkit-inner-spin-button') && hides('::-webkit-outer-spin-button');
  });
}

/** Icon and label as one centred unit: equal side gaps, an 8px gap between them, both on the midline. */
function measureKey(button, iconSelector, labelSelector) {
  return button.evaluate(
    (el, [iconSel, labelSel]) => {
      const box = el.getBoundingClientRect();
      const icon = el.querySelector(iconSel).getBoundingClientRect();
      const label = el.querySelector(labelSel).getBoundingClientRect();
      const left = Math.min(icon.left, label.left);
      const right = Math.max(icon.right, label.right);
      const mid = box.top + box.height / 2;
      return {
        sideDelta: Math.abs(left - box.left - (box.right - right)),
        gap: Math.max(label.left - icon.right, icon.left - label.right),
        iconMid: Math.abs(icon.top + icon.height / 2 - mid),
        labelMid: Math.abs(label.top + label.height / 2 - mid),
      };
    },
    [iconSelector, labelSelector],
  );
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('ui polish regression guards', () => {
  for (const planner of PLANNERS) {
    test(`${planner.path}: dimension wells hide native spin keys and clear every three-digit value`, async ({ page }) => {
      const errors = collectRuntimeErrors(page);
      await seed(page, [[planner.key, planner.data]]);
      await page.goto(planner.path);
      await page.getByTestId(planner.disclosure).getByRole('button').click();

      expect(await spinRulesShip(page)).toBe(true);
      for (const [testId, value] of Object.entries(planner.fields)) {
        const input = page.getByTestId(testId);
        await expect(input).toBeVisible();
        await expect(input).toHaveValue(value);
        const well = await measureWell(input);
        expect(well.appearance, testId).toBe('none');
        expect(well.numeric, testId).toContain('tabular-nums');
        expect(well.padLeft, testId).toBeGreaterThanOrEqual(12);
        expect(well.padRight, testId).toBeGreaterThanOrEqual(12);
        expect(well.spare, testId).toBeGreaterThanOrEqual(12);
        expect(well.overflow, testId).toBeLessThanOrEqual(0);
      }

      // Keyboard stepping survives without the spin keys.
      const [firstId, firstValue] = Object.entries(planner.fields)[0];
      const first = page.getByTestId(firstId);
      await first.focus();
      await page.keyboard.press('ArrowDown');
      await expect(first).toHaveValue(String(Number(firstValue) - 1));
      await page.keyboard.press('Escape');
      await expect(first).toHaveValue(firstValue);
      expect(errors).toEqual([]);
    });

    test(`${planner.path}: save and cart keys match in height, centre their content and never overlap`, async ({ page }) => {
      await seed(page, [[planner.key, planner.data]]);
      await page.goto(planner.path);
      const save = page.getByTestId(planner.save);
      const sync = page.getByTestId(planner.sync);
      await expect(save).toHaveAccessibleName('Save to Cloud');
      await planner.settle?.(page);

      const a = await save.boundingBox();
      const b = await sync.boundingBox();
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      expect(a.height).toBeCloseTo(38, 0);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(a.x + a.width).toBeLessThanOrEqual(b.x);

      // Both keys sit under the project row, which carries the name well and the compare key.
      const name = await page.getByTestId('project-name-input').boundingBox();
      expect(a.y).toBeGreaterThan(name.y + name.height);
      const compare = await page.getByTestId('open-draft-diff').boundingBox();
      expect(compare.height).toBeCloseTo(38, 0);

      const idle = await measureKey(save, '.cloud-save__icon', '.cloud-save__label');
      expect(idle.sideDelta).toBeLessThanOrEqual(2);
      expect(idle.gap).toBeCloseTo(8, 0);
      expect(idle.iconMid).toBeLessThanOrEqual(1.5);
      expect(idle.labelMid).toBeLessThanOrEqual(1.5);
      const cart = await measureKey(sync, 'svg', 'svg');
      expect(cart.iconMid).toBeLessThanOrEqual(1.5);

      // The key holds its width and keeps the unit centred while saving. The save is held in
      // flight until the busy key has been measured, so a loaded runner cannot finish it first.
      const release = await holdProjectSaves(page);
      await save.click();
      await expect(save).toHaveAttribute('data-state', 'saving');
      expect((await save.boundingBox()).width).toBeCloseTo(a.width, 0);
      const busy = await measureKey(save, '.cloud-save__icon', '.cloud-save__label');
      expect(busy.sideDelta).toBeLessThanOrEqual(2);
      release();
      await expect(save).toHaveAttribute('data-state', 'saved');

      // Stacked on a phone, the keys still never overlap.
      await page.setViewportSize({ width: 360, height: 900 });
      const sa = await save.boundingBox();
      const sb = await sync.boundingBox();
      expect(Math.abs(sa.height - sb.height)).toBeLessThanOrEqual(1);
      expect(sb.y).toBeGreaterThanOrEqual(sa.y + sa.height);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('switch labels hold one line and palette units never break from their figures', async ({ page }) => {
    await seed(page, [[WALL_KEY, serializeLayout(WALL)], [ROOM_KEY, serializeRoomState(ROOM)]]);
    await page.goto('/studio-2d');

    // Line boxes are counted on a Range: a flex item reports one rect even when its text wraps.
    const slope = page.getByRole('switch', { name: /Attic slope/ });
    const fit = await slope.evaluate((el) => {
      const label = el.querySelector('.studio-switch__label');
      const hint = el.querySelector('.studio-switch__hint');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
        labelHeight: label.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(label).lineHeight),
        hintClipped: hint.scrollWidth > hint.clientWidth,
      };
    });
    expect(fit.lines).toBe(1);
    expect(fit.labelHeight).toBeLessThanOrEqual(fit.lineHeight * 1.2);
    expect(fit.hintClipped).toBe(false);

    for (const [path, list] of [
      ['/studio-2d', '.studio-palette .palette-list'],
      ['/room-3d', '[data-testid="room-palette"]'],
    ]) {
      if (path !== '/studio-2d') await page.goto(path);
      const metas = page.locator(`${list} .palette-item__meta`);
      await expect(metas.first()).toBeVisible();
      const pieces = await metas.evaluateAll((nodes) =>
        nodes.flatMap((node) =>
          [...node.children].map((span) => {
            const range = document.createRange();
            range.selectNodeContents(span);
            return { text: span.textContent, lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size };
          }),
        ),
      );
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) expect(piece.lines, `${path} ${piece.text}`).toBe(1);
      expect(pieces.some((piece) => /^\d+ W$/.test(piece.text))).toBe(true);
    }
  });
});

test.describe('project diff engine', () => {
  test('reports KPI deltas and classifies added, removed, modified and unchanged modules', () => {
    let draft = mountProduct(WALL, 'modular-cube-36').layout;
    draft = updateItem(draft, 'm1', { finish: 'oak', xCm: 65 });
    draft = updateItem(draft, 'm2', { dimPct: 60 });
    draft = { ...draft, items: draft.items.filter((item) => item.uid !== 'm3') };

    const record = { id: 'wall', kind: 'wall', name: 'Wall A', revision: 1, savedAt: '2026-11-11T10:00:00.000Z', data: WALL };
    const diff = compareProjectStates(record, draft);
    const cube = getProduct('modular-cube-36');
    const frame = getProduct('acoustic-art-frame-50x70');

    expect(diff.kinds).toEqual({ base: 'wall', target: 'wall' });
    expect(diff.deltas.modules).toEqual({ base: 3, target: 3, delta: 0 });
    expect(diff.deltas.priceUsd.delta).toBe(cube.priceUsd - frame.priceUsd);
    expect(diff.deltas.loadW.delta).toBe(cube.watts - frame.watts);
    expect(Object.keys(diff.deltas)).toEqual(['modules', 'loadW', 'activeW', 'fluxLm', 'priceUsd', 'luxAvg', 'rt60Sec', 'stiScore']);
    for (const delta of Object.values(diff.deltas)) {
      expect(delta.delta).toBeCloseTo(delta.target - delta.base, 6);
    }
    // Swapping the felt-backed frame for a cube removes absorption: the decay lengthens.
    expect(diff.deltas.rt60Sec.delta).toBeGreaterThan(0);

    expect(diff.changes.added.map((entry) => [entry.productId, entry.uid])).toEqual([['modular-cube-36', 'm4']]);
    expect(diff.changes.removed.map((entry) => [entry.productId, entry.uid])).toEqual([['acoustic-art-frame-50x70', 'm3']]);
    expect(diff.changes.modified.map((entry) => [entry.uid, entry.fields, entry.summary])).toEqual([
      ['m1', ['position', 'finish'], 'Moved +25 cm X / Finish Walnut to Oak'],
      ['m2', ['dimPct'], 'Dimmed 100% to 60%'],
    ]);
    expect(diff.changes.unchanged).toBe(0);
    expect(diff.identical).toBe(false);

    // Deterministic, and B against A mirrors A against B.
    expect(compareProjectStates(record, draft)).toEqual(diff);
    const back = compareProjectStates(draft, record);
    for (const [key, delta] of Object.entries(diff.deltas)) expect(back.deltas[key].delta).toBeCloseTo(-delta.delta, 6);
    expect(back.changes.added.map((entry) => entry.uid)).toEqual(['m3']);
    expect(back.changes.removed.map((entry) => entry.uid)).toEqual(['m4']);
    expect(back.changes.modified.map((entry) => entry.summary)).toEqual([
      'Moved -25 cm X / Finish Oak to Walnut',
      'Raised 60% to 100%',
    ]);

    const same = compareProjectStates(WALL, serializeLayout(WALL));
    expect(same.identical).toBe(true);
    expect(same.changes.unchanged).toBe(3);
  });

  test('pairs reissued uids by part and wall, reads rooms and treats unreadable input as empty', () => {
    // A cross-project compare: uids differ, so modules pair by part on the same wall, nearest first.
    const renumbered = createLayout(WALL.wall, [
      { ...ITEMS[1], uid: 'm7' },
      { ...ITEMS[0], uid: 'm9', xCm: 50 },
    ]);
    expect(pairModules(WALL.items, renumbered.items)).toEqual([
      [1, 0],
      [0, 1],
    ]);
    const crossed = compareProjectStates(WALL, renumbered);
    expect(crossed.changes.modified.map((entry) => [entry.baseUid, entry.uid, entry.summary])).toEqual([
      ['m1', 'm9', 'Moved +10 cm X'],
    ]);
    expect(crossed.changes.removed.map((entry) => entry.uid)).toEqual(['m3']);
    expect(crossed.changes.unchanged).toBe(1);

    const rehung = updateRoomItem(ROOM, 'm2', { wall: 'east' });
    const roomDiff = compareProjectStates(ROOM, { ...rehung, room: { ...rehung.room, lighting: 'daylight' } });
    expect(roomDiff.kinds).toEqual({ base: 'room', target: 'room' });
    expect(roomDiff.changes.modified).toHaveLength(1);
    expect(roomDiff.changes.modified[0]).toMatchObject({ uid: 'm2', wall: 'east', fields: ['wall'] });
    expect(roomDiff.changes.modified[0].summary).toBe('Rehung North Wall to East Wall');
    expect(roomDiff.envelope).toEqual([
      { field: 'Lighting', from: 'Night Ambient (2700K)', to: 'Daylight Studio', text: 'Lighting Night Ambient (2700K) to Daylight Studio' },
    ]);

    // Tampered or foreign input compares as an empty project of the other side's kind.
    const hostile = JSON.parse('{"kind":"wall","data":{"format":"lumen.wall","version":1,"__proto__":{"polluted":true},"items":[{"uid":"<img src=x onerror=alert(1)>","productId":"floating-shelf-110","finish":"walnut","xCm":10,"yCm":10}]}}');
    const fromHostile = compareProjectStates(hostile, WALL);
    expect({}.polluted).toBeUndefined();
    expect(fromHostile.subjects.base.state.items.map((item) => item.uid)).toEqual(['m1']);
    const fromNothing = compareProjectStates({ kind: 'wall', data: { format: 'evil' } }, ROOM);
    expect(fromNothing.kinds.base).toBe('room');
    expect(fromNothing.changes.added).toHaveLength(ROOM.items.length);
    expect(fromNothing.deltas.modules).toEqual({ base: 0, target: 3, delta: 3 });
    expect(formatSignedDelta(-0.04, 2)).toBe('-0.04');
    expect(formatSignedDelta(140, 0, formatUsd)).toBe('+$140');
    expect(formatSignedDelta(0)).toBe('0');
  });

  test('planner and account sources pick the right baseline and target', () => {
    const rev = { id: 'wall', kind: 'wall', name: 'Wall A', revision: 2, savedAt: '2026-11-11T10:00:00.000Z', data: WALL };
    const other = { ...rev, id: 'wall-plan-b', name: 'Plan B', savedAt: '2026-11-11T11:00:00.000Z' };
    const room = { id: 'room', kind: 'room', name: 'Room', revision: 1, savedAt: '2026-11-11T09:00:00.000Z', data: ROOM };

    expect(plannerDiffSources('wall', WALL, 'Wall A', [other, rev, room])).toMatchObject({ baseId: 'cloud:wall', targetId: 'draft:wall' });
    expect(plannerDiffSources('wall', WALL, 'Unsaved Name', [other, rev, room])).toMatchObject({ baseId: 'baseline:wall' });
    expect(plannerDiffSources('wall', WALL, 'Unsaved Name', [other, rev], other)).toMatchObject({ baseId: 'cloud:wall-plan-b' });
    expect(plannerDiffSources('room', ROOM, 'Room', []).sources.map((source) => source.id)).toEqual(['draft:room', 'baseline:room']);

    const drafts = { wall: { state: WALL, name: 'Wall A' }, room: { state: ROOM, name: 'Room' } };
    const projects = [other, rev, room];
    expect(accountDiffSources(projects, drafts, null)).toMatchObject({ baseId: 'cloud:wall', targetId: 'cloud:wall-plan-b' });
    expect(accountDiffSources(projects, drafts, 'wall-plan-b')).toMatchObject({ baseId: 'cloud:wall-plan-b', targetId: 'cloud:wall' });
    expect(accountDiffSources(projects, drafts, 'room')).toMatchObject({ baseId: 'cloud:room', targetId: 'cloud:wall-plan-b' });
    expect(accountDiffSources([room], drafts, 'room')).toMatchObject({ baseId: 'cloud:room', targetId: 'draft:room' });
    expect(accountDiffSources(projects, drafts).sources.map((source) => source.id)).toEqual([
      'cloud:wall-plan-b',
      'cloud:wall',
      'cloud:room',
      'draft:wall',
      'draft:room',
    ]);
  });
});

test.describe('project diff dialog', () => {
  test('wall studio: Rev 01, then add, refinish and dim, and the draft diff itemizes every change', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await seed(page, [[WALL_KEY, serializeLayout(WALL)]]);
    await page.goto('/studio-2d');

    const save = page.getByTestId('save-wall-to-cloud');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    await expect(page.getByTestId('toast-message').last()).toHaveText('Wall A saved to Lumen Cloud. Revision 01.');

    await page.getByRole('button', { name: 'Mount Modular Cube 36' }).click();
    await expect(page.getByTestId('wall-module')).toHaveCount(4);
    await wallModule(page, 'm1').click();
    await page.getByTestId('studio-inspector').getByRole('radio', { name: 'Oak' }).check();
    await expect(wallModule(page, 'm1')).toHaveAttribute('data-finish', 'oak');
    await wallModule(page, 'm2').click();
    await page.getByTestId('module-dim-slider').fill('60');
    await expect(wallModule(page, 'm2')).toHaveAttribute('data-dim-pct', '60');

    let draft = mountProduct(WALL, 'modular-cube-36').layout;
    draft = updateItem(draft, 'm1', { finish: 'oak' });
    draft = updateItem(draft, 'm2', { dimPct: 60 });
    const expected = compareProjectStates(WALL, draft);
    const { deltas } = expected;
    expect(deltas.modules.delta).toBe(1);

    const trigger = page.getByTestId('open-draft-diff');
    await trigger.click();
    const modal = diffModal(page);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAccessibleName('Project comparison');
    await expect(modal.getByTestId('diff-select-base')).toHaveValue('cloud:wall');
    await expect(modal.getByTestId('diff-select-target')).toHaveValue('draft:wall');
    await expect(modal.getByTestId('diff-select-base').locator('option:checked')).toHaveText('Wall A / Rev 01');

    const kpi = (key) => modal.getByTestId(`diff-kpi-${key}-value`);
    await expect(modal.getByTestId('diff-kpi-modules')).toHaveAttribute('data-delta', '1');
    await expect(kpi('modules')).toHaveText('+1');
    await expect(kpi('price')).toHaveText(`+${formatUsd(getProduct('modular-cube-36').priceUsd)}`);
    await expect(kpi('load')).toHaveText(`+${getProduct('modular-cube-36').watts} W`);
    await expect(kpi('lux')).toHaveText(`${formatSignedDelta(deltas.luxAvg.delta, 0, formatInt)} lx`);
    await expect(kpi('rt60')).toHaveText(`${formatSignedDelta(deltas.rt60Sec.delta, 2)} s`);
    await expect(kpi('sti')).toHaveText(formatSignedDelta(deltas.stiScore.delta, 2));
    await expect(modal.getByTestId('diff-kpi-rt60')).toHaveAttribute('data-delta', String(deltas.rt60Sec.delta));

    const list = modal.getByTestId('diff-change-list');
    await expect(list).toHaveAttribute('data-added', '1');
    await expect(list).toHaveAttribute('data-modified', '2');
    await expect(list).toHaveAttribute('data-removed', '0');
    await expect(list).toHaveAttribute('data-unchanged', '1');
    await expect(modal.getByTestId('diff-tally')).toHaveText('01 added / 00 removed / 02 modified / 01 unchanged');
    const added = list.locator('[data-change="added"]');
    await expect(added).toHaveCount(1);
    await expect(added).toContainText('Modular Cube 36');
    await expect(list.locator('[data-change="modified"][data-uid="m1"]')).toContainText('Finish Walnut to Oak');
    await expect(list.locator('[data-change="modified"][data-uid="m2"]')).toContainText('Dimmed 100% to 60%');
    await expect(modal.getByTestId('diff-thumb-b').locator('[data-diff="added"]')).toHaveCount(1);
    await expect(modal.getByTestId('diff-thumb-b').locator('[data-diff="modified"]')).toHaveCount(2);
    await expect(modal.getByTestId('diff-thumb-a').locator('[data-diff="modified"]')).toHaveCount(2);

    // Escape closes and returns focus to the compare key.
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('room planner: an unsaved draft compares against the clean baseline, then against Rev 01', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await seed(page, [[ROOM_KEY, serializeRoomState(ROOM)]]);
    await page.goto('/room-3d');

    await page.getByTestId('open-draft-diff').click();
    const modal = diffModal(page);
    await expect(modal.getByTestId('diff-select-base')).toHaveValue('baseline:room');
    await expect(modal.getByTestId('diff-kpi-modules-value')).toHaveText(`+${ROOM.items.length}`);
    await expect(modal.getByTestId('diff-change-list').locator('[data-change="added"]')).toHaveCount(ROOM.items.length);
    await modal.getByTestId('close-project-diff').click();
    await expect(modal).toHaveCount(0);

    const save = page.getByTestId('save-room-to-cloud');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');
    await page.locator('[data-testid="room-module-list"] [data-uid="m1"]').click();
    await page.getByTestId('room-inspector').getByRole('radio', { name: 'Oak' }).check();
    await page.getByTestId('module-dim-slider').fill('50');

    const draft = updateRoomItem(ROOM, 'm1', { finish: 'oak', dimPct: 50 });
    const expected = compareProjectStates(ROOM, draft);

    await page.getByTestId('open-draft-diff').click();
    await expect(modal.getByTestId('diff-select-base')).toHaveValue('cloud:room');
    await expect(modal.getByTestId('diff-kpi-modules-value')).toHaveText('0');
    await expect(modal.getByTestId('diff-kpi-modules')).toHaveAttribute('data-trend', 'flat');
    await expect(modal.getByTestId('diff-kpi-lux-value')).toHaveText(
      `${formatSignedDelta(expected.deltas.luxAvg.delta, 0, formatInt)} lx`,
    );
    expect(expected.deltas.luxAvg.delta).toBeLessThan(0);
    const rows = modal.getByTestId('diff-change');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-change', 'modified');
    await expect(rows.first()).toContainText('Floating Shelf 110');
    await expect(rows.first()).toContainText('Finish Walnut to Oak / Dimmed 100% to 50%');
    await expect(modal.getByTestId('diff-tally')).toHaveText('00 added / 00 removed / 01 modified / 02 unchanged');
    await modal.getByTestId('close-project-diff').click();
    expect(errors).toEqual([]);
  });

  test('account: compare two saved projects and the diff follows the baseline and target selects', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await seed(page, [
      [SESSION_KEY, GUEST],
      [WALL_KEY, serializeLayout(WALL)],
    ]);
    await page.goto('/studio-2d');
    const name = page.getByTestId('project-name-input');
    const save = page.getByTestId('save-wall-to-cloud');

    await name.fill('Plan A');
    await name.press('Enter');
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');

    await page.getByRole('button', { name: 'Mount Modular Cube 36' }).click();
    await wallModule(page, 'm1').click();
    await page.getByTestId('studio-inspector').getByRole('radio', { name: 'Oak' }).check();
    await name.fill('Plan B');
    await name.press('Enter');
    await expect(save).toHaveAttribute('data-state', 'idle', { timeout: 5000 });
    await save.click();
    await expect(save).toHaveAttribute('data-state', 'saved');

    const planB = updateItem(mountProduct(WALL, 'modular-cube-36').layout, 'm1', { finish: 'oak' });
    const forward = compareProjectStates(WALL, planB);
    const backward = compareProjectStates(planB, WALL);
    const idA = projectIdFor('wall', 'Plan A');
    const idB = projectIdFor('wall', 'Plan B');

    await page.goto('/account');
    await expect(page.getByTestId('saved-project')).toHaveCount(2);

    // The panel key compares the two newest, older as A.
    await page.getByTestId('open-project-compare').click();
    const modal = diffModal(page);
    await expect(modal.getByTestId('diff-select-base')).toHaveValue(`cloud:${idA}`);
    await expect(modal.getByTestId('diff-select-target')).toHaveValue(`cloud:${idB}`);
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    const cardA = page.locator(`[data-testid="saved-project"][data-project-id="${idA}"]`);
    await cardA.getByTestId('compare-saved-project').click();
    await expect(modal).toBeVisible();
    const base = modal.getByTestId('diff-select-base');
    const target = modal.getByTestId('diff-select-target');
    await expect(base).toHaveValue(`cloud:${idA}`);
    await expect(target).toHaveValue(`cloud:${idB}`);
    await expect(target.locator('option')).toHaveText([
      'Wall Studio draft / Plan B',
      'Room Planner draft / Room',
      'Plan B / Rev 01',
      'Plan A / Rev 01',
    ]);

    const tally = modal.getByTestId('diff-tally');
    const read = async () => ({
      tally: await tally.textContent(),
      modules: await modal.getByTestId('diff-kpi-modules-value').textContent(),
      price: await modal.getByTestId('diff-kpi-price-value').textContent(),
      rows: await modal.getByTestId('diff-change').allTextContents(),
    });
    await expect(tally).toHaveText('01 added / 00 removed / 01 modified / 02 unchanged');
    await expect(modal.getByTestId('diff-kpi-modules-value')).toHaveText('+1');
    await expect(modal.getByTestId('diff-kpi-price-value')).toHaveText(
      formatSignedDelta(forward.deltas.priceUsd.delta, 0, formatUsd),
    );
    await expect(modal.getByTestId('diff-change').filter({ hasText: 'Finish Walnut to Oak' })).toHaveCount(1);
    const first = await read();

    // Switching A and B through the selects reverses the diff.
    await base.selectOption(`cloud:${idB}`);
    await target.selectOption(`cloud:${idA}`);
    await expect(tally).toHaveText('00 added / 01 removed / 01 modified / 02 unchanged');
    await expect(modal.getByTestId('diff-kpi-modules-value')).toHaveText('-1');
    await expect(modal.getByTestId('diff-kpi-price-value')).toHaveText(
      formatSignedDelta(backward.deltas.priceUsd.delta, 0, formatUsd),
    );
    await expect(modal.getByTestId('diff-change').filter({ hasText: 'Finish Oak to Walnut' })).toHaveCount(1);
    await expect(modal.getByTestId('diff-thumb-a').locator('.diff-thumb__name')).toHaveText('Plan B');

    // Swap restores the first pairing, and the same pair always reads the same.
    await modal.getByTestId('diff-swap').click();
    await expect(base).toHaveValue(`cloud:${idA}`);
    await expect(target).toHaveValue(`cloud:${idB}`);
    await expect(tally).toHaveText(first.tally);
    expect(await read()).toEqual(first);

    // The live draft is a target too; it matches Plan B, which it was saved as.
    await base.selectOption(`cloud:${idB}`);
    await target.selectOption('draft:wall');
    await expect(modal.getByTestId('diff-identical')).toHaveText('No differences. B matches A module for module.');
    await expect(modal.getByTestId('diff-kpi-modules')).toHaveAttribute('data-trend', 'flat');

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    await modal.getByTestId('close-project-diff').click();
    await expect(cardA.getByTestId('compare-saved-project')).toBeFocused();
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});
