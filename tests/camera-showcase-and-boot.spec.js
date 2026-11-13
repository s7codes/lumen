import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  CAMERA_PITCH,
  CAMERA_YAW,
  CAMERA_ZOOM,
  createRoomState,
  DEFAULT_ROOM,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_SIZE_PRESETS,
  ROOM_STORAGE_KEY,
  ROOM_WIDTH,
  roomSizePreset,
  sanitizeCamera,
  sanitizeRoom,
  wrapYaw,
} from '../src/lib/room-3d.js';
import { cameraFrame, cameraFromPosition, cameraPosition, orbitLimits } from '../src/lib/room-scene.js';
import {
  CAMERA_MODES,
  defaultStance,
  facingWall,
  INSIDE_FOV,
  INSIDE_FOV_DEG,
  LOOK_PITCH,
  lookWalk,
  rescaleStance,
  sanitizeInsideFov,
  WALL_LOOK_HEADING,
} from '../src/lib/room-walkthrough.js';
import { launchHref, readLaunchPreset, stripLaunchParams } from '../src/lib/launch-presets.js';
import { NAV_ROUTES, SHOWCASE_3D_ID } from '../src/lib/routes.js';
import {
  ACT_DURATION_MS,
  ACT_IDS,
  ACT_SECONDS,
  actCamera,
  actSpinRate,
  buildLuxField,
  eyeFrustum,
  eyeIlluminance,
  gizmoPose,
  ISO_LEVELS,
  isoSegments,
  ORBIT_DEG_PER_S,
  ORBIT_PITCH,
  PULSE_SPEED_CM_S,
  shelfDimensions,
  SNAP_CM,
  STAGE_ROOM,
} from '../src/lib/showcase-scene.js';
import { holdEngineChunk } from './support/engine-gates.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|WallStudioPage|RoomCanvas)-[\w-]+\.js$/;
// The boot panel names the engine by the release's major.minor, as read from package.json.
const RELEASE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version;
const ENGINE_LABEL = `LUMEN SPATIAL ENGINE v${RELEASE.split('.').slice(0, 2).join('.')}`;

function viewport(page) {
  return page.getByTestId('room-viewport');
}

function walkState(page) {
  return page.getByTestId('room-walkthrough-state');
}

function bootOverlay(page) {
  return page.getByTestId('studio-boot-overlay');
}

/** The boot plate's frame once its own transitions have finished, read in that same task. */
function bootFrame(boot) {
  return boot.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => null)));
    const box = el.getBoundingClientRect();
    return {
      state: el.dataset.state,
      x: box.x,
      y: box.y,
      height: box.height,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // The pointer passes straight through to the navbar underneath.
      navbarUnder: Boolean(document.elementFromPoint(24, 24)?.closest('header.navbar')),
    };
  });
}

async function openRoom(page) {
  await page.goto('/room-3d');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
}

async function rendererOf(page) {
  await expect(viewport(page)).not.toHaveAttribute('data-renderer', 'loading', { timeout: 20_000 });
  return viewport(page).getAttribute('data-renderer');
}

async function cameraOf(page) {
  const stage = viewport(page);
  return {
    yaw: Number(await stage.getAttribute('data-camera-yaw')),
    pitch: Number(await stage.getAttribute('data-camera-pitch')),
    zoom: Number(await stage.getAttribute('data-camera-zoom')),
  };
}

/** Shortest signed angle between two yaws, so a check across the 180 seam reads true distance. */
function yawGap(a, b) {
  return Math.abs(wrapYaw(a - b));
}

test.beforeEach(async ({ page }) => {
  await installCspRecorder(page);
});

test.describe('360 degree orbit and top-down pitch', () => {
  test('yaw spans a full turn and wraps, pitch reaches a plan view, zoom spans 0.45x to 2.4x', () => {
    expect(CAMERA_YAW).toEqual({ min: -180, max: 180 });
    expect(CAMERA_PITCH).toEqual({ min: 5, max: 85 });
    expect(CAMERA_ZOOM).toEqual({ min: 0.45, max: 2.4 });

    // Yaw is an angle, not a stop: values past the seam wrap instead of clamping.
    expect(sanitizeCamera({ yaw: 120, pitch: 24, zoom: 1 }).yaw).toBe(120);
    expect(sanitizeCamera({ yaw: 190, pitch: 24, zoom: 1 }).yaw).toBe(-170);
    expect(sanitizeCamera({ yaw: -181, pitch: 24, zoom: 1 }).yaw).toBe(179);
    expect(sanitizeCamera({ yaw: -179.97, pitch: 24, zoom: 1 }).yaw).toBe(180);
    expect(sanitizeCamera({ yaw: 540, pitch: 24, zoom: 1 }).yaw).toBe(180);
    expect(sanitizeCamera({ yaw: Number.NaN, pitch: 90, zoom: 9 })).toEqual({ yaw: -24, pitch: 85, zoom: 2.4 });
    expect(sanitizeCamera({ yaw: 0, pitch: -10, zoom: 0.1 })).toEqual({ yaw: 0, pitch: 5, zoom: 0.45 });

    // Every yaw round the room, on every wall, survives the lens round trip.
    const room = createRoomState().room;
    for (const wall of ['north', 'east', 'south', 'west']) {
      const frame = cameraFrame(room, 1.6, wall);
      for (const yaw of [-170, -150, -90, 0, 90, 150, 180]) {
        for (const pitch of [5, 45, 85]) {
          const camera = { yaw, pitch, zoom: 1 };
          expect(sanitizeCamera(cameraFromPosition(frame, cameraPosition(frame, camera))), `${wall} ${yaw}/${pitch}`).toEqual(
            camera,
          );
        }
      }
    }

    // At 85 deg the eye stands almost straight over the orbit centre.
    const frame = cameraFrame(room, 1.6);
    const eye = cameraPosition(frame, { yaw: 0, pitch: 85, zoom: 1 });
    const plan = Math.hypot(eye[0] - frame.target[0], eye[2] - frame.target[2]);
    expect(plan / (eye[1] - frame.target[1])).toBeLessThan(0.09);

    const limits = orbitLimits(CAMERA_YAW, CAMERA_PITCH);
    expect(limits.minPolarAngle).toBeCloseTo((5 * Math.PI) / 180, 10);
    expect(limits.maxPolarAngle).toBeCloseTo((85 * Math.PI) / 180, 10);
  });

  test('a drag orbits past 90 and 150 deg and through the 180 seam without a stop; pitch drops to a plan view', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRoom(page);
    const stage = viewport(page);
    const renderer = await rendererOf(page);
    await expect(bootOverlay(page)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });

    if (renderer === 'unavailable') {
      test.info().annotations.push({ type: 'webgl', description: 'unavailable: pointer orbit skipped' });
    } else {
      await stage.scrollIntoViewIfNeeded();
      const box = await stage.boundingBox();
      const height = await stage.locator('canvas').evaluate((el) => el.clientHeight);
      const y = box.y + box.height / 2;
      const right = box.x + box.width * 0.9;
      // OrbitControls turns pi * dx / height radians at rotateSpeed 0.5: 180 deg per canvas height.
      const dragLeft = async (deg) => {
        await page.mouse.move(right, y);
        await page.mouse.down();
        await page.mouse.move(right - (height * deg) / 180, y, { steps: 12 });
        await page.mouse.up();
      };

      const start = await cameraOf(page);
      expect(start.yaw).toBe(-24);
      await dragLeft(130);
      await expect.poll(async () => (await cameraOf(page)).yaw).toBeGreaterThan(90);
      expect(yawGap((await cameraOf(page)).yaw, start.yaw + 130)).toBeLessThan(4);

      await dragLeft(60);
      await expect.poll(async () => (await cameraOf(page)).yaw).toBeGreaterThan(150);

      // The next drag crosses the 180 seam and keeps turning: yaw wraps to the negative side.
      await dragLeft(45);
      await expect.poll(async () => (await cameraOf(page)).yaw).toBeLessThan(-140);
      expect(yawGap((await cameraOf(page)).yaw, start.yaw + 235)).toBeLessThan(6);
      expect((await cameraOf(page)).pitch).toBe(24);

      // Dragging down lifts the eye to the 85 deg plan view.
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 12 });
      await page.mouse.up();
      await expect(stage).toHaveAttribute('data-camera-pitch', String(CAMERA_PITCH.max));
      await expect.poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY)).camera.pitch).toBe(85);
    }

    // The yaw slider spans the full turn, and keys step straight through the seam.
    await page.getByTestId('camera-settings-toggle').click();
    const yawSlider = page.getByTestId('camera-slider-yaw');
    await expect(yawSlider).toHaveAttribute('min', '-180');
    await expect(yawSlider).toHaveAttribute('max', '180');
    await expect(page.getByTestId('camera-slider-pitch')).toHaveAttribute('max', '85');
    await expect(page.getByTestId('camera-slider-zoom')).toHaveAttribute('max', '2.4');
    await yawSlider.focus();
    await page.keyboard.press('End');
    await expect(stage).toHaveAttribute('data-camera-yaw', '180');
    await page.keyboard.press('Escape');
    await stage.focus();
    await page.keyboard.press('ArrowRight');
    await expect(stage).toHaveAttribute('data-camera-yaw', '-175');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(stage).toHaveAttribute('data-camera-yaw', '175');
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowUp');
    await expect(stage).toHaveAttribute('data-camera-pitch', '85');

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('spacious envelopes and the wide inside-room lens', () => {
  test('presets, room ranges, the 78 deg lens and the backed-up stance agree in the engine', () => {
    expect(ROOM_WIDTH).toEqual({ min: 240, max: 900, initial: 320 });
    expect(ROOM_DEPTH).toEqual({ min: 200, max: 900, initial: 280 });
    expect(ROOM_HEIGHT).toEqual({ min: 220, max: 420, initial: 250 });
    expect(ROOM_SIZE_PRESETS.map(({ id, widthCm, depthCm, heightCm }) => [id, widthCm, depthCm, heightCm])).toEqual([
      ['compact', 320, 280, 250],
      ['living', 480, 420, 270],
      ['gallery', 640, 520, 300],
      ['loft', 800, 650, 340],
    ]);
    for (const preset of ROOM_SIZE_PRESETS) {
      expect(sanitizeRoom(preset)).toMatchObject({ widthCm: preset.widthCm, depthCm: preset.depthCm, heightCm: preset.heightCm });
      expect(roomSizePreset(sanitizeRoom(preset))).toBe(preset.id);
    }
    expect(roomSizePreset(sanitizeRoom(DEFAULT_ROOM))).toBe('compact');
    expect(roomSizePreset(sanitizeRoom({ widthCm: 481, depthCm: 420, heightCm: 270 }))).toBeNull();
    expect(sanitizeRoom({ widthCm: 1200, depthCm: 1200, heightCm: 900 })).toMatchObject({ widthCm: 900, depthCm: 900, heightCm: 420 });

    expect(INSIDE_FOV_DEG).toBe(78);
    expect(INSIDE_FOV).toEqual({ min: 50, max: 92 });
    expect(LOOK_PITCH).toEqual({ min: -65, max: 65 });
    expect(sanitizeInsideFov(120)).toBe(92);
    expect(sanitizeInsideFov(10)).toBe(50);
    expect(sanitizeInsideFov('wide')).toBe(78);
    expect(lookWalk({ xCm: 0, zCm: 0 }, 0, 80).pitchDeg).toBe(65);

    // The stance backs up to 78 percent of the way from the wall in view.
    const loft = sanitizeRoom(ROOM_SIZE_PRESETS[3]);
    expect(defaultStance(loft)).toEqual({ xCm: 400, zCm: 507, headingDeg: 0, pitchDeg: 0 });
    expect(defaultStance(loft, 'south')).toMatchObject({ xCm: 400, zCm: 143, headingDeg: 180 });
    expect(defaultStance(loft, 'east')).toMatchObject({ xCm: 176, zCm: 325, headingDeg: 90 });
    expect(defaultStance(loft, 'west')).toMatchObject({ xCm: 624, zCm: 325, headingDeg: -90 });
    for (const [wall, heading] of Object.entries(WALL_LOOK_HEADING)) {
      const stance = defaultStance(loft, wall);
      expect(stance.headingDeg).toBe(heading);
      expect(facingWall(stance, loft)).toBe(wall);
    }

    // Open floor in front of the eye, even with the bed against the north wall.
    const compact = createRoomState().room;
    const bed = { ...compact, furniture: 'bed-160' };
    expect(defaultStance(compact).zCm).toBe(218.4);
    expect(defaultStance(bed).zCm).toBe(232);

    // A resized envelope keeps the observer at the same relative spot.
    expect(rescaleStance(defaultStance(compact), compact, loft)).toMatchObject({ xCm: 400, zCm: 507 });
    const same = defaultStance(compact);
    expect(rescaleStance(same, compact, compact)).toBe(same);
  });

  test('scale presets grow the room; inside, the 78 deg lens stands backed up and the wheel swings it 50 to 92 deg', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openRoom(page);
    const stage = viewport(page);
    const renderer = await rendererOf(page);

    const presets = page.getByTestId('room-size-presets');
    await expect(presets.getByRole('button')).toHaveCount(4);
    await expect(page.getByTestId('room-preset-compact')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('room-preset-living')).toContainText('480 x 420 x 270');

    for (const [id, label] of [
      ['living', '480 x 420 x 270'],
      ['gallery', '640 x 520 x 300'],
      ['loft', '800 x 650 x 340'],
    ]) {
      await page.getByTestId(`room-preset-${id}`).click();
      await expect(page.getByTestId('room-label')).toHaveText(`Viewport / Room ${label} cm`);
      await expect(page.getByTestId(`room-preset-${id}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('room-preset-compact')).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(stage).toHaveAttribute('data-room-width', '800');
    await expect(stage).toHaveAttribute('data-room-depth', '650');
    await expect(stage).toHaveAttribute('data-room-height', '340');

    // A preset is one undo step.
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await expect(page.getByTestId('room-preset-gallery')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Redo' }).first().click();
    await expect(page.getByTestId('room-preset-loft')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('camera-mode-walkthrough').click();
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-camera-mode', 'inside');
    await expect(state).toHaveAttribute('data-fov-deg', '78');
    await expect(state).toHaveAttribute('data-x-cm', '400');
    await expect(state).toHaveAttribute('data-z-cm', '507');
    await expect(page.getByTestId('room-lens-readout')).toContainText('FOV 78');

    if (renderer !== 'unavailable') {
      // The inside rig mounts in the WebGL tree after the lens switch; wheel once it takes input.
      await expect(state).toHaveAttribute('data-lens-live', 'inside');
      const box = await stage.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      // Three notches out widen the lens 4 deg each; the page itself never scrolls.
      const scrollY = await page.evaluate(() => window.scrollY);
      for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, 100);
      await expect(state).toHaveAttribute('data-fov-deg', '90');
      await expect(page.getByTestId('room-lens-readout')).toContainText('FOV 90');
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
      // A burst in stops at the 50 deg detail lens.
      for (let i = 0; i < 14; i += 1) await page.mouse.wheel(0, -100);
      await expect(state).toHaveAttribute('data-fov-deg', String(INSIDE_FOV.min));
    }

    // Keys swing the lens too, and Home resets stance and lens together.
    await stage.focus();
    await page.keyboard.press('Home');
    await expect(state).toHaveAttribute('data-fov-deg', '78');
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    await expect(state).toHaveAttribute('data-fov-deg', '92');
    await page.keyboard.press('+');
    await expect(state).toHaveAttribute('data-fov-deg', '88');
    await page.getByTestId('walk-reset').click();
    await expect(state).toHaveAttribute('data-fov-deg', '78');
    await expect(state).toHaveAttribute('data-z-cm', '507');

    // Back to Compact: the observer is carried to the same relative spot.
    await page.getByTestId('room-preset-compact').click();
    await expect(state).toHaveAttribute('data-x-cm', '160');
    await expect(state).toHaveAttribute('data-z-cm', '218');

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('a wheel tick that lands right behind a lens commit is kept, not pulled back by the commit echo', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await openRoom(page);
    test.skip((await rendererOf(page)) === 'unavailable', 'The inside lens needs a WebGL context.');
    await page.getByTestId('camera-mode-walkthrough').click();
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-lens-live', 'inside');

    // The second tick is queued on the same delay as the 180 ms commit timer, so it
    // runs after the commit and before React renders the committed value.
    await page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="room-viewport"] canvas');
      const tick = () => canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
      tick();
      await new Promise((resolve) => {
        setTimeout(() => {
          tick();
          resolve();
        }, 180);
      });
    });
    await expect(state).toHaveAttribute('data-fov-deg', '86');
    await expect(page.getByTestId('room-lens-readout')).toContainText('FOV 86');

    // Leaving the lens takes the readiness flag down with the rig.
    await page.getByTestId('camera-mode-orbit').click();
    await expect(state).not.toHaveAttribute('data-lens-live', 'inside');
    expect(errors).toEqual([]);
  });
});

test.describe('navbar order and the overview 3D showcase', () => {
  test('3D Room sits beside Overview in page order; it glides to the showcase from any page and the launch key boots the studio full screen', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    expect(NAV_ROUTES.map((route) => route.label)).toEqual(['Overview', '3D Room', 'Catalog', 'Wall Studio']);
    expect(NAV_ROUTES.map((route) => route.index)).toEqual(['01', '02', '03', '04']);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveText(['Overview', '3D Room', 'Catalog', 'Wall Studio']);
    const navLink = page.getByTestId('nav-3d-showcase');
    await expect(navLink).toHaveText('3D Room');
    await expect(navLink).toHaveAttribute('href', `/#${SHOWCASE_3D_ID}`);
    await expect(nav.getByRole('link', { name: 'Wall Studio' })).toHaveAttribute('href', '/studio-2d');

    // The showcase is a canvas 2D projection: the overview still loads no planner or WebGL chunk.
    const showcase = page.getByTestId('home-3d-showcase');
    await expect(showcase).toHaveAttribute('id', SHOWCASE_3D_ID);
    await showcase.evaluate((el) => el.scrollIntoView());
    await expect(showcase.getByRole('heading', { level: 2 })).toHaveText(
      'Step inside a four-walled room before a single hole is drilled.',
    );
    await expect(showcase).toContainText('3D Spatial Studio');
    await expect(page.getByTestId('showcase-stage-canvas')).toBeVisible();
    for (const title of ['360-Degree Four-Wall Envelope', '165 cm Eye-Level Walkthrough', 'Direct 3D Raycast & Gizmo']) {
      await expect(showcase.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }
    const cta = page.getByTestId('launch-3d-studio-cta');
    await expect(cta).toContainText('Launch 3D Spatial Studio');
    await expect(page.getByRole('link', { name: 'Launch 3D Spatial Studio', exact: true })).toHaveAttribute('href', '/room-3d');
    await expect(cta).toHaveAttribute('href', '/room-3d');
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);
    expect(
      await showcase.evaluate((el) => [...el.querySelectorAll('canvas')].map((c) => [Boolean(c.getContext('2d')), c.getContext('webgl'), c.getContext('webgl2')])),
    ).toEqual([[true, null, null]]);

    // On the overview, 3D Room glides in place and lands on the section.
    await page.evaluate(() => window.scrollTo(0, 0));
    await navLink.click();
    await expect(page).toHaveURL(new RegExp(`/#${SHOWCASE_3D_ID}$`));
    await expect(showcase.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(showcase).toBeFocused();
    await expect(navLink).toHaveAttribute('aria-current', 'location');
    await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');

    // From another page it routes to the overview and glides there on arrival.
    await nav.getByRole('link', { name: 'Catalog' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog');
    await navLink.click();
    await expect(page).toHaveURL(new RegExp(`/#${SHOWCASE_3D_ID}$`));
    await expect(showcase.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);

    // The launch key enters the planner under a full-viewport engine boot.
    await cta.click();
    await expect(page).toHaveURL(/\/room-3d$/);
    const boot = bootOverlay(page);
    await expect(boot).toHaveAttribute('data-state', 'booting');
    const cover = await boot.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const nav = document.querySelector('header.navbar').getBoundingClientRect();
      return {
        parent: el.parentElement.tagName,
        position: style.position,
        zIndex: style.zIndex,
        background: style.backgroundColor,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        coversNav: rect.top <= nav.top && rect.bottom >= nav.bottom && rect.left <= nav.left && rect.right >= nav.right,
      };
    });
    expect(cover).toMatchObject({ parent: 'BODY', position: 'fixed', zIndex: '9999', x: 0, y: 0, coversNav: true });
    expect(cover.width).toBe(cover.innerWidth);
    expect(cover.height).toBe(cover.innerHeight);
    await expect(boot).toContainText(ENGINE_LABEL);
    // Layout sizes, not painted boxes: the panel itself is still pulling focus from 1.05.
    await expect(boot.locator('.studio-boot__mark')).toHaveCSS('width', '56px');
    await expect(boot.locator('.studio-boot__bar')).toHaveCSS('width', '240px');
    await expect(page.locator('.room3d-workstation')).toHaveAttribute('data-boot', 'booting');
    await expect(nav.getByRole('link', { name: '3D Room' })).toHaveAttribute('aria-current', 'page');

    // It lifts with a defocus while the workstation settles into place.
    await expect(boot).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await expect(page.locator('.room3d-workstation')).toHaveAttribute('data-boot', 'done');
    await expect(boot).toHaveCSS('pointer-events', 'none');
    await expect(boot).toHaveCSS('transition-duration', /0\.55s/);
    await expect(boot).toHaveCSS('filter', 'blur(10px)');
    await expect(boot).toHaveCSS('transform', 'matrix(1.025, 0, 0, 1.025, 0, 0)');
    await expect(boot).toHaveCSS('opacity', '0');
    await expect(boot).toBeHidden();
    await expect
      .poll(() => page.locator('.room3d-workstation').evaluate((el) => getComputedStyle(el).transform))
      .toBe('none');

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  for (const width of [360, 1024]) {
    test(`the full-screen boot never takes the pointer, skips on Enter Studio Now and keeps the page free of overflow at ${width}px`, async ({
      page,
    }) => {
      const errors = collectRuntimeErrors(page);
      const held = { state: 'booting', x: 0, y: 0, height: 800, overflow: 0, navbarUnder: true };
      await page.setViewportSize({ width, height: 800 });
      // A held engine never reports ready, so the boot and its replays stay up until Enter Studio
      // Now: no step races the overlay's wall-clock hold.
      const releaseEngine = await holdEngineChunk(page);
      await openRoom(page);
      const boot = bootOverlay(page);
      await expect(boot).toHaveAttribute('data-state', 'booting');
      await expect(boot).toHaveAttribute('data-run', '0');
      expect(await bootFrame(boot)).toEqual(held);
      await page.getByTestId('skip-studio-boot').click();
      await expect(boot).toHaveAttribute('data-state', 'done');
      await expect(boot).toBeHidden();

      // A replay pulls focus back in from the lifted 1.025 scale, then holds the full window.
      await page.getByTestId('replay-studio-boot').click();
      await expect(boot).toHaveAttribute('data-run', '1');
      await expect(boot).toHaveAttribute('data-state', 'booting');
      expect(await bootFrame(boot)).toEqual(held);
      await page.getByTestId('skip-studio-boot').click();
      await expect(boot).toHaveAttribute('data-state', 'done');
      await expect(boot).toBeHidden();

      // Released, the engine boots. A replay on the ready engine clears itself, and the run
      // counter only goes up, so it proves the replay started however briefly it showed.
      releaseEngine();
      await rendererOf(page);
      await page.getByTestId('replay-studio-boot').click();
      await expect(boot).toHaveAttribute('data-run', '2');
      await expect(boot).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
      await expect(boot).toBeHidden();
      expect(errors).toEqual([]);
    });
  }
});

test.describe('calm 2D wall studio', () => {
  test('Visual mode recedes the grid and ruler numbers, Specs brings them back, the toolbar bridges to 3D', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/studio-2d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wall Studio');
    await page.getByRole('button', { name: 'Load preset Nordic Reading Wall' }).click();

    const wall = page.getByTestId('wall-canvas');
    const label = page.locator('.wall-ruler__label').first();
    await expect(page.locator('.studio-layout')).toHaveAttribute('data-mode', 'architectural');
    await expect.poll(() => wall.evaluate((el) => getComputedStyle(el).getPropertyValue('--grid-minor').trim())).toBe(
      'rgba(242, 238, 231, 0)',
    );
    await expect(label).toHaveCSS('opacity', '0');

    // The engineering keys sit in a quiet, compact strip; the 3D bridge is the prominent key.
    const strip = page.locator('.studio-toolbar__cluster--quiet');
    await expect(strip).toHaveAttribute('aria-label', 'Engineering overlays and export');
    for (const name of ['24V Bus', 'Iso-Lux Map', 'Blueprint', 'Export JSON', 'Import JSON']) {
      const key = strip.getByRole('button', { name, exact: true });
      await expect(key).toBeVisible();
      await expect(key).toHaveCSS('height', '24px');
    }
    await expect(page.locator('.studio-toolbar__cluster')).toHaveCount(3);
    const summary = page.getByTestId('wall-summary');
    await expect(summary.getByTestId('bus-run-telemetry')).toBeVisible();
    await expect(summary.getByTestId('environmental-physics')).toBeVisible();
    await expect(summary.locator('.studio-summary__engineering-title')).toHaveCSS('text-transform', 'uppercase');

    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Technical' }).click();
    await expect(page.locator('.studio-layout')).toHaveAttribute('data-mode', 'technical');
    await expect(label).toHaveCSS('opacity', '1');
    // Registered colours serialise with 8-bit alpha: 0.028 reads back as 0.027.
    const minorAlpha = () =>
      wall.evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--grid-minor').trim().split(',')[3]?.replace(')', '')));
    await expect.poll(minorAlpha).toBeCloseTo(0.028, 2);
    await page.getByRole('group', { name: 'Display mode' }).getByRole('button', { name: 'Visual' }).click();
    await expect(label).toHaveCSS('opacity', '0');

    const bridge = page.getByTestId('studio-open-3d');
    await expect(bridge).toHaveText('Open in 3D Studio');
    await expect(bridge).toHaveAttribute('href', '/room-3d');
    await bridge.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    expect(errors).toEqual([]);
  });
});

const RESTING = 'matrix(1, 0, 0, 1, 0, 0)';
const RETRACTED = 'matrix(0, 0, 0, 1, 0, 0)';

function underline(link) {
  return link.evaluate((el) => getComputedStyle(el, '::after').transform);
}

async function expectCurrent(link, value) {
  await expect(link).toHaveAttribute('aria-current', value);
  await expect(link).toHaveClass(/(^|\s)active(\s|$)/);
  await expect.poll(() => underline(link)).toBe(RESTING);
}

async function expectIdle(link) {
  await expect(link).not.toHaveAttribute('aria-current');
  await expect(link).not.toHaveClass(/(^|\s)active(\s|$)/);
  await expect.poll(() => underline(link)).toBe(RETRACTED);
}

function stageOf(page) {
  return page.getByTestId('showcase-stage');
}

function fillScale(page, act) {
  return page
    .getByTestId(`showcase-act-${act}`)
    .locator('.theatre__act-fill')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
}

test.describe('scroll-spy navbar, showcase theatre and studio launchpad', () => {
  test('engine: four acts, 5 cm gizmo ticks, an eye-level lens landed on the shell and a lit field with all three iso-lines', () => {
    expect(ACT_IDS).toEqual(['orbit', 'inside', 'gizmo', 'isolux']);
    expect(ACT_SECONDS).toBe(7);
    expect(ACT_DURATION_MS).toBe(7000);
    const gallery = ROOM_SIZE_PRESETS.find((preset) => preset.id === 'gallery');
    expect(STAGE_ROOM).toMatchObject({ widthCm: gallery.widthCm, depthCm: gallery.depthCm, heightCm: gallery.heightCm });

    // Every gizmo pose sits on the snap grid and inside the wall; the act ends where it began.
    const xs = new Set();
    for (let t = 0; t < ACT_SECONDS; t += 0.05) {
      const pose = gizmoPose(t);
      expect(pose.x % SNAP_CM).toBe(0);
      expect(pose.y % SNAP_CM).toBe(0);
      const dims = shelfDimensions(pose);
      expect(dims.x + 110 + dims.r).toBe(STAGE_ROOM.widthCm);
      expect(dims.y + 5 + dims.c).toBe(STAGE_ROOM.heightCm);
      xs.add(pose.x);
    }
    expect(xs.size).toBeGreaterThan(10);
    expect(gizmoPose(0)).toMatchObject({ x: 140, y: 145 });
    expect(gizmoPose(ACT_SECONDS - 1e-6)).toMatchObject({ x: 140, y: 145 });
    expect(gizmoPose(ACT_SECONDS * 0.25).axis).toBe('x');
    expect(gizmoPose(ACT_SECONDS * 0.6).axis).toBe('y');
    expect(gizmoPose(ACT_SECONDS * 0.85).axis).toBe('xy');

    // The 78 deg lens: every ray lands on a wall, the floor or the ceiling.
    const { widthCm: W, depthCm: D, heightCm: H } = STAGE_ROOM;
    for (const heading of [-82, 0, 82]) {
      const lens = eyeFrustum(heading);
      expect(lens.ring).toHaveLength(24);
      for (const p of [...lens.ring, lens.centre]) {
        const onShell = [p[0], W - p[0], p[1], H - p[1], p[2], D - p[2]].some((gap) => Math.abs(gap) < 1e-6);
        expect(onShell).toBe(true);
        expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(p[2]).toBeLessThanOrEqual(D + 1e-6);
      }
    }
    expect(eyeFrustum(0).centre[2]).toBeCloseTo(0, 6);
    expect(eyeFrustum(90).centre[0]).toBeCloseTo(W, 6);
    // Facing the pendant reads more light at the eye than facing a side wall.
    expect(eyeIlluminance(0)).toBeGreaterThan(eyeIlluminance(80));
    expect(eyeIlluminance(0)).toBeGreaterThan(150);
    expect(eyeIlluminance(0)).toBeLessThan(500);

    // Marching squares on a cone: one ring of segments, every end on the 3-unit circle.
    const cone = Array.from({ length: 9 }, (_, j) => Array.from({ length: 9 }, (_, i) => 10 - Math.hypot(i - 4, j - 4)));
    const ring = isoSegments(cone, 7);
    expect(ring.length).toBeGreaterThanOrEqual(8);
    for (const [a, b] of ring) for (const [i, j] of [a, b]) expect(Math.abs(Math.hypot(i - 4, j - 4) - 3)).toBeLessThan(0.35);

    const field = buildLuxField();
    expect(field.surfaces.map((surface) => surface.id)).toEqual(['floor', 'north', 'east', 'south', 'west']);
    const floor = field.surfaces[0];
    expect(floor.peak).toBeGreaterThan(Math.max(...ISO_LEVELS));
    expect(floor.peak).toBeLessThan(1200);
    for (const { level, segments } of floor.contours) {
      expect(ISO_LEVELS).toContain(level);
      expect(segments.length, `${level} lx`).toBeGreaterThan(0);
      for (const [a] of segments) expect(a[1]).toBeGreaterThan(0);
    }
    expect(floor.labels.every((entry) => Array.isArray(entry.anchor))).toBe(true);
  });

  test('launch links: lens and scale read against the planner allow-lists and leave the address bar clean', () => {
    expect(launchHref({ lens: 'orbit' })).toBe('/room-3d?lens=orbit');
    expect(launchHref({ lens: 'inside' })).toBe('/room-3d?lens=inside');
    expect(launchHref({ scale: 'loft', lens: 'inside' })).toBe('/room-3d?scale=loft&lens=inside');
    expect(launchHref()).toBe('/room-3d');

    const allow = { lenses: CAMERA_MODES, scales: ROOM_SIZE_PRESETS.map((preset) => preset.id) };
    expect(readLaunchPreset('?scale=loft&lens=inside', allow)).toEqual({ present: true, lens: 'inside', scale: 'loft' });
    expect(readLaunchPreset('?lens=orbit', allow)).toEqual({ present: true, lens: 'orbit', scale: null });
    expect(readLaunchPreset('?lens=constructor&scale=__proto__', allow)).toEqual({ present: true, lens: null, scale: null });
    expect(readLaunchPreset('?lens=INSIDE&scale=loft%00', allow)).toEqual({ present: true, lens: null, scale: null });
    expect(readLaunchPreset('?scene=abc', allow)).toEqual({ present: false, lens: null, scale: null });
    expect(stripLaunchParams('?scale=loft&lens=inside')).toBe('');
    expect(stripLaunchParams('?lens=inside&scene=abc')).toBe('?scene=abc');
  });

  test('the navbar underline follows the overview: Overview above the showcase, 3D Room inside it, Catalog on the modules, held through a glide and handed back on the way up', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const overview = nav.getByRole('link', { name: 'Overview' });
    const room = page.getByTestId('nav-3d-showcase');
    const showcase = page.getByTestId('home-3d-showcase');

    await expectCurrent(overview, 'page');
    await expectIdle(room);

    // Scrolled into the showcase, the underline crosses to 3D Room.
    await showcase.evaluate((el) => el.scrollIntoView());
    await expectCurrent(room, 'location');
    await expectIdle(overview);

    // On down into Core Modules, the next tab along takes it; back up through the Surface Lab, Overview does.
    const catalog = nav.getByRole('link', { name: 'Catalog' });
    await page.getByTestId('core-modules').evaluate((el) => el.scrollIntoView());
    await expectCurrent(catalog, 'location');
    await expectIdle(room);
    await expectIdle(overview);
    await showcase.evaluate((el) => el.scrollIntoView());
    await expectCurrent(room, 'location');
    await expectIdle(catalog);
    await page.getByTestId('surface-lab').evaluate((el) => el.scrollIntoView());
    await expectCurrent(overview, 'page');
    await showcase.evaluate((el) => el.scrollIntoView());
    await expectCurrent(room, 'location');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectCurrent(overview, 'page');
    await expectIdle(room);

    // A click hands the underline over at once and holds it for the whole glide. Sampling
    // runs for 900 ms and at least six frames, so a loaded runner drawing few frames a
    // second still proves the hold frame by frame.
    const samples = await page.evaluate(async () => {
      const link = document.querySelector('[data-testid="nav-3d-showcase"]');
      const seen = [];
      link.click();
      const until = performance.now() + 900;
      while (performance.now() < until || seen.length < 6) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        seen.push(`${link.getAttribute('aria-current')} ${window.scrollY > 0}`);
      }
      return seen;
    });
    expect(samples.length).toBeGreaterThan(5);
    expect(new Set(samples.map((sample) => sample.split(' ')[0]))).toEqual(new Set(['location']));
    expect(samples.at(-1)).toBe('location true');
    await expect(showcase.getByRole('heading', { level: 2 })).toBeInViewport();
    await expectCurrent(room, 'location');
    await expectIdle(overview);

    // The reader's own scroll takes over from the glide's hold.
    const box = await showcase.getByRole('heading', { level: 2 }).boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(400);
    await expectCurrent(overview, 'page');
    await expectIdle(room);

    // A cold load on the anchor opens with 3D Room current; the planner keeps it as the page.
    await page.goto('/catalog');
    await page.goto(`/#${SHOWCASE_3D_ID}`);
    await expect(showcase.getByRole('heading', { level: 2 })).toBeInViewport();
    await expectCurrent(room, 'location');
    await expectIdle(overview);
    await page.goto('/room-3d');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expectCurrent(room, 'page');
    await expectIdle(overview);

    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the theatre paints a 2D projection, cycles four acts, holds one on a key or card, probes lux under the cursor and loads no WebGL', async ({
    page,
  }) => {
    // Three full 7 s acts run in real time here (cycle, hold, cycle again).
    test.setTimeout(90_000);
    const errors = collectRuntimeErrors(page);
    const scripts = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const stage = stageOf(page);
    const canvas = page.getByTestId('showcase-stage-canvas');
    await stage.scrollIntoViewIfNeeded();
    await expect(canvas).toBeVisible();
    await expect(stage).toHaveAttribute('data-act', 'orbit');
    await expect(canvas).toHaveAttribute('data-act', 'orbit');
    await expect(canvas).toHaveAttribute('role', 'img');

    // A 2D context at device resolution, with the room actually painted into it.
    await expect
      .poll(() =>
        canvas.evaluate((el) => {
          const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
          let lit = 0;
          for (let i = 3; i < data.length; i += 16) if (data[i] > 0) lit += 1;
          return lit / (data.length / 16);
        }),
      )
      .toBeGreaterThan(0.2);
    const surface = await canvas.evaluate((el) => ({ width: el.width, cssWidth: el.clientWidth, webgl: el.getContext('webgl2') }));
    expect(surface.webgl).toBeNull();
    expect(surface.width).toBeGreaterThanOrEqual(surface.cssWidth);

    const acts = page.getByRole('group', { name: 'Stage acts' }).getByRole('button');
    await expect(acts).toHaveCount(4);
    for (const id of ACT_IDS) await expect(page.getByTestId(`showcase-act-${id}`)).toBeVisible();
    await expect(page.getByTestId('showcase-act-orbit')).toHaveAttribute('data-active', 'true');

    // The orbit turns on its own and the act clock fills the live key.
    const az = page.locator('[data-hud="az"]');
    const firstAz = await az.innerText();
    await expect.poll(() => az.innerText()).not.toBe(firstAz);
    await expect.poll(() => fillScale(page, 'orbit')).toBeGreaterThan(0.2);
    await expect(page.getByTestId('showcase-readout')).toHaveText('24V DC daisy chain / 5 nodes / 2700K');

    // After one act the stage moves on by itself to the eye-level sweep. The act clock runs
    // on frame dt clamped at 50 ms, so a slow software-raster runner stretches it: wait wide.
    await expect(stage).toHaveAttribute('data-act', 'inside', { timeout: 20_000 });
    await expect(page.getByTestId('showcase-pillar-inside')).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('showcase-readout')).toHaveText(/^Eye 165 cm \/ FOV 78 deg \/ \d+ lx$/);
    const lux = new Set();
    for (let i = 0; i < 8; i += 1) {
      lux.add(await page.getByTestId('showcase-readout').innerText());
      await page.waitForTimeout(120);
    }
    expect(lux.size).toBeGreaterThan(1);

    // A key holds its act past the act length; the shelf slides on 5 cm ticks meanwhile.
    const gizmoKey = page.getByTestId('showcase-act-gizmo');
    await gizmoKey.click();
    await expect(stage).toHaveAttribute('data-act', 'gizmo');
    await expect(gizmoKey).toHaveAttribute('aria-pressed', 'true');
    await expect(stage).toHaveAttribute('data-held', 'true');
    const readout = page.getByTestId('showcase-readout');
    await expect(readout).toHaveText(/^X: \d+ cm \/ Y: \d+ cm \/ R: \d+ cm \/ C: \d+ cm$/);
    const poses = new Set();
    const deadline = Date.now() + (ACT_SECONDS + 0.6) * 1000;
    while (Date.now() < deadline) {
      const text = await readout.innerText();
      const [x, y, r, c] = text.match(/\d+/g).map(Number);
      expect(x % SNAP_CM).toBe(0);
      expect(y % SNAP_CM).toBe(0);
      expect(x + 110 + r).toBe(STAGE_ROOM.widthCm);
      expect(y + 5 + c).toBe(STAGE_ROOM.heightCm);
      poses.add(text);
      await page.waitForTimeout(150);
    }
    expect(poses.size).toBeGreaterThan(3);
    await expect(stage).toHaveAttribute('data-act', 'gizmo');
    expect(await fillScale(page, 'gizmo')).toBe(1);

    // Pressing the held key again lets the cycle run on.
    await gizmoKey.click();
    await expect(gizmoKey).toHaveAttribute('aria-pressed', 'false');
    await expect(stage).not.toHaveAttribute('data-held');
    await page.mouse.move(4, 400);
    await expect(stage).toHaveAttribute('data-act', 'isolux', { timeout: 20_000 });
    await expect(readout).toHaveText(/^Iso-lux 100 \/ 250 \/ 500 lx \/ Floor peak \d+ lx$/);

    // Hovering a capability card previews its act and lights the card; leaving hands the stage back.
    const eyeCard = page.getByTestId('showcase-pillar-inside');
    await eyeCard.hover();
    await expect(stage).toHaveAttribute('data-act', 'inside');
    await expect(eyeCard).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('showcase-pillar-orbit')).not.toHaveAttribute('data-active');
    await page.mouse.move(4, 400);
    await expect(stage).toHaveAttribute('data-act', 'isolux');
    await expect(eyeCard).not.toHaveAttribute('data-active');

    // Clicking a card holds its act, and its title key reports the hold.
    const orbitCard = page.getByTestId('showcase-pillar-orbit');
    await orbitCard.click();
    await page.mouse.move(4, 400);
    await expect(stage).toHaveAttribute('data-act', 'orbit');
    await expect(orbitCard.getByRole('button', { name: '360-Degree Four-Wall Envelope' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('showcase-act-orbit')).toHaveAttribute('aria-pressed', 'true');

    // Over the stage the cursor probes the floor under it; off the stage the act's own reading returns.
    const luxOut = page.locator('[data-hud="lux"]');
    await expect(luxOut).toHaveText(/^\d{3,}$/);
    const resting = await luxOut.innerText();
    const box = await canvas.boundingBox();
    const probed = new Set();
    for (const [fx, fy] of [
      [0.32, 0.62],
      [0.5, 0.7],
      [0.66, 0.58],
      [0.44, 0.48],
    ]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 4 });
      await page.waitForTimeout(80);
      probed.add(await luxOut.innerText());
    }
    expect([...probed].some((value) => value !== resting)).toBe(true);
    // Pointer motion never re-renders React: the stage keeps its act through all of it.
    await expect(stage).toHaveAttribute('data-act', 'orbit');
    await page.mouse.move(4, 400);
    await expect(luxOut).toHaveText(resting);

    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await readCspViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the theatre holds a still per act; keys still switch it', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const stage = stageOf(page);
    await stage.scrollIntoViewIfNeeded();
    const az = page.locator('[data-hud="az"]');
    await expect(az).toHaveText(/^\d{3}$/);
    const still = await az.innerText();
    await page.waitForTimeout(1200);
    await expect(az).toHaveText(still);
    expect(await fillScale(page, 'orbit')).toBe(1);

    await page.getByTestId('showcase-act-isolux').click();
    await expect(stage).toHaveAttribute('data-act', 'isolux');
    await expect(page.getByTestId('showcase-readout')).toHaveText(/^Iso-lux/);
    await page.mouse.move(4, 400);
    const isoAz = await az.innerText();
    await page.waitForTimeout(800);
    await expect(az).toHaveText(isoAz);
    expect(errors).toEqual([]);
  });

  test('the launch bar is one slim row under the rig: the studio key and three presets stay anchored on hover; the Grand Loft preset opens at eye level in 800 x 650 x 340 cm', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const pad = page.getByTestId('showcase-launchpad');
    await pad.scrollIntoViewIfNeeded();
    await expect(pad).toBeVisible();
    await expect(pad).toHaveAttribute('data-reveal-settled', '');
    await expect(pad.getByRole('heading', { level: 3, name: 'Step inside the 3D Spatial Workstation.' })).toBeVisible();
    await expect(pad).toHaveCSS('border-top-color', 'rgba(232, 146, 58, 0.28)');
    expect(await pad.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('radial-gradient');

    // Compact and integrated: one row under 110 px, flush under the theatre and its cards, no filler copy.
    const [padBox, rigBox] = await Promise.all([pad.boundingBox(), page.locator('.showcase3d__rig').boundingBox()]);
    expect(padBox.height).toBeLessThan(110);
    expect(padBox.y - (rigBox.y + rigBox.height)).toBeGreaterThanOrEqual(0);
    expect(padBox.y - (rigBox.y + rigBox.height)).toBeLessThanOrEqual(24);
    expect(Math.abs(padBox.width - rigBox.width)).toBeLessThanOrEqual(1);
    await expect(pad.locator('.launchpad__lede, .launchpad__status, .launchpad__spec')).toHaveCount(0);

    const cta = page.getByTestId('launch-3d-studio-cta');
    await expect(cta).toHaveAttribute('href', '/room-3d');
    await expect(cta).toHaveCSS('min-height', '54px');
    await expect(cta).toHaveCSS('padding-left', '28px');
    await expect(cta).toHaveCSS('padding-right', '28px');
    await expect(cta).toHaveCSS('font-size', '15px');
    await expect(cta).toHaveCSS('font-weight', '600');
    await expect(cta.locator('.launchpad__cta-glyph svg')).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox.height).toBeGreaterThanOrEqual(54);
    // The key, the pills and the headline share the bar's one row.
    for (const box of [ctaBox, await pad.getByRole('heading', { level: 3 }).boundingBox()]) {
      expect(box.y).toBeGreaterThanOrEqual(padBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(padBox.y + padBox.height);
    }

    const presets = [
      ['orbit', '/room-3d?lens=orbit', 'Launch 360 Orbit'],
      ['inside', '/room-3d?lens=inside', 'Launch 165 cm Eye Level'],
      ['loft', '/room-3d?scale=loft&lens=inside', 'Launch Grand Loft'],
    ];
    for (const [id, href, name] of presets) {
      const link = page.getByTestId(`launch-preset-${id}`);
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAccessibleName(name);
      await expect(link).toHaveCSS('height', '40px');
      const box = await link.boundingBox();
      expect(Math.abs(box.y + box.height / 2 - (ctaBox.y + ctaBox.height / 2))).toBeLessThanOrEqual(1);
    }

    // Every key stays anchored under the pointer: no lift, no magnetic drift, no offset
    // plinth (the old brown #6f5230 slab); only its arrow travels, 3 px to the right.
    const loft = page.getByTestId('launch-preset-loft');
    for (const key of [loft, cta]) {
      const rest = await key.boundingBox();
      await key.hover();
      await expect
        .poll(() => key.locator('svg[class$="-arrow"]').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e))
        .toBe(3);
      const held = await key.boundingBox();
      expect(Math.abs(held.x - rest.x) + Math.abs(held.y - rest.y)).toBeLessThan(0.5);
      const look = await key.evaluate((el) => {
        const style = getComputedStyle(el);
        return { transform: style.transform, translate: style.translate, layers: style.boxShadow.split(/,(?![^(]*\))/).map((layer) => layer.trim()) };
      });
      expect(look.transform).toBe('none');
      expect(look.translate).toBe('none');
      for (const layer of look.layers) expect(layer === 'none' || layer.includes('inset'), layer).toBe(true);
      expect(look.layers.join(' ')).not.toContain('111, 82, 48');
    }
    // The cap brightens in place: a lighter champagne layer fades in under the label, the glyph holds still.
    await expect.poll(() => cta.evaluate((el) => getComputedStyle(el, '::before').opacity)).toBe('1');
    await expect(cta.locator('.launchpad__cta-glyph svg')).toHaveCSS('transform', 'none');
    await expect(cta).toHaveCSS('box-shadow', 'rgba(255, 255, 255, 0.45) 0px 1px 0px 0px inset');
    // Lifted, not lit: nothing under a hovered preset or the studio key carries blur.
    for (const control of [loft, cta]) {
      const blur = await control.evaluate((el) =>
        getComputedStyle(el)
          .boxShadow.split(/,(?![^(]*\))/)
          .map((layer) => Number.parseFloat((layer.match(/-?\d*\.?\d+px/g) ?? [])[2] ?? '0')),
      );
      expect(Math.max(0, ...blur)).toBe(0);
    }

    await loft.click();
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    const stage = viewport(page);
    await expect(stage).toHaveAttribute('data-room-width', '800');
    await expect(stage).toHaveAttribute('data-room-depth', '650');
    await expect(stage).toHaveAttribute('data-room-height', '340');
    await expect(page.getByTestId('room-preset-loft')).toHaveAttribute('aria-pressed', 'true');
    const state = walkState(page);
    await expect(state).toHaveAttribute('data-camera-mode', 'inside');
    await expect(state).toHaveAttribute('data-fov-deg', '78');
    await expect(state).toHaveAttribute('data-x-cm', '400');
    await expect(state).toHaveAttribute('data-z-cm', '507');
    await expect(page.getByTestId('camera-mode-walkthrough')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('room-notice')).toHaveText('Launched Grand Loft 800 x 650 x 340 cm, Inside Room (165 cm) lens.');
    await expect.poll(async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), ROOM_KEY)).room.widthCm).toBe(800);

    // A reload opens the studio as left, not as the link asked.
    await expect(bootOverlay(page)).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
    await page.getByTestId('camera-mode-orbit').click();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Room Planner');
    await expect(walkState(page)).toHaveAttribute('data-camera-mode', 'orbit');
    expect(errors).toEqual([]);
  });

  test('a lens link alone keeps the envelope; unknown lens and scale values are ignored and stripped', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.goto('/room-3d?lens=inside');
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(walkState(page)).toHaveAttribute('data-camera-mode', 'inside');
    await expect(viewport(page)).toHaveAttribute('data-room-width', '320');
    await expect(walkState(page)).toHaveAttribute('data-x-cm', '160');

    await page.goto('/room-3d?lens=%3Cimg%20src%3Dx%3E&scale=__proto__');
    await expect(page).toHaveURL(/\/room-3d$/);
    await expect(walkState(page)).toHaveAttribute('data-camera-mode', 'orbit');
    await expect(viewport(page)).toHaveAttribute('data-room-width', '320');
    await expect(page.getByTestId('room-preset-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => Object.prototype.polluted)).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('at phone width the theatre, act keys and launchpad stack without overflow', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/#${SHOWCASE_3D_ID}`);
    const stage = stageOf(page);
    await stage.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('showcase-stage-canvas')).toBeVisible();
    const columns = await page
      .getByRole('group', { name: 'Stage acts' })
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    const pad = page.getByTestId('showcase-launchpad');
    await pad.scrollIntoViewIfNeeded();
    const padBox = await pad.boundingBox();
    const ctaBox = await page.getByTestId('launch-3d-studio-cta').boundingBox();
    expect(ctaBox.width).toBeGreaterThan(padBox.width * 0.7);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
});

/** Index of the navbar link that reads as current, or -1. */
function currentTabIndex() {
  return [...document.querySelectorAll('.navbar__links a')].findIndex((link) => link.hasAttribute('aria-current'));
}

function maxBlurPx(el) {
  return Math.max(
    0,
    ...getComputedStyle(el)
      .boxShadow.split(/,(?![^(]*\))/)
      .map((layer) => Number.parseFloat((layer.match(/-?\d*\.?\d+px/g) ?? [])[2] ?? '0')),
  );
}

test.describe('page-order scroll-spy, calm turntable and champagne launch key', () => {
  test('scrolling the overview walks the underline one tab at a time, left to right going down and right to left coming back', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const links = nav.getByRole('link');
    await expect(links).toHaveText(['Overview', '3D Room', 'Catalog', 'Wall Studio']);

    // The tabs sit left to right in page order, and so do the sections they stand for.
    const lefts = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().left));
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    const tops = await page.evaluate(() =>
      ['surface-lab', 'home-3d-showcase', 'core-modules', 'workspaces'].map(
        (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top + window.scrollY,
      ),
    );
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    await expect(page.getByTestId('home-3d-showcase')).toContainText('03 / 3D Spatial Studio');
    await expect(page.getByTestId('core-modules')).toContainText('04 / Core Modules');
    await expect(page.getByTestId('workspaces')).toContainText('05 / Workspaces');
    await expect(page.getByTestId('workspaces').locator('.entry-card .index-label')).toHaveText([
      '02 / 3D Room',
      '03 / Catalog',
      '04 / Wall Studio',
    ]);

    // Step the page in 90 px increments and log every change of the current tab.
    const walk = (direction) =>
      page.evaluate(async (dir) => {
        const read = () =>
          [...document.querySelectorAll('.navbar__links a')].findIndex((link) => link.hasAttribute('aria-current'));
        const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const seen = [read()];
        for (let i = 0; i <= Math.ceil(max / 90); i += 1) {
          const y = dir === 'down' ? Math.min(max, i * 90) : Math.max(0, max - i * 90);
          window.scrollTo({ top: y, behavior: 'instant' });
          await settle();
          const now = read();
          if (now !== seen.at(-1)) seen.push(now);
        }
        return seen;
      }, direction);

    expect(await walk('down')).toEqual([0, 1, 2, 3]);
    await expect(nav.getByRole('link', { name: 'Wall Studio' })).toHaveAttribute('aria-current', 'location');
    expect(await walk('up')).toEqual([3, 2, 1, 0]);
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(currentTabIndex)).toBe(0);

    // The spied tabs still route straight to their workspaces.
    const catalog = nav.getByRole('link', { name: 'Catalog' });
    await page.getByTestId('core-modules').evaluate((el) => el.scrollIntoView());
    await expect(catalog).toHaveAttribute('aria-current', 'location');
    await expect(catalog).toHaveAttribute('href', '/catalog');
    await catalog.click();
    await expect(page).toHaveURL(/\/catalog$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Catalog');
    await expect(catalog).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/light and storage/i);
    const studio = nav.getByRole('link', { name: 'Wall Studio' });
    await page.getByTestId('workspaces').evaluate((el) => el.scrollIntoView());
    await expect(studio).toHaveAttribute('aria-current', 'location');
    await studio.click();
    await expect(page).toHaveURL(/\/studio-2d$/);
    await expect(studio).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });

  test('the turntable is calm: a 20 deg/s yaw, a 27 to 35 deg pitch swell, drifting pulses and 7 s acts', async ({
    page,
  }) => {
    expect(ORBIT_DEG_PER_S).toBeGreaterThanOrEqual(18);
    expect(ORBIT_DEG_PER_S).toBeLessThanOrEqual(22);
    expect(actSpinRate('orbit')).toBe(ORBIT_DEG_PER_S);
    expect(ORBIT_PITCH).toEqual({ min: 27, max: 35 });
    const pitches = Array.from({ length: 141 }, (_, i) => actCamera('orbit', (i / 140) * ACT_SECONDS, 0, 0).pitch);
    expect(Math.min(...pitches)).toBeCloseTo(27, 6);
    expect(Math.max(...pitches)).toBeCloseTo(35, 6);
    expect(pitches[0]).toBeCloseTo(27, 6);
    expect(pitches[70]).toBeCloseTo(35, 6);
    expect(PULSE_SPEED_CM_S).toBeLessThanOrEqual(80);
    expect(ACT_DURATION_MS).toBe(ACT_SECONDS * 1000);

    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const stage = stageOf(page);
    await stage.scrollIntoViewIfNeeded();
    // Held on the orbit, so no act change swings the camera mid-sample.
    await page.getByTestId('showcase-act-orbit').click();
    await expect(stage).toHaveAttribute('data-held', 'true');
    await page.mouse.move(4, 400);
    await expect(page.locator('[data-hud="az"]')).toHaveText(/^\d{3}$/);
    await page.waitForTimeout(800);

    const rate = await page.evaluate(async () => {
      const el = document.querySelector('[data-hud="az"]');
      const read = () => Number(el.textContent);
      let last = read();
      let turned = 0;
      const start = performance.now();
      while (performance.now() - start < 2500) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const now = read();
        turned += Math.abs(((((now - last) % 360) + 540) % 360) - 180);
        last = now;
      }
      return turned / ((performance.now() - start) / 1000);
    });
    expect(rate).toBeGreaterThan(2);
    expect(rate).toBeLessThanOrEqual(25);
    expect(errors).toEqual([]);
  });

  test('the capability cards read at a glance: index and glyph badge, a title, one short sentence and two spec pills', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const expected = {
      orbit: ['01', '360-Degree Four-Wall Envelope', ['Full 360-Degree Orbit', 'Up to 9 x 9 m Loft']],
      inside: ['02', '165 cm Eye-Level Walkthrough', ['165 cm Eye Height', 'Live Eye Lux']],
      gizmo: ['03', 'Direct 3D Raycast & Gizmo', ['5 cm Grid Snap', 'X and Y Axis Locks']],
    };
    for (const [act, [index, title, chips]] of Object.entries(expected)) {
      const card = page.getByTestId(`showcase-pillar-${act}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card.locator('.showcase3d__pillar-index')).toHaveText(index);
      await expect(card.locator('.showcase3d__pillar-badge svg')).toBeVisible();
      await expect(card.getByRole('heading', { level: 3 })).toHaveText(title);
      await expect(card).not.toContainText('Capability');

      const summary = card.getByTestId('showcase-pillar-summary');
      const text = (await summary.innerText()).trim();
      expect(text.split(/\s+/).length, text).toBeLessThanOrEqual(14);
      expect(text.match(/[.!?]/g), text).toHaveLength(1);
      expect(text.endsWith('.')).toBe(true);
      expect(/^[\x20-\x7e]*$/.test(text)).toBe(true);
      await expect(summary).toHaveCSS('color', 'rgb(184, 184, 184)');
      const type = await summary.evaluate((el) => {
        const style = getComputedStyle(el);
        return { size: Number.parseFloat(style.fontSize), leading: Number.parseFloat(style.lineHeight) };
      });
      expect(type.leading).toBeGreaterThanOrEqual(type.size * 1.6);

      const pills = card.getByTestId('showcase-pillar-chip');
      await expect(pills).toHaveText(chips);
      const look = await pills.first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { radius: style.borderTopLeftRadius, width: style.borderTopWidth, shadow: style.boxShadow };
      });
      expect(look).toEqual({ radius: '999px', width: '1px', shadow: 'none' });
      await expect(card.locator('.showcase3d__pillar-spec')).toHaveCount(0);
    }
  });

  test('the launch key wears a soft champagne cap and a perimeter beam on a 6 s loop, with no blurred glow', async ({ page }) => {
    const errors = collectRuntimeErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const cta = page.getByTestId('launch-3d-studio-cta');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveCSS(
      'background-image',
      'linear-gradient(135deg, rgb(243, 227, 198) 0%, rgb(229, 199, 153) 55%, rgb(216, 178, 124) 100%)',
    );
    await expect(cta).toHaveCSS('color', 'rgb(20, 18, 16)');
    expect(await cta.evaluate(maxBlurPx)).toBe(0);
    // The lit top edge is an inset hairline, not a glow.
    expect(await cta.evaluate((el) => getComputedStyle(el).boxShadow)).toContain('inset');

    const beam = page.getByTestId('cta-border-beam');
    await expect(beam).toBeVisible();
    const [beamBox, ctaBox] = await Promise.all([beam.boundingBox(), cta.boundingBox()]);
    expect(Math.abs(beamBox.width - ctaBox.width)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(beamBox.height - ctaBox.height)).toBeLessThanOrEqual(2.5);
    const head = beam.locator('.launchpad__cta-beam-head');
    const motion = await head.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        duration: style.animationDuration,
        count: style.animationIterationCount,
        timing: style.animationTimingFunction,
        state: style.animationPlayState,
        perimeter: el.getTotalLength(),
      };
    });
    expect(motion).toMatchObject({ duration: '6s', count: 'infinite', timing: 'linear', state: 'running' });
    // The rect runs the whole key, not a 14 px icon box.
    expect(motion.perimeter).toBeGreaterThan(2 * (ctaBox.width + ctaBox.height) * 0.9);
    const offset = () => head.evaluate((el) => Number.parseFloat(getComputedStyle(el).strokeDashoffset));
    const first = await offset();
    await expect.poll(offset).not.toBe(first);
    for (const control of [beam, head]) expect(await control.evaluate(maxBlurPx)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('under reduced motion the beam holds still on the key', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const head = page.getByTestId('cta-border-beam').locator('.launchpad__cta-beam-head');
    await head.scrollIntoViewIfNeeded();
    await expect(head).toHaveCSS('animation-play-state', 'paused');
    const offset = () => head.evaluate((el) => getComputedStyle(el).strokeDashoffset);
    const still = await offset();
    await page.waitForTimeout(600);
    expect(await offset()).toBe(still);
  });
});
