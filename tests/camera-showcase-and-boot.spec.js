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
import { NAV_ROUTES, SHOWCASE_3D_ID } from '../src/lib/routes.js';
import { collectRuntimeErrors, horizontalOverflow, installCspRecorder, readCspViolations } from './support/runtime-guards.js';

const ROOM_KEY = `lumen:${ROOM_STORAGE_KEY}`;
const PLANNER_CHUNK = /\/assets\/(RoomPlannerPage|WallStudioPage|RoomCanvas)-[\w-]+\.js$/;

function viewport(page) {
  return page.getByTestId('room-viewport');
}

function walkState(page) {
  return page.getByTestId('room-walkthrough-state');
}

function bootOverlay(page) {
  return page.getByTestId('studio-boot-overlay');
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
  test('Wall Studio precedes 3D Room; 3D Room glides to the showcase from any page and the launch key boots the studio full screen', async ({
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

    expect(NAV_ROUTES.map((route) => route.label)).toEqual(['Overview', 'Catalog', 'Wall Studio', '3D Room']);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveText(['Overview', 'Catalog', 'Wall Studio', '3D Room']);
    const navLink = page.getByTestId('nav-3d-showcase');
    await expect(navLink).toHaveText('3D Room');
    await expect(navLink).toHaveAttribute('href', `/#${SHOWCASE_3D_ID}`);
    await expect(nav.getByRole('link', { name: 'Wall Studio' })).toHaveAttribute('href', '/studio-2d');

    // The showcase is SVG and CSS: the overview still loads no planner or WebGL chunk.
    const showcase = page.getByTestId('home-3d-showcase');
    await expect(showcase).toHaveAttribute('id', SHOWCASE_3D_ID);
    await showcase.evaluate((el) => el.scrollIntoView());
    await expect(showcase.getByRole('heading', { level: 2 })).toHaveText(
      'Step inside a four-walled room before a single hole is drilled.',
    );
    await expect(showcase).toContainText('3D Spatial Studio');
    await expect(showcase.locator('svg.showcase3d__svg')).toBeVisible();
    for (const title of ['360-Degree Four-Wall Envelope', '165 cm Eye-Level Walkthrough', 'Direct 3D Raycast & Gizmo']) {
      await expect(showcase.getByRole('heading', { level: 3, name: title })).toBeVisible();
    }
    const cta = page.getByTestId('launch-3d-studio-cta');
    await expect(cta).toHaveText('Launch 3D Spatial Studio');
    await expect(cta).toHaveAttribute('href', '/room-3d');
    await page.waitForLoadState('networkidle');
    expect(scripts.filter((path) => PLANNER_CHUNK.test(path))).toEqual([]);
    expect(await showcase.evaluate((el) => el.querySelectorAll('canvas').length)).toBe(0);

    // On the overview, 3D Room glides in place and lands on the section.
    await page.evaluate(() => window.scrollTo(0, 0));
    await navLink.click();
    await expect(page).toHaveURL(new RegExp(`/#${SHOWCASE_3D_ID}$`));
    await expect(showcase.getByRole('heading', { level: 2 })).toBeInViewport();
    await expect(showcase).toBeFocused();
    await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

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
    await expect(boot).toContainText('LUMEN SPATIAL ENGINE v5.1');
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

  test('the full-screen boot never takes the pointer, skips on Enter Studio Now and keeps the page free of overflow', async ({
    page,
  }) => {
    const errors = collectRuntimeErrors(page);
    for (const width of [360, 1024]) {
      await page.setViewportSize({ width, height: 800 });
      await openRoom(page);
      const boot = bootOverlay(page);
      await expect(boot).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
      await page.getByTestId('replay-studio-boot').click();
      await expect(boot).toHaveAttribute('data-state', 'booting');
      // A replay pulls focus back in from the lifted 1.025 scale, then holds the full window.
      await expect.poll(async () => (await boot.boundingBox()).x).toBe(0);
      const box = await boot.boundingBox();
      expect(box).toMatchObject({ x: 0, y: 0, height: 800 });
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      // The pointer passes straight through to the navbar underneath.
      expect(await page.evaluate(() => Boolean(document.elementFromPoint(24, 24)?.closest('header.navbar')))).toBe(true);
      await page.getByTestId('skip-studio-boot').click();
      await expect(boot).toHaveAttribute('data-state', 'done');
      await expect(boot).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
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
