import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { getProduct } from '../src/data/products.js';
import {
  AUDITION_CHORD,
  bandIndexFor,
  CLAP_BAND_WEIGHTS,
  clarityC50,
  echoReadout,
  ENVELOPE_POINTS,
  synthesizeAcousticProfile,
  WOOD_CLAP,
  woodClapSamples,
} from '../src/lib/acoustic-audition.js';
import {
  SNAPSHOT_HEIGHT,
  SNAPSHOT_STAMP,
  SNAPSHOT_WIDTH,
  snapshotFilename,
  snapshotProjectName,
  snapshotSpecRows,
} from '../src/lib/render-snapshot.js';
import { createRoomState } from '../src/lib/room-3d.js';
import { computeEnvironmentalPhysics, OCTAVE_BANDS } from '../src/lib/room-physics.js';
import { createLayout, DEFAULT_WALL, summarizeWall } from '../src/lib/wall-studio.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const BAFFLE = 'acoustic-baffle-120';
const FRAME = 'acoustic-art-frame-50x70';
const LN_1000 = Math.log(1000);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

/**
 * Records what the audition asks of Web Audio: contexts opened, band-pass
 * centres and every decay time constant. The real nodes still run.
 */
async function instrumentWebAudio(page) {
  await page.addInitScript(() => {
    const log = { contexts: 0, filters: [], taus: [], oscillators: [], closed: 0 };
    window.__audition = log;
    const Native = window.AudioContext;
    if (typeof Native !== 'function') return;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        log.contexts += 1;
        log.filters.push([]);
        log.taus.push([]);
        log.oscillators.push([]);
        const take = log.contexts - 1;
        const createBiquadFilter = this.createBiquadFilter.bind(this);
        this.createBiquadFilter = () => {
          const node = createBiquadFilter();
          queueMicrotask(() => log.filters[take].push(node.frequency.value));
          return node;
        };
        const createOscillator = this.createOscillator.bind(this);
        this.createOscillator = () => {
          const node = createOscillator();
          queueMicrotask(() => log.oscillators[take].push(node.frequency.value));
          return node;
        };
        const createGain = this.createGain.bind(this);
        this.createGain = () => {
          const node = createGain();
          const setTarget = node.gain.setTargetAtTime.bind(node.gain);
          node.gain.setTargetAtTime = (value, time, tau) => {
            log.taus[take].push(tau);
            return setTarget(value, time, tau);
          };
          return node;
        };
        const close = this.close.bind(this);
        this.close = () => {
          log.closed += 1;
          return close();
        };
      }
    };
  });
}

function auditionLog(page) {
  return page.evaluate(() => window.__audition);
}

/** Every band ringing on its own RT60 and every chord partial on the band it sounds in. */
function expectedTaus(physics) {
  const bands = OCTAVE_BANDS.map((hz) => physics.octaveRt60[hz] / LN_1000);
  return [...bands, ...AUDITION_CHORD.map((note) => bands[bandIndexFor(note.hz)])];
}

async function auditionAndCheck(page, cell, physics, takeNumber) {
  const wave = cell.getByTestId('acoustic-decay-wave');
  await expect(wave).toHaveAttribute('data-rt60', physics.rt60Sec.toFixed(2));
  await cell.getByTestId('audition-room-acoustics').click();
  await expect(wave).toHaveAttribute('data-state', 'playing');
  await expect(wave).toHaveAttribute('data-takes', String(takeNumber));
  await expect(wave).toHaveAttribute('data-audio', 'web-audio');
  await expect(cell.getByTestId('audition-room-acoustics')).toHaveAttribute('data-playing', 'true');
  await expect(wave.locator('.audition__playhead')).toHaveCount(1);
  await expect
    .poll(async () => (await auditionLog(page)).filters[takeNumber - 1]?.length)
    .toBe(OCTAVE_BANDS.length);
  const log = await auditionLog(page);
  expect(log.contexts).toBe(takeNumber);
  expect(log.filters[takeNumber - 1]).toEqual([...OCTAVE_BANDS]);
  expect(log.oscillators[takeNumber - 1]).toEqual(AUDITION_CHORD.map((note) => Math.fround(note.hz)));
  const taus = log.taus[takeNumber - 1];
  const expected = expectedTaus(physics);
  expect(taus).toHaveLength(expected.length);
  taus.forEach((tau, i) => expect(tau, `tau ${i}`).toBeCloseTo(expected[i], 4));
  return wave;
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('RT60 acoustic audition', () => {
  test('profile: deterministic six-band decay, a dB curve on a fixed axis, clarity rising as the room is damped', () => {
    const bare = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, []));
    const damped = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, mounted([BAFFLE, FRAME])));
    const a = synthesizeAcousticProfile(bare);
    expect(synthesizeAcousticProfile(bare)).toEqual(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.rt60Sec).toBe(bare.rt60Sec);
    expect(a.bands.map((band) => band.hz)).toEqual([...OCTAVE_BANDS]);
    for (const band of a.bands) {
      expect(band.rt60Sec).toBe(bare.octaveRt60[band.hz]);
      expect(band.decayPerSec).toBeCloseTo(LN_1000 / band.rt60Sec, 3);
      // A band's amplitude is down 60 dB (x 1/1000) after one RT60.
      expect(Math.exp(-band.decayPerSec * band.rt60Sec)).toBeCloseTo(0.001, 5);
    }
    expect(a.durationSec).toBeCloseTo(Math.max(...a.bands.map((band) => band.rt60Sec)) + 0.35, 2);
    expect(a.envelope).toHaveLength(ENVELOPE_POINTS);
    expect(a.envelope[0]).toBe(1);
    for (let i = 1; i < a.envelope.length; i += 1) expect(a.envelope[i]).toBeLessThanOrEqual(a.envelope[i - 1]);
    expect(a.dampingPct).toBe(Math.round((1 - bare.rt60Sec / bare.baselineRt60Sec) * 100));

    const b = synthesizeAcousticProfile(damped);
    expect(b.rt60Sec).toBeLessThan(a.rt60Sec);
    expect(b.dampingPct).toBeGreaterThan(a.dampingPct);
    expect(b.clarityDb).toBeGreaterThan(a.clarityDb);
    // The damped curve reaches the noise floor sooner on the shared axis.
    expect(b.envelope.indexOf(0)).toBeLessThan(a.envelope.indexOf(0) === -1 ? ENVELOPE_POINTS : a.envelope.indexOf(0));
    expect(clarityC50(0.5)).toBeCloseTo(4.75, 1);

    // Tampered or missing figures still give a finite, playable profile.
    for (const input of [null, 'x', { rt60Sec: 'NaN', octaveRt60: { __proto__: { 500: 99 } } }, { rt60Sec: -4, baselineRt60Sec: 1e9 }]) {
      const profile = synthesizeAcousticProfile(input);
      expect(Number.isFinite(profile.rt60Sec)).toBe(true);
      expect(profile.rt60Sec).toBeGreaterThanOrEqual(0.1);
      expect(profile.bands.every((band) => band.rt60Sec >= 0.1 && band.rt60Sec <= 6)).toBe(true);
      expect(profile.durationSec).toBeGreaterThanOrEqual(0.6);
      expect(profile.durationSec).toBeLessThanOrEqual(5);
      expect(profile.envelope.every((level) => level >= 0 && level <= 1)).toBe(true);
    }
    expect(({}).polluted).toBeUndefined();
  });

  test('the echo test is a soft wood clap and reads as a plain bare-versus-damped comparison', () => {
    // A warm clap: deterministic, peak-normalised, its energy front-loaded in the first 40 ms.
    const rate = 48000;
    const clap = woodClapSamples(rate, 1.2);
    expect(clap).toHaveLength(rate * 1.2);
    expect(Buffer.compare(Buffer.from(clap.buffer), Buffer.from(woodClapSamples(rate, 1.2).buffer))).toBe(0);
    const peak = clap.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    expect(peak).toBeCloseTo(WOOD_CLAP.peak, 5);
    const rms = (from, to) => Math.sqrt(clap.slice(from, to).reduce((sum, s) => sum + s * s, 0) / (to - from));
    expect(rms(0, rate * 0.04)).toBeGreaterThan(2.5 * rms(rate * 0.2, rate * 1.2));
    expect(woodClapSamples(rate, Number.NaN)).toHaveLength(rate);
    // The upper octaves are eased off, never boosted.
    expect(CLAP_BAND_WEIGHTS).toHaveLength(OCTAVE_BANDS.length);
    for (let i = 1; i < CLAP_BAND_WEIGHTS.length; i += 1) expect(CLAP_BAND_WEIGHTS[i]).toBeLessThanOrEqual(CLAP_BAND_WEIGHTS[i - 1]);

    // The readout: bare, then damped against the same room bare.
    const bare = synthesizeAcousticProfile(computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, [])));
    expect(echoReadout(bare)).toEqual({ damped: false, text: `Bare room echo ${bare.rt60Sec.toFixed(2)} s - add acoustic panels to damp` });
    const damped = synthesizeAcousticProfile(computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, mounted([BAFFLE, FRAME]))));
    const readout = echoReadout(damped);
    expect(readout.damped).toBe(true);
    expect(readout.text).toBe(
      `Echo: ${damped.rt60Sec.toFixed(2)} s vs. ${damped.baselineRt60Sec.toFixed(2)} s bare (-${damped.dampingPct}% reverb)`,
    );
    expect(readout.text).toMatch(/^Echo: 1\.26 s vs\. \d\.\d\d s bare \(-\d+% reverb\)$/);
    expect(echoReadout(null).damped).toBe(false);
    expect(readout.text).toMatch(/^[\x20-\x7e]+$/);
  });

  test('wall studio: the key plays the six-band decay and the curve follows the felt as it is mounted', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await instrumentWebAudio(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/studio-2d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    const cell = page.getByTestId('wall-summary').getByTestId('environmental-physics');
    const key = cell.getByTestId('audition-room-acoustics');
    await expect(key).toHaveText('Test Room Echo');
    await expect(key).toHaveAccessibleName('Test Room Echo (Audition RT60)');
    await expect(cell.getByRole('button', { name: /Audition RT60/ })).toHaveCount(1);
    const readout = cell.getByTestId('acoustic-echo-readout');
    await expect(readout).toHaveAttribute('data-damped', 'false');
    await expect(readout).toContainText('Bare room echo');
    await expect(readout).toContainText('add acoustic panels to damp');
    await expect(cell.getByTestId('acoustic-baseline-mark')).toHaveCount(0);
    await expect(cell.getByTestId('acoustic-decay-wave').locator('.audition__bar')).toHaveCount(ENVELOPE_POINTS);

    const bare = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, []));
    const wave = await auditionAndCheck(page, cell, bare, 1);
    await expect(wave).toHaveAttribute('data-damping-pct', String(synthesizeAcousticProfile(bare).dampingPct));
    await expect(wave.locator('.audition__bar').first()).toHaveCSS('animation-name', 'audition-sample');
    // The take ends on its own and the context is released.
    await expect(wave).toHaveAttribute('data-state', 'idle', { timeout: 8_000 });
    await expect.poll(async () => (await auditionLog(page)).closed).toBe(1);

    await mount(page, BAFFLE);
    await mount(page, FRAME);
    const damped = computeEnvironmentalPhysics(createLayout(DEFAULT_WALL, mounted([BAFFLE, FRAME])));
    expect(damped.rt60Sec).toBeLessThan(bare.rt60Sec);
    const after = await auditionAndCheck(page, cell, damped, 2);
    await expect(after).toHaveAttribute('data-rt60', '1.26');
    expect(Number(await after.getAttribute('data-damping-pct'))).toBeGreaterThan(0);
    expect(Number(await after.getAttribute('data-duration'))).toBeLessThan(synthesizeAcousticProfile(bare).durationSec);
    // The readout compares the panels against the bare room, and the curve marks where the bare echo ends.
    const dampedProfile = synthesizeAcousticProfile(damped);
    await expect(readout).toHaveAttribute('data-damped', 'true');
    await expect(readout).toHaveText(echoReadout(dampedProfile).text);
    await expect(readout).toContainText('Echo: 1.26 s vs.');
    await expect(after).toHaveAttribute('data-baseline-rt60', dampedProfile.baselineRt60Sec.toFixed(2));
    const mark = cell.getByTestId('acoustic-baseline-mark');
    await expect(mark).toHaveCount(1);
    const [markBox, waveBox] = await Promise.all([mark.boundingBox(), after.boundingBox()]);
    const expectedX = waveBox.x + waveBox.width * Math.min(0.995, dampedProfile.baselineRt60Sec / dampedProfile.windowSec);
    expect(Math.abs(markBox.x - expectedX)).toBeLessThanOrEqual(1.5);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('room planner: the same audition tracks the felt panels in the room', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await instrumentWebAudio(page);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const cell = page.getByTestId('room-summary').getByTestId('environmental-physics');

    const bare = computeEnvironmentalPhysics(createRoomState());
    await auditionAndCheck(page, cell, bare, 1);
    await mount(page, BAFFLE);
    const damped = computeEnvironmentalPhysics(createRoomState(undefined, mounted([BAFFLE])));
    expect(damped.rt60Sec).toBeLessThan(bare.rt60Sec);
    await expect(cell.getByTestId('acoustic-decay-wave')).toHaveAttribute('data-rt60', damped.rt60Sec.toFixed(2));
    await auditionAndCheck(page, cell, damped, 2);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('without Web Audio the key still runs the decay curve, silently', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.addInitScript(() => {
      delete window.AudioContext;
      delete window.webkitAudioContext;
    });
    await page.goto('/studio-2d');
    const cell = page.getByTestId('wall-summary').getByTestId('environmental-physics');
    await cell.getByTestId('audition-room-acoustics').click();
    const wave = cell.getByTestId('acoustic-decay-wave');
    await expect(wave).toHaveAttribute('data-state', 'playing');
    await expect(wave).toHaveAttribute('data-audio', 'silent');
    expect(errors).toEqual([]);
  });
});

test.describe('wall studio drafting backdrop', () => {
  test('a warm key light, a ground line, a perspective plinth and a registered sheet frame surround the elevation', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/studio-2d');
    await page.getByRole('button', { name: 'Load preset Nordic Reading Wall' }).click();
    const viewport = page.locator('.studio-stage__viewport');
    await expect(page.locator('.studio-stage')).toHaveClass(/(^|\s)wall-stage(\s|$)/);

    const surround = await viewport.evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.backgroundColor, image: style.backgroundImage };
    });
    expect(surround.color).toBe('rgb(17, 16, 15)');
    expect(surround.image).toContain('radial-gradient(85% 70% at 50% 38%');
    expect(surround.image).toContain('rgba(232, 168, 92, 0.11) 0%');
    expect(surround.image).toContain('rgba(46, 39, 32, 0.28) 48%');
    expect(surround.image).toContain('rgba(15, 14, 13, 0.96) 100%');
    // The stage is the one optical volume; the workstation around it is flat Flos paper.
    await expect(viewport).toHaveClass(/(^|\s)optical(\s|$)/);
    const layout = await page.locator('.studio-layout').evaluate((el) => {
      const style = getComputedStyle(el);
      return { color: style.backgroundColor, image: style.backgroundImage };
    });
    expect(layout).toEqual({ color: 'rgb(250, 249, 246)', image: 'none' });

    const backdrop = page.getByTestId('studio-backdrop');
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveCSS('pointer-events', 'none');
    await expect(backdrop.locator('.wall-stage__reg')).toHaveCount(4);
    await expect(backdrop.locator('.wall-stage__tick')).toHaveCount(4);
    await expect(backdrop).toHaveCSS('border-top-width', '1px');

    // The plinth recedes in perspective from the floor datum, under the wall and clear of the pointer.
    const wall = page.getByTestId('wall-canvas');
    const plinth = page.getByTestId('wall-plinth');
    const [wallBox, plinthBox, viewportBox] = await Promise.all([wall.boundingBox(), plinth.boundingBox(), viewport.boundingBox()]);
    expect(plinthBox.y).toBeGreaterThanOrEqual(wallBox.y + wallBox.height);
    expect(plinthBox.y).toBeLessThan(viewportBox.y + viewportBox.height - 40);
    expect(await plinth.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix3d\(/);
    await expect(plinth).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('.wall__horizon')).toHaveCSS('height', '1px');
    // The datum itself is unchanged: a 3 px floor line.
    await expect(page.locator('.wall__floor')).toHaveCSS('height', '3px');

    // A click on the plinth lands on the stage, not on the wall's marquee.
    await page.mouse.click(wallBox.x + wallBox.width / 2, wallBox.y + wallBox.height + 30);
    await expect(page.getByTestId('marquee-selection-box')).toBeHidden();

    await page.getByRole('radio', { name: 'Daylight Elevation' }).check();
    await expect(viewport).toHaveCSS('background-color', 'rgb(25, 24, 22)');
    for (const width of [360, 1024, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await horizontalOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('studio render .PNG snapshot', () => {
  test('spec rows, filename and project name are sanitized and stamped from the live figures', () => {
    const state = createRoomState(undefined, mounted([BAFFLE, 'wall-sconce-80']));
    const summary = summarizeWall(state);
    const physics = computeEnvironmentalPhysics(state);
    const rows = snapshotSpecRows({ room: state.room, summary, physics, cameraMode: 'inside' });
    expect(rows).toEqual([
      ['Room W x D x H', `${state.room.widthCm} x ${state.room.depthCm} x ${state.room.heightCm} cm`],
      ['Camera Lens', 'Inside Room (165 cm)'],
      ['Modules', '02'],
      ['24V Load', `${summary.loadW} W`],
      ['Illuminance', `${physics.avgFloorLux} lx`],
      ['RT60', `${physics.rt60Sec.toFixed(2)} s`],
    ]);
    expect(snapshotSpecRows({ room: null, summary: null, physics: null, cameraMode: '__proto__' })[1]).toEqual([
      'Camera Lens',
      'Orbit Cutaway',
    ]);
    expect(SNAPSHOT_STAMP).toBe('LUMEN 3D SPATIAL STUDIO');
    expect(snapshotFilename('Loft <North>\u00e9 / 01')).toBe('lumen-room-loft_north_e_01.png');
    expect(snapshotFilename('')).toBe('lumen-room-room.png');
    expect(snapshotProjectName('A\u0000B\nC'.padEnd(90, 'x'))).toHaveLength(48);
    expect(snapshotProjectName(42)).toBe('Room');
  });

  test('Capture .PNG downloads a 1600 x 1000 PNG render card of the room and confirms it', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const renderer = await page.getByTestId('room-viewport').getAttribute('data-renderer');
    await expect(page.getByTestId('room-viewport')).not.toHaveAttribute('data-renderer', 'loading', { timeout: 20_000 });
    await expect(page.getByTestId('studio-boot-overlay')).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await mount(page, 'wall-sconce-80');
    await page.getByTestId('project-name-input').fill('Atelier <Loft> / 02');

    const bridge = page.getByRole('group', { name: '2D and CAD bridge' });
    const capture = page.getByTestId('capture-room-png');
    await expect(capture).toHaveText('Capture .PNG');
    const keys = await bridge.getByRole('button').evaluateAll((els) => els.map((el) => el.dataset.testid));
    expect(keys.indexOf('capture-room-png')).toBe(keys.indexOf('export-room-obj') + 1);
    expect(keys.indexOf('copy-share-link')).toBe(keys.indexOf('capture-room-png') + 1);

    const [download] = await Promise.all([page.waitForEvent('download'), capture.click()]);
    expect(download.suggestedFilename()).toBe('lumen-room-atelier_loft_02.png');
    const bytes = await readFile(await download.path());
    expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(bytes.toString('latin1', 12, 16)).toBe('IHDR');
    expect(bytes.readUInt32BE(16)).toBe(SNAPSHOT_WIDTH);
    expect(bytes.readUInt32BE(20)).toBe(SNAPSHOT_HEIGHT);
    expect(bytes.length).toBeGreaterThan(20_000);

    await expect(page.getByTestId('toast-message').last()).toHaveText('Atelier <Loft> / 02 captured as studio .PNG render.');
    const status = page.getByTestId('room-bridge-status');
    await expect(status).toContainText('Captured studio render: 1600 x 1000 px PNG');
    const live = (await page.getByTestId('room-viewport').getAttribute('data-renderer')) !== 'unavailable';
    test.info().annotations.push({ type: 'renderer', description: `${renderer} -> ${await status.innerText()}` });
    if (!live) await expect(status).toContainText('drafted axonometric frame');

    // The card decodes in the page as a real image, with the project name set white in the strip.
    const decoded = await page.evaluate(async (base64) => {
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const name = ctx.getImageData(64, 880, 520, 40).data;
      const frame = ctx.getImageData(0, 0, bitmap.width, 800).data;
      let ink = 0;
      for (let i = 0; i < name.length; i += 4) if (name[i] > 200 && name[i + 1] > 200 && name[i + 2] > 200) ink += 1;
      let lit = 0;
      for (let i = 0; i < frame.length; i += 64) if (frame[i] + frame[i + 1] + frame[i + 2] > 90) lit += 1;
      return { width: bitmap.width, height: bitmap.height, ink, lit };
    }, bytes.toString('base64'));
    expect(decoded).toMatchObject({ width: 1600, height: 1000 });
    expect(decoded.ink).toBeGreaterThan(200);
    expect(decoded.lit).toBeGreaterThan(100);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
