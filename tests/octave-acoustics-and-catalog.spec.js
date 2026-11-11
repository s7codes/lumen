import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { CATEGORIES, getProduct, PRODUCTS } from '../src/data/products.js';
import { computeBusTopology } from '../src/lib/bus-topology.js';
import { formatInt } from '../src/lib/format.js';
import { luminousSources } from '../src/lib/illuminance-field.js';
import { beamProfile } from '../src/lib/photometry.js';
import { createRoomState } from '../src/lib/room-3d.js';
import {
  computeEnvironmentalPhysics,
  formatEnvironmentalPhysics,
  OCTAVE_BANDS,
  speechTransmissionIndex,
  stiGrade,
} from '../src/lib/room-physics.js';
import { buildScene } from '../src/lib/room-scene.js';
import { createLayout, DEFAULT_WALL } from '../src/lib/wall-studio.js';
import {
  collectRuntimeErrors,
  horizontalOverflow,
  installCspRecorder,
  readCspViolations,
} from './support/runtime-guards.js';

const ROOT = new URL('../', import.meta.url);
const BAFFLE = 'acoustic-baffle-120';
const FRAME = 'acoustic-art-frame-50x70';
const PENDANT = 'linear-pendant-150';
const SCONCE = 'wall-sconce-80';
const HUB = 'power-hub-dali';
const NEW_PARTS = [PENDANT, BAFFLE, SCONCE, HUB];
const SPEECH_BANDS = [500, 1000, 2000, 4000];

function mounted(productIds) {
  return productIds.map((productId, i) => ({
    uid: `m${i + 1}`,
    productId,
    finish: getProduct(productId).defaultFinish,
    xCm: 0,
    yCm: 0,
    led: getProduct(productId).watts > 0,
    locked: false,
  }));
}

async function mount(page, productId) {
  await page.getByRole('button', { name: `Mount ${getProduct(productId).name}`, exact: true }).click();
}

const modeButton = (page, name) => page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name });

/** Asserts the STI line and the six-band spectrum against the engine, then returns its figures. */
async function expectAcoustics(cell, subject) {
  const physics = computeEnvironmentalPhysics(subject);
  const lines = formatEnvironmentalPhysics(physics, formatInt);
  await expect(cell.getByTestId('acoustic-sti')).toHaveText(lines.sti);
  await expect(cell.getByTestId('physics-rt60')).toHaveText(lines.rt60);
  await expect(cell).toHaveAttribute('data-sti', physics.stiScore.toFixed(2));
  const bands = await cell
    .getByTestId('octave-band')
    .evaluateAll((els) => els.map((el) => [el.dataset.band, Number(el.dataset.rt60)]));
  expect(bands.map(([hz]) => Number(hz))).toEqual([...OCTAVE_BANDS]);
  expect(Object.fromEntries(bands)).toEqual(physics.octaveRt60);
  return physics;
}

function expectDamped(after, before) {
  for (const hz of SPEECH_BANDS) {
    expect(after.octaveRt60[hz], `${hz} Hz`).toBeLessThan(before.octaveRt60[hz]);
  }
  expect(after.stiScore).toBeGreaterThan(before.stiScore);
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('twelve-part canonical catalog', () => {
  test('all twelve parts render on /catalog and every category filter narrows to its own parts', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    expect(PRODUCTS).toHaveLength(12);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(12);
    await page.goto('/catalog');

    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(12);
    await expect(page.getByTestId('catalog-count')).toHaveText('12 results');
    await expect(cards.getByRole('heading', { level: 3 })).toHaveText(PRODUCTS.map((p) => p.name));
    for (const id of NEW_PARTS) {
      const card = page.getByRole('article', { name: getProduct(id).name });
      await expect(card.getByRole('img', { name: /front elevation of/i })).toBeVisible();
    }

    const filters = page.getByRole('group', { name: 'Category' });
    for (const category of CATEGORIES) {
      const expected = PRODUCTS.filter((p) => p.category === category.id).map((p) => p.name);
      await filters.getByRole('button', { name: new RegExp(`^${category.label}`, 'i') }).click();
      await expect(page).toHaveURL((url) => url.search === `?category=${category.id}`);
      await expect(cards.getByRole('heading', { level: 3 }), category.id).toHaveText(expected);
    }

    // Technical mode draws dimensions and anchors on every card, the new ones included.
    await filters.getByRole('button', { name: /^all/i }).click();
    await modeButton(page, /technical/i).click();
    await expect(page.getByTestId('product-telemetry')).toHaveCount(12);
    const pendant = page.getByRole('article', { name: getProduct(PENDANT).name });
    await expect(pendant.locator('.elev__anchor')).toHaveCount(2);
    await expect(pendant.locator('.elev__cable')).toHaveCount(2);
    await expect(page.getByRole('article', { name: getProduct(BAFFLE).name }).locator('.elev__felt')).toHaveCount(1);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('every spec sheet draws all four views, including the exploded assembly of the new parts', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    for (const product of PRODUCTS) {
      await page.goto(`/catalog/${product.id}`);
      await expect(page.getByTestId('product-detail')).toHaveAttribute('data-product', product.id);
      const drawing = page.getByTestId('blueprint-svg');

      for (const view of ['front', 'side', 'mounting']) {
        await page.getByTestId(`blueprint-view-${view}`).click();
        await expect(drawing, `${product.id} ${view}`).toHaveAttribute('data-view', view);
      }
      await expect(drawing.getByTestId('anchor-point')).toHaveCount(
        product.mount === 'floor' || (product.mount === 'ceiling' && product.mountingPoints < 2) ? 1 : product.mountingPoints,
      );

      await page.getByTestId('blueprint-tab-exploded').click();
      await expect(drawing).toHaveAttribute('data-view', 'exploded');
      await expect(drawing.getByTestId('exploded-layer'), product.id).toHaveCount(4);
      await expect(drawing.getByTestId('blueprint-scale')).toContainText(product.sku);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the four new parts carry their own exploded layers and photometry or bus curve', async ({ page }) => {
    // The exploded sheet is its own lazy chunk: wait for its four layers before reading them.
    const labels = async () => {
      await expect(page.getByTestId('exploded-layer')).toHaveCount(4);
      return page.getByTestId('exploded-part').evaluateAll((parts) => parts.map((p) => p.querySelector('text').textContent));
    };

    await page.goto(`/catalog/${PENDANT}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Linear Suspension Pendant 150');
    await expect(page.getByTestId('photometric-panel')).toHaveAttribute('data-kind', 'polar');
    // 2450 lm in a cos^2 lobe peaks at 2450 * 3 / 2pi = 1169.8 cd.
    await expect(page.getByTestId('peak-cd')).toHaveText('1,170 cd');
    await page.getByTestId('blueprint-tab-exploded').click();
    expect(await labels()).toEqual([
      '01 / Ceiling Canopy & Junction Plate',
      '02 / 24V DC Copper Bus & Connector Core',
      '03 / Primary Structural Body',
      '04 / Optical Diffuser & 2700K LED Array',
    ]);

    await page.goto(`/catalog/${SCONCE}`);
    await expect(page.getByTestId('photometric-panel')).toHaveAttribute('data-kind', 'polar');
    await expect(page.getByTestId('peak-cd')).toHaveText(`${formatInt(beamProfile(getProduct(SCONCE)).peakCd)} cd`);
    await page.getByTestId('probe-angle').fill('180');
    await expect(page.getByTestId('probe-readout')).not.toHaveText(/ 0 cd /);

    await page.goto(`/catalog/${BAFFLE}`);
    await expect(page.getByTestId('photometric-panel')).toHaveAttribute('data-kind', 'bus');
    await page.getByTestId('blueprint-tab-exploded').click();
    expect((await labels()).at(-1)).toBe('04 / PET Felt Acoustic Core');
    await expect(page.getByTestId('exploded-parts')).toContainText('NRC 0.85');

    await page.goto(`/catalog/${HUB}`);
    await expect(page.getByTestId('photometric-panel')).toHaveAttribute('data-kind', 'bus');
    await expect(page.getByTestId('bus-drop-curve')).toBeVisible();
    await page.getByTestId('blueprint-tab-exploded').click();
    expect(await labels()).toEqual([
      '01 / Plaster-In Clip & Mounting Rail',
      '02 / 24V DC Copper Bus & Connector Core',
      '03 / Primary Structural Body',
      '04 / DALI-2 Terminal Block & Cover Plate',
    ]);
  });

  test('the 2D and 3D launchers mount each new part at a clear spot', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    for (const id of NEW_PARTS) {
      const product = getProduct(id);
      await page.goto(`/catalog/${id}?finish=${product.defaultFinish}`);
      await page.getByTestId('launch-in-wall-studio').click();
      await expect(page).toHaveURL(/\/studio-2d$/);
      const module = page.locator(`[data-testid="wall-module"][data-product="${id}"]`);
      await expect(module).toHaveCount(1);
      await expect(module).toHaveAttribute('data-shape', product.shape);
      await expect(module).toHaveAttribute('data-conflict', 'false');

      await page.goto(`/catalog/${id}?finish=${product.defaultFinish}`);
      await page.getByTestId('launch-in-room-3d').click();
      await expect(page).toHaveURL(/\/room-3d$/);
      await expect(page.getByTestId('room-inspector-name')).toHaveText(product.name);
      await expect(page.locator(`[data-testid="room-module"][data-product="${id}"]`)).toHaveCount(1);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('the room scene, bus router and photometric field handle every part', () => {
    const items = PRODUCTS.map((product, i) => ({
      uid: `m${i + 1}`,
      productId: product.id,
      finish: product.defaultFinish,
      xCm: 10 + i * 20,
      yCm: 60,
      led: product.watts > 0,
      locked: false,
    }));
    const state = createRoomState({ ...createRoomState().room, widthCm: 600 }, items);
    const scene = buildScene({ state });
    expect(scene.modules).toHaveLength(state.items.length);
    for (const module of scene.modules) {
      expect(module.lights.length > 0, module.productId).toBe(getProduct(module.productId).watts > 0);
    }
    for (const id of NEW_PARTS) {
      const module = scene.modules.find((m) => m.productId === id);
      expect(module.emitters.length > 0, id).toBe(getProduct(id).watts > 0);
    }
    const baffle = scene.modules.find((m) => m.productId === BAFFLE);
    expect(baffle.felt).not.toBeNull();
    expect(scene.modules.find((m) => m.productId === PENDANT).lights.map((l) => l.type)).toEqual(['spot']);
    expect(scene.modules.find((m) => m.productId === SCONCE).lights.map((l) => l.id)).toEqual(['down', 'up']);

    // Every lit part becomes at least one photometric source; the sconce throws one lobe up and one down.
    const sources = luminousSources(items);
    for (const product of PRODUCTS.filter((p) => p.watts > 0)) {
      const uidIndex = items.findIndex((item) => item.productId === product.id);
      expect(sources.some((s) => s.x >= items[uidIndex].xCm - 1 && s.x <= items[uidIndex].xCm + product.dimsCm.w + 1)).toBe(true);
    }
    const sconce = luminousSources(mounted([SCONCE]));
    expect(sconce.map((s) => s.ay).sort()).toEqual([-1, 1]);

    // The DALI-2 hub feeds the run like the track bus, and passes it through when it is not first.
    const hubFed = computeBusTopology({
      wall: DEFAULT_WALL,
      items: [
        { uid: 'h', productId: HUB, finish: 'obsidian', xCm: 120, yCm: 220, led: false },
        { uid: 's', productId: SCONCE, finish: 'chalk', xCm: 40, yCm: 110, led: true },
        { uid: 'p', productId: PENDANT, finish: 'obsidian', xCm: 75, yCm: 238, led: true },
      ],
    });
    expect(hubFed.origin).toEqual({ xCm: 150, yCm: 223, kind: 'hub', uid: 'h' });
    expect(hubFed.nodes.map((n) => n.uid).sort()).toEqual(['p', 's']);
    expect(hubFed.activeWatts).toBe(42);

    const trackFed = computeBusTopology({
      wall: DEFAULT_WALL,
      items: [
        { uid: 't', productId: 'track-bus-200', finish: 'obsidian', xCm: 50, yCm: 228, led: false },
        { uid: 'h', productId: HUB, finish: 'obsidian', xCm: 200, yCm: 150, led: false },
      ],
    });
    expect(trackFed.origin.kind).toBe('track');
    expect(trackFed.nodes).toEqual([expect.objectContaining({ uid: 'h', watts: 0 })]);
  });
});

test.describe('six-octave acoustics and STI', () => {
  test('the STI engine follows the modulation transfer function and its grade bands', () => {
    expect(speechTransmissionIndex(OCTAVE_BANDS.map(() => 0))).toBeCloseTo(1, 6);
    const long = speechTransmissionIndex(OCTAVE_BANDS.map(() => 4));
    const short = speechTransmissionIndex(OCTAVE_BANDS.map(() => 0.4));
    expect(long).toBeLessThan(short);
    expect(stiGrade(0.44).label).toBe('Poor');
    expect(stiGrade(0.45).label).toBe('Fair');
    expect(stiGrade(0.6).label).toBe('Good');
    expect(stiGrade(0.75).label).toBe('Excellent');

    const bare = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, []));
    expect(Object.keys(bare.octaveRt60).map(Number)).toEqual([...OCTAVE_BANDS]);
    // The 500 Hz band stays the reference figure every earlier readout was built on.
    expect(bare.rt60Sec).toBe(bare.octaveRt60[500]);
    expect(bare.rt60Sec).toBe(1.56);
    expect(bare.stiScore).toBeGreaterThanOrEqual(0);
    expect(bare.stiScore).toBeLessThanOrEqual(1);
  });

  test('wall studio: a baffle and a frame pull down 500 Hz-4 kHz and lift the STI', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/studio-2d');
    const cell = page.getByTestId('environmental-physics');
    const spectrum = cell.getByTestId('acoustic-octave-spectrum');

    const bare = await expectAcoustics(cell, createLayout(DEFAULT_WALL, []));
    await expect(cell.getByTestId('acoustic-sti')).toHaveText('STI 0.54 (Fair)');
    await expect(spectrum).toBeHidden();

    await mount(page, BAFFLE);
    const baffled = await expectAcoustics(cell, createLayout(DEFAULT_WALL, mounted([BAFFLE])));
    expectDamped(baffled, bare);
    // 50 mm felt at NRC 0.85 out-damps the 30 mm frame core.
    const frameOnly = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, mounted([FRAME])));
    expect(baffled.rt60Sec).toBeLessThan(frameOnly.rt60Sec);

    await mount(page, FRAME);
    const both = await expectAcoustics(cell, createLayout(DEFAULT_WALL, mounted([BAFFLE, FRAME])));
    expectDamped(both, baffled);
    await expect(cell.getByTestId('physics-rt60')).toHaveText('RT60: 1.26 s');
    await expect(cell.getByTestId('acoustic-sti')).toHaveText('STI 0.58 (Fair)');
    await expect(cell.getByTestId('acoustic-sti')).toHaveAttribute('data-grade', 'fair');

    // The spectrum is technical detail: six labelled bars appear with Technical mode only.
    await modeButton(page, 'Technical').click();
    await expect(spectrum).toBeVisible();
    await expect(spectrum.locator('.octave__label')).toHaveText(['125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz']);
    await expect(spectrum.getByRole('listitem')).toHaveCount(6);
    await modeButton(page, 'Architectural').click();
    await expect(spectrum).toBeHidden();

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });

  test('room planner: the same octave curve and STI respond to the felt panels', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const cell = page.getByTestId('room-summary').getByTestId('environmental-physics');

    const bare = await expectAcoustics(cell, createRoomState());
    await mount(page, BAFFLE);
    const baffled = await expectAcoustics(cell, createRoomState(undefined, mounted([BAFFLE])));
    expectDamped(baffled, bare);
    await mount(page, FRAME);
    const both = await expectAcoustics(cell, createRoomState(undefined, mounted([BAFFLE, FRAME])));
    expectDamped(both, baffled);

    await modeButton(page, 'Technical').click();
    await expect(cell.getByTestId('acoustic-octave-spectrum')).toBeVisible();
    expect(errors).toEqual([]);
    expect(await readCspViolations(page)).toEqual([]);
  });
});

test.describe('repository hygiene', () => {
  test('MIT license file, package license field and exactly three README badges', async () => {
    const [license, pkgText, readme] = await Promise.all(
      ['LICENSE', 'package.json', 'README.md'].map((file) => readFile(new URL(file, ROOT), 'utf-8')),
    );
    const pkg = JSON.parse(pkgText);

    expect(license.startsWith('MIT License\n')).toBe(true);
    expect(license).toContain('Copyright (c) 2026 s7codes');
    expect(license).not.toContain('Lumen Spatial Studio');
    expect(readme).toContain('MIT License, Copyright (c) 2026 s7codes');
    expect(license).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy');
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND');
    expect(pkg.license).toBe('MIT');

    const badges = readme.split('\n').filter((line) => /^\[?!\[/.test(line));
    expect(badges).toEqual([
      '[![Playwright E2E](https://github.com/s7codes/lumen/actions/workflows/ci.yml/badge.svg)](https://github.com/s7codes/lumen/actions/workflows/ci.yml)',
      `![Release](https://img.shields.io/badge/release-v${pkg.version}-e8923a)`,
      '![License: MIT](https://img.shields.io/badge/license-MIT-2a2825)',
    ]);
    expect(readme.match(/img\.shields\.io/g)).toHaveLength(2);
    expect(readme).toContain(`Current release: **v${pkg.version}**`);
    // Plain ASCII only.
    for (const [name, text] of [['LICENSE', license], ['README.md', readme]]) {
      expect([...text].filter((ch) => ch.charCodeAt(0) > 127), name).toEqual([]);
    }
  });
});
