import { HERO_FRAME } from './hero-scenes.js';

/*
 * The figures of the 03 / 3D Spatial Studio X-ray: the photographed room as
 * the planner sees it, and the engines' results for it (the 24V run, the
 * Sabine octaves, the walkthrough's opening stance). Plain data, small enough
 * for the overview bundle: the stage's title block and caption read it at
 * once, while the drawing itself (src/lib/xray-blueprint.js, which
 * re-exports all of this) loads as its own chunk when the stage comes near.
 * tests/spatial-studio-editorial.spec.js recomputes every figure with
 * bus-topology.js, bag.js, room-physics.js and room-walkthrough.js.
 */

/** The hero still's frame: the blueprint is drawn in its pixels. */
export const XRAY_FRAME = HERO_FRAME;
export const XRAY_VIEWBOX = `0 0 ${HERO_FRAME.width} ${HERO_FRAME.height}`;

/** The rendered room (scripts/media/studio/src/scenes/hero.js), in cm. */
export const XRAY_ROOM = Object.freeze({ widthCm: 680, depthCm: 580, heightCm: 295 });

/**
 * The photographed set as a planner layout on the north wall (wall cm, y up
 * from the floor): the DALI-2 hub, the three monopoint heads of the track,
 * the pendant, the shelf and the column. The bus, acoustic and walkthrough
 * figures below are the engines' results for exactly this layout.
 */
export const XRAY_LAYOUT = Object.freeze({
  room: Object.freeze({ ...XRAY_ROOM, lighting: 'night', furniture: 'none' }),
  items: Object.freeze(
    [
      { uid: 'hub', productId: 'power-hub-dali', finish: 'obsidian', xCm: 480, yCm: 283 },
      { uid: 'spot-1', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 369, yCm: 283, led: true },
      { uid: 'spot-2', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 454, yCm: 283, led: true },
      { uid: 'spot-3', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 539, yCm: 283, led: true },
      { uid: 'pendant', productId: 'linear-pendant-150', finish: 'obsidian', xCm: 385, yCm: 122, led: true },
      { uid: 'shelf', productId: 'floating-shelf-110', finish: 'walnut', xCm: 548, yCm: 152, led: true },
      { uid: 'column', productId: 'corner-floor-column-140', finish: 'walnut', xCm: 660, yCm: 0, led: true },
    ].map((item) => Object.freeze(item)),
  ),
});

/**
 * The 24V SELV run as the planner wires it: a DALI-2 hub concealed under the
 * ceiling line feeding the three heads, the pendant, the shelf and the column
 * on one greedy Manhattan daisy chain (bus-topology.js computeBusTopology).
 * Wall cm, y up from the floor.
 */
export const XRAY_BUS = Object.freeze({
  hub: Object.freeze({ xCm: 480, yCm: 283, wCm: 60, hCm: 6 }),
  segments: Object.freeze(
    [
      [510, 286, 545, 286],
      [545, 286, 545, 295],
      [545, 295, 460, 295],
      [460, 295, 375, 295],
      [375, 295, 460, 295],
      [460, 295, 460, 134],
      [460, 134, 603, 134],
      [603, 134, 603, 152],
      [603, 152, 669, 152],
      [669, 152, 669, 0],
    ].map((s) => Object.freeze(s)),
  ),
  nodes: Object.freeze(
    [
      ['spot-3', 545, 295],
      ['spot-2', 460, 295],
      ['spot-1', 375, 295],
      ['pendant', 460, 134],
      ['shelf', 603, 152],
      ['column', 669, 0],
    ].map(([uid, xCm, yCm], i) => Object.freeze({ uid, xCm, yCm, label: `N${String(i + 1).padStart(2, '0')}` })),
  ),
  loadW: 89,
  driverW: 150,
  runM: 8.39,
  dropPct: 1.09,
  limitPct: 3,
});

/** Sabine reverberation of the bare room with its six lit parts (room-physics.js), seconds per octave. */
export const XRAY_ACOUSTICS = Object.freeze({
  octaves: Object.freeze([
    Object.freeze({ hz: 125, label: '125', rt60: 0.99 }),
    Object.freeze({ hz: 250, label: '250', rt60: 1.91 }),
    Object.freeze({ hz: 500, label: '500', rt60: 2.29 }),
    Object.freeze({ hz: 1000, label: '1K', rt60: 2.68 }),
    Object.freeze({ hz: 2000, label: '2K', rt60: 2.04 }),
    Object.freeze({ hz: 4000, label: '4K', rt60: 1.41 }),
  ]),
  rt60Sec: 2.29,
  sti: 0.46,
});

/**
 * The walkthrough's opening stance in this room (room-walkthrough.js
 * defaultStance): eye 165 cm, on the centre line, 452.4 cm out, facing the
 * north wall through the 78 deg lens. The sightline ticks mark its bearing
 * on the wall in 10 deg steps.
 */
export const XRAY_EYE = Object.freeze({ eyeCm: 165, xCm: 340, zCm: 452.4, fovDeg: 78, stepDeg: 10 });
