import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import {
  BLUEPRINT_ISSUER,
  blueprintFilename,
  buildBlueprintSvg,
  compileBlueprintSheet,
  DRAWING_NUMBER,
  escapeXml,
} from '../src/lib/blueprint-sheet.js';
import { computeBusTopology } from '../src/lib/bus-topology.js';
import { buildBlueprintDxf, DXF_LAYERS, dxfText } from '../src/lib/dxf-export.js';
import { ACTIVE_NAMES_STORAGE_KEY } from '../src/lib/project-library.js';
import { createLayout, moveModules, serializeLayout, WALL_STORAGE_KEY } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const WALL_KEY = `lumen:${WALL_STORAGE_KEY}`;
const NAMES_KEY = `lumen:${ACTIVE_NAMES_STORAGE_KEY}`;
const DATE = '2026-11-11';

const PAIR_WALL = createLayout({ widthCm: 300, heightCm: 250 }, [
  { uid: 'm1', productId: 'modular-cube-36', finish: 'oak', xCm: 200, yCm: 100, led: true, locked: false },
  { uid: 'm2', productId: 'floating-shelf-110', finish: 'walnut', xCm: 40, yCm: 150, led: true, locked: false },
]);

const SLOPE_WALL = createLayout({ widthCm: 320, heightCm: 260, slope: true }, [
  { uid: 'm1', productId: 'compact-sideboard-75', finish: 'oak', xCm: 30, yCm: 20, led: true, locked: false },
  { uid: 'm2', productId: 'acoustic-art-frame-50x70', finish: 'chalk', xCm: 130, yCm: 90, led: true, locked: false },
  { uid: 'm3', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 60, yCm: 248, led: true, locked: false },
  { uid: 'm4', productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 20, yCm: 180, led: true, locked: false },
]);

const PROJECT = 'Atelier "Nord" & Sons';

function anchorTuples(sheet) {
  return sheet.anchors.map((a) => [a.anchorId, a.moduleIndex, a.sku, a.xCm, a.yCm]);
}

/** DXF group/value pairs, codes as integers. */
function dxfPairs(text) {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  expect(lines.length % 2).toBe(0);
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1]]);
  return pairs;
}

/** Splits the ENTITIES section into { type, layer, codes } records. */
function dxfEntities(pairs) {
  const start = pairs.findIndex(([c, v], i) => c === 2 && v === 'ENTITIES' && pairs[i - 1][1] === 'SECTION');
  const entities = [];
  for (let i = start + 1; i < pairs.length; i += 1) {
    const [code, value] = pairs[i];
    if (code !== 0) continue;
    if (value === 'ENDSEC') break;
    const record = { type: value, codes: new Map() };
    for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j += 1) {
      if (!record.codes.has(pairs[j][0])) record.codes.set(pairs[j][0], pairs[j][1]);
    }
    record.layer = record.codes.get(8);
    entities.push(record);
  }
  return entities;
}

async function openStudioWith(page, layout, name) {
  await page.goto('/');
  await page.evaluate(
    ([wallKey, wall, namesKey, names]) => {
      localStorage.setItem(wallKey, wall);
      localStorage.setItem(namesKey, names);
    },
    [WALL_KEY, JSON.stringify(serializeLayout(layout)), NAMES_KEY, JSON.stringify({ wall: name, room: 'Room' })],
  );
  await page.goto('/studio-2d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
}

async function readWall(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="wall-canvas"]');
    return {
      wall: {
        widthCm: Number(canvas.dataset.widthCm),
        heightCm: Number(canvas.dataset.heightCm),
        slope: canvas.dataset.slope === 'true',
      },
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

async function openBlueprint(page) {
  await page.getByTestId('open-blueprint-sheet').click();
  const modal = page.getByRole('dialog', { name: 'Architectural blueprint sheet' });
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('data-testid', 'blueprint-sheet-modal');
  return modal;
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('blueprint sheet compiler', () => {
  test('anchors land at exact absolute wall coordinates in module reading order', () => {
    const sheet = compileBlueprintSheet(PAIR_WALL, { projectName: PROJECT, dateIso: DATE });

    // Shelf (h 8 cm): three cleat anchors on its centreline at quarter points.
    // Cube (h 36 cm): two frame anchors 5 cm below its top at third points.
    expect(sheet.modules.map((m) => [m.index, m.uid, m.sku])).toEqual([
      ['M01', 'm2', 'LMN-SH-110'],
      ['M02', 'm1', 'LMN-CB-036'],
    ]);
    expect(anchorTuples(sheet)).toEqual([
      ['A01', 'M01', 'LMN-SH-110', 67.5, 154],
      ['A02', 'M01', 'LMN-SH-110', 95, 154],
      ['A03', 'M01', 'LMN-SH-110', 122.5, 154],
      ['A04', 'M02', 'LMN-CB-036', 212, 131],
      ['A05', 'M02', 'LMN-CB-036', 224, 131],
    ]);
    expect(sheet.anchors.map((a) => a.hardware)).toEqual([
      'M8 x 100 cleat anchor',
      'M8 x 100 cleat anchor',
      'M8 x 100 cleat anchor',
      'M8 x 80 frame anchor',
      'M8 x 80 frame anchor',
    ]);
    expect(sheet.modules[0]).toMatchObject({ xCm: 40, yCm: 150, w: 110, h: 8, finish: 'Walnut', watts: 16 });

    const bus = computeBusTopology(PAIR_WALL);
    expect(sheet.bus).toMatchObject({
      totalRunM: bus.totalRunM,
      currentA: bus.currentA,
      voltageDropV: bus.voltageDropV,
      voltageDropPct: bus.voltageDropPct,
      origin: { xCm: bus.origin.xCm, yCm: bus.origin.yCm, label: 'PSU 24V FEED' },
    });
    expect(sheet.bus.segments).toHaveLength(bus.segments.length);
    for (const s of sheet.bus.segments) expect(s.x1 === s.x2 || s.y1 === s.y2).toBe(true);

    expect(sheet.titleBlock).toMatchObject({
      issuer: 'Lumen Spatial Studio Kft.',
      address: '1052 Budapest, Fenyiv utca 14, Hungary',
      projectName: PROJECT,
      drawingNumber: 'LMN-BP-01',
      scale: '1:20',
      revision: 'A',
      dateIso: DATE,
      moduleCount: 2,
      anchorCount: 5,
      loadW: 28,
      psu: '1x Lumen 60W 24V Driver',
    });
    expect(sheet.dimensions.width.valueCm).toBe(300);
    expect(sheet.dimensions.height.valueCm).toBe(250);
    expect(sheet.dimensions.chainX.map((s) => s.valueCm)).toEqual([40, 110, 50, 36, 64]);
    expect(sheet.dimensions.chainX.reduce((sum, s) => sum + s.valueCm, 0)).toBe(300);

    // Same input, same drawing.
    expect(compileBlueprintSheet(PAIR_WALL, { projectName: PROJECT, dateIso: DATE })).toEqual(sheet);
  });

  test('moving modules re-derives anchors and renumbers deterministically', () => {
    const shifted = moveModules(PAIR_WALL, ['m2'], -30, -90);
    const sheet = compileBlueprintSheet(shifted, { dateIso: DATE });
    expect(anchorTuples(sheet)).toEqual([
      ['A01', 'M01', 'LMN-SH-110', 37.5, 64],
      ['A02', 'M01', 'LMN-SH-110', 65, 64],
      ['A03', 'M01', 'LMN-SH-110', 92.5, 64],
      ['A04', 'M02', 'LMN-CB-036', 212, 131],
      ['A05', 'M02', 'LMN-CB-036', 224, 131],
    ]);

    // The cube moves left of the shelf: it becomes M01 and takes A01/A02.
    const swapped = moveModules(PAIR_WALL, ['m1'], -200, 50);
    const reordered = compileBlueprintSheet(swapped, { dateIso: DATE });
    expect(reordered.modules.map((m) => m.uid)).toEqual(['m1', 'm2']);
    expect(anchorTuples(reordered)).toEqual([
      ['A01', 'M01', 'LMN-CB-036', 12, 181],
      ['A02', 'M01', 'LMN-CB-036', 24, 181],
      ['A03', 'M02', 'LMN-SH-110', 67.5, 154],
      ['A04', 'M02', 'LMN-SH-110', 95, 154],
      ['A05', 'M02', 'LMN-SH-110', 122.5, 154],
    ]);
    expect(compileBlueprintSheet(swapped, { dateIso: DATE })).toEqual(reordered);
  });

  test('attic slope, ceiling fixings and every product id resolve on the sheet', () => {
    const sheet = compileBlueprintSheet(SLOPE_WALL, { dateIso: DATE, revision: 'b2' });
    expect(sheet.wall.outline).toEqual([
      { xCm: 0, yCm: 0 },
      { xCm: 320, yCm: 0 },
      { xCm: 320, yCm: 170 },
      { xCm: 230, yCm: 260 },
      { xCm: 0, yCm: 260 },
    ]);
    expect(sheet.wall.slopeCut).toEqual({ x1: 230, y1: 260, x2: 320, y2: 170 });
    expect(sheet.dimensions.slope).toEqual({ runCm: 90, riseCm: 90 });
    expect(sheet.titleBlock.revision).toBe('B2');

    const spot = sheet.anchors.find((a) => a.sku === 'LMN-SP-012');
    expect(spot).toMatchObject({ xCm: 66, yCm: 260, surface: 'ceiling', hardware: 'M6 x 60 ceiling anchor' });
    for (const a of sheet.anchors) {
      const mod = sheet.modules.find((m) => m.index === a.moduleIndex);
      expect(mod.sku).toBe(a.sku);
      expect(a.xCm).toBeGreaterThanOrEqual(mod.xCm);
      expect(a.xCm).toBeLessThanOrEqual(mod.xCm + mod.w);
      expect(a.yCm).toBeGreaterThanOrEqual(mod.yCm);
      expect(a.yCm).toBeLessThanOrEqual(mod.yCm + mod.h);
    }
    const expectedAnchors = SLOPE_WALL.items.reduce((sum, item) => sum + getProduct(item.productId).mountingPoints, 0);
    expect(sheet.anchors).toHaveLength(expectedAnchors);
    expect(sheet.anchors.map((a) => a.anchorId)).toEqual(
      Array.from({ length: expectedAnchors }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
    );

    // Unknown parts, non-finite coordinates and prototype keys never reach the drawing.
    const hostile = JSON.parse(
      '{"wall":{"widthCm":300,"heightCm":250},"items":[{"uid":"m1","productId":"__proto__","xCm":1,"yCm":1},' +
        '{"uid":"m2","productId":"modular-cube-36","xCm":"10","yCm":5},{"uid":"m3","productId":"modular-cube-36","xCm":10,"yCm":5}]}',
    );
    const safe = compileBlueprintSheet(hostile, { projectName: '\u0000\u0007  ', dateIso: '2026-02-30' });
    expect(safe.modules.map((m) => m.uid)).toEqual(['m3']);
    expect(safe.titleBlock.projectName).toBe('Wall A');
    expect(safe.titleBlock.dateIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(safe.titleBlock.dateIso).not.toBe('2026-02-30');
    expect(Object.prototype).not.toHaveProperty('sku');
  });

  test('buildBlueprintSvg XML-escapes the project name and every annotation', () => {
    const name = `Nord <Atelier> & "Sons" 'B' </text><script>alert(1)</script>`;
    const sheet = compileBlueprintSheet(PAIR_WALL, { projectName: name, dateIso: DATE });
    const svg = buildBlueprintSvg(sheet);

    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(escapeXml(sheet.titleBlock.projectName));
    expect(svg).toContain('Nord &lt;Atelier&gt; &amp; &quot;Sons&quot; &apos;B&apos;');
    expect(svg).not.toContain('<Atelier>');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('</text><script>');
    expect(svg).toMatch(/<title id="lumen-bp-title">Nord &lt;Atelier&gt;[^<]*<\/title>/);
    expect(svg).toMatch(/<desc id="lumen-bp-desc">[^<]+<\/desc>/);
    expect(svg).toContain('Lumen Spatial Studio Kft.');
    expect(svg).toContain('1052 Budapest, Fenyiv utca 14, Hungary');
    expect(svg).toContain(DRAWING_NUMBER);
    expect(svg).toContain('>1:20<');
    expect(svg).toContain('PSU 24V FEED');
    expect(svg).toContain('stroke-dasharray="1.6 0.8"');
    for (const a of sheet.anchors) expect(svg).toContain(`data-anchor="${a.anchorId}"`);
    expect(svg).not.toMatch(/[^\x09\x0A\x0D\x20-\x7E]/);

    expect(escapeXml(`a&b<c>"d"'e'\u0001`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    expect(blueprintFilename(PROJECT, 'svg')).toBe('atelier-nord-sons-blueprint.svg');
    expect(blueprintFilename('../../etc/passwd', 'dxf')).toBe('etc-passwd-blueprint.dxf');
  });

  test('dxfText keeps every token on one printable ASCII line', () => {
    expect(dxfText('Ny\u00e9k\r\n  0\nEOF\t%%c ^J')).toBe('Nyek 0 EOF %c ^ J');
    const sheet = compileBlueprintSheet(PAIR_WALL, { projectName: 'Line one\n  0\nEOF', dateIso: DATE });
    const dxf = buildBlueprintDxf(sheet);
    const pairs = dxfPairs(dxf);
    expect(pairs.filter(([code, value]) => code === 0 && value === 'EOF')).toHaveLength(1);
    expect(pairs.at(-1)).toEqual([0, 'EOF']);
    for (const [, value] of pairs) expect(value).toMatch(/^[\x20-\x7E]*$/);
  });
});

test.describe('blueprint sheet in /studio-2d', () => {
  test('the Blueprint dialog shows the 1:20 sheet, title block and drilling schedule and downloads the SVG', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openStudioWith(page, SLOPE_WALL, PROJECT);

    await page.getByRole('button', { name: 'Load preset Nordic Reading Wall' }).click();
    await expect(page.getByTestId('wall-module')).toHaveCount(9);

    const trigger = page.getByTestId('open-blueprint-sheet');
    await expect(trigger).toHaveText('Blueprint');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const modal = await openBlueprint(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const expected = compileBlueprintSheet(await readWall(page), { projectName: PROJECT, dateIso: DATE });
    expect(expected.anchors.length).toBeGreaterThan(9);

    const block = modal.getByTestId('blueprint-title-block');
    await expect(block).toContainText(BLUEPRINT_ISSUER.name);
    await expect(block).toContainText(BLUEPRINT_ISSUER.address);
    await expect(modal.getByTestId('blueprint-project-name')).toHaveText(PROJECT);
    await expect(modal.getByTestId('blueprint-scale')).toHaveText('1:20');
    await expect(block).toContainText(expected.titleBlock.psu);

    const preview = modal.getByTestId('blueprint-sheet-svg');
    const svg = preview.locator('svg');
    await expect(svg).toBeVisible();
    await expect(svg.locator('title')).toHaveText(new RegExp(`^${PROJECT} - LMN-BP-01 rev A - 1:20$`));
    await expect(svg.locator('#title-block')).toContainText('Lumen Spatial Studio Kft.');
    await expect(svg.locator('#title-block')).toContainText('1052 Budapest, Fenyiv utca 14, Hungary');
    await expect(svg.locator('#title-block')).toContainText(PROJECT);
    await expect(svg.locator('#title-block')).toContainText('1:20');
    await expect(svg.locator('[data-anchor]')).toHaveCount(expected.anchors.length);
    await expect(svg.locator('[data-module]')).toHaveCount(9);
    await expect(preview).toHaveAttribute('data-anchors', String(expected.anchors.length));

    const table = modal.getByTestId('drilling-schedule-table');
    await expect(table.locator('thead th')).toHaveText(['Anchor', 'Module', 'SKU', 'X (cm)', 'Y (cm)', 'Fixing']);
    const rows = table.getByTestId('drilling-schedule-row');
    await expect(rows).toHaveCount(expected.anchors.length);
    await expect(rows.locator('th')).toHaveText(expected.anchors.map((a) => a.anchorId));
    const first = expected.anchors[0];
    await expect(rows.first()).toHaveAttribute('data-anchor', 'A01');
    await expect(rows.first().locator('td')).toHaveText([
      first.moduleIndex,
      first.sku,
      first.xCm.toFixed(1),
      first.yCm.toFixed(1),
      first.hardware,
    ]);

    // Row focus marks the matching crosshair on the sheet.
    await rows.nth(2).hover();
    await expect(svg.locator('[data-anchor="A03"]')).toHaveAttribute('data-active', '');
    await expect(svg.locator('[data-anchor][data-active]')).toHaveCount(1);

    const downloadPromise = page.waitForEvent('download');
    await modal.getByTestId('download-blueprint-svg').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('atelier-nord-sons-blueprint.svg');
    const file = await readFile(await download.path(), 'utf8');
    expect(file.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(file).toContain('Lumen Spatial Studio Kft.');
    expect(file).toContain('Atelier &quot;Nord&quot; &amp; Sons');
    for (const a of expected.anchors) expect(file).toContain(`data-anchor="${a.anchorId}"`);
    await expect(page.getByTestId('toast').last()).toContainText(
      `Blueprint saved as atelier-nord-sons-blueprint.svg. ${expected.anchors.length} anchors at 1:20.`,
    );

    const parsed = await page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      return { error: doc.querySelector('parsererror') !== null, root: doc.documentElement.nodeName };
    }, file);
    expect(parsed).toEqual({ error: false, root: 'svg' });

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('moving a module updates the schedule coordinates', async ({ page }) => {
    await openStudioWith(page, PAIR_WALL, PROJECT);
    const cube = page.locator('[data-testid="wall-module"][data-uid="m1"]');
    await cube.click();
    await cube.press('Shift+ArrowRight');
    await cube.press('Shift+ArrowUp');
    await expect(cube).toHaveAttribute('data-x-cm', '210');
    await expect(cube).toHaveAttribute('data-y-cm', '110');

    const modal = await openBlueprint(page);
    const rows = modal.getByTestId('drilling-schedule-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(3).locator('td')).toHaveText(['M02', 'LMN-CB-036', '222.0', '141.0', 'M8 x 80 frame anchor']);
    await expect(rows.nth(4).locator('td')).toHaveText(['M02', 'LMN-CB-036', '234.0', '141.0', 'M8 x 80 frame anchor']);
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
  });

  test('the AutoCAD DXF download is a valid R12 drawing with every layer, anchor circle and SKU label', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await openStudioWith(page, SLOPE_WALL, PROJECT);
    await expect(page.getByTestId('wall-module')).toHaveCount(SLOPE_WALL.items.length);
    const modal = await openBlueprint(page);
    const expected = compileBlueprintSheet(await readWall(page), { projectName: PROJECT, dateIso: DATE });

    const downloadPromise = page.waitForEvent('download');
    await modal.getByTestId('download-blueprint-dxf').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('atelier-nord-sons-blueprint.dxf');
    await expect(page.getByTestId('toast').last()).toContainText(
      'AutoCAD drawing saved as atelier-nord-sons-blueprint.dxf. R12 DXF, 6 layers, units cm.',
    );

    const text = await readFile(await download.path(), 'utf8');
    expect(text).toMatch(/^[\x20-\x7E\r\n]*$/);
    const pairs = dxfPairs(text);

    const sections = pairs.flatMap(([code, value], i) =>
      code === 0 && value === 'SECTION' ? [pairs[i + 1][1]] : [],
    );
    expect(sections).toEqual(['HEADER', 'TABLES', 'ENTITIES']);
    expect(pairs.filter(([c, v]) => c === 0 && v === 'ENDSEC')).toHaveLength(3);
    expect(pairs.at(-1)).toEqual([0, 'EOF']);
    const version = pairs.findIndex(([c, v]) => c === 9 && v === '$ACADVER');
    expect(pairs[version + 1]).toEqual([1, 'AC1009']);

    const layerNames = pairs.flatMap(([code, value], i) =>
      code === 0 && value === 'LAYER' && pairs[i + 1][0] === 2 ? [pairs[i + 1][1]] : [],
    );
    expect(layerNames).toEqual([
      'LUMEN_WALL',
      'LUMEN_MODULES',
      'LUMEN_ANCHORS',
      'LUMEN_24V_BUS',
      'LUMEN_DIMS',
      'LUMEN_TITLEBLOCK',
    ]);
    expect(DXF_LAYERS.map((l) => l.name)).toEqual(layerNames);

    const entities = dxfEntities(pairs);
    const used = new Set(entities.map((e) => e.layer));
    for (const name of layerNames) expect(used.has(name)).toBe(true);

    const circles = entities.filter((e) => e.type === 'CIRCLE' && e.layer === 'LUMEN_ANCHORS');
    expect(circles).toHaveLength(expected.anchors.length);
    expected.anchors.forEach((a, i) => {
      expect(Number(circles[i].codes.get(10))).toBe(a.xCm);
      expect(Number(circles[i].codes.get(20))).toBe(a.yCm);
      expect(Number(circles[i].codes.get(40))).toBeGreaterThan(0);
    });
    const anchorLabels = entities.filter((e) => e.type === 'TEXT' && e.layer === 'LUMEN_ANCHORS').map((e) => e.codes.get(1));
    expect(anchorLabels).toEqual(expected.anchors.map((a) => a.anchorId));

    const moduleLabels = entities.filter((e) => e.type === 'TEXT' && e.layer === 'LUMEN_MODULES').map((e) => e.codes.get(1));
    expect(moduleLabels).toEqual(expected.modules.map((m) => `${m.index} ${m.sku}`));
    for (const m of expected.modules) {
      const outline = entities.filter(
        (e) =>
          e.type === 'LINE' &&
          e.layer === 'LUMEN_MODULES' &&
          Number(e.codes.get(10)) === m.xCm &&
          Number(e.codes.get(20)) === m.yCm,
      );
      expect(outline.length).toBeGreaterThan(0);
    }

    const wallLines = entities.filter((e) => e.type === 'LINE' && e.layer === 'LUMEN_WALL');
    const slopeCut = wallLines.find(
      (e) =>
        Number(e.codes.get(10)) === 320 &&
        Number(e.codes.get(20)) === 170 &&
        Number(e.codes.get(11)) === 230 &&
        Number(e.codes.get(21)) === 260,
    );
    expect(slopeCut).toBeTruthy();

    const busLines = entities.filter((e) => e.type === 'LINE' && e.layer === 'LUMEN_24V_BUS');
    expect(busLines.length).toBeGreaterThanOrEqual(expected.bus.segments.length);
    const titleText = entities.filter((e) => e.layer === 'LUMEN_TITLEBLOCK' && e.type === 'TEXT').map((e) => e.codes.get(1));
    expect(titleText).toContain('LEGAL OWNER Lumen Spatial Studio Kft.');
    expect(titleText).toContain('1052 Budapest, Fenyiv utca 14, Hungary');
    expect(titleText).toContain(`TITLE ${PROJECT}`);
    expect(titleText.some((t) => t.includes('SCALE 1:20'))).toBe(true);
    const dims = entities.filter((e) => e.layer === 'LUMEN_DIMS' && e.type === 'TEXT').map((e) => e.codes.get(1));
    expect(dims).toContain('320 OVERALL');
    expect(dims).toContain('260 OVERALL');

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
