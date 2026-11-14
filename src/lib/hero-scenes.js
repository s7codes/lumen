/*
 * The overview hero: one limestone gallery room, photographed twice from
 * the same stand. Scene I is architectural daylight raking in from a window
 * to the left; Scene II is the same room after dusk under its 2700K Lumen
 * channels. Both are 2560 x 1440 path-traced stills of the planner's parts
 * with a looping film of the room's own light; the media live in
 * src/lib/media-manifest.js. Pure: the clock, the scene ids and the fixture
 * hotspots are data, so they are tested in Node.
 */

export const HERO_FRAME = Object.freeze({ width: 2560, height: 1440 });

export const HERO_SCENES = Object.freeze([
  Object.freeze({ id: 'daylight', label: 'Daylight', caption: 'Architectural daylight through a north window' }),
  Object.freeze({ id: 'warm', label: 'Warm 2700K', caption: 'The same room after dusk on its 2700K channels' }),
]);

export const HERO_SCENE_IDS = Object.freeze(HERO_SCENES.map((scene) => scene.id));

export function isHeroSceneId(value) {
  return typeof value === 'string' && HERO_SCENE_IDS.includes(value);
}

// Each scene holds the frame for 5 s, then a 1.1 s crossfade hands it over.
// The CSS keyframes in home.css (hero-scene-cycle) mirror these numbers. A
// scene picked on the switcher holds until the visitor picks the other.
export const HERO_HOLD_SECONDS = 5;
export const HERO_CROSSFADE_SECONDS = 1.1;
export const HERO_CYCLE_SECONDS = 2 * (HERO_HOLD_SECONDS + HERO_CROSSFADE_SECONDS);

function smooth(t) {
  const v = t < 0 ? 0 : t > 1 ? 1 : t;
  return v * v * (3 - 2 * v);
}

/**
 * Opacity of the warm scene laid over the daylight scene at clock t
 * (seconds): 0 through the first hold, an eased rise through the first
 * crossfade, 1 through the second hold, an eased fall through the second.
 */
export function warmWeight(t) {
  const span = HERO_CYCLE_SECONDS;
  const value = Number.isFinite(t) ? ((t % span) + span) % span : 0;
  const rise = HERO_HOLD_SECONDS;
  const top = rise + HERO_CROSSFADE_SECONDS;
  const fall = top + HERO_HOLD_SECONDS;
  if (value < rise) return 0;
  if (value < top) return smooth((value - rise) / HERO_CROSSFADE_SECONDS);
  if (value < fall) return 1;
  return 1 - smooth((value - fall) / HERO_CROSSFADE_SECONDS);
}

/** The scene that owns the frame at clock t: the incoming one once it passes half strength. */
export function heroSceneAt(t) {
  return warmWeight(t) >= 0.5 ? HERO_SCENE_IDS[1] : HERO_SCENE_IDS[0];
}

/*
 * Fixture hotspots, as fractions of the 2560 x 1440 frame (origin top
 * left). Each point is a fixture's 3D anchor projected through the camera
 * the stills were rendered with, so it lands on the fixture at any crop.
 */
export const HERO_HOTSPOTS = Object.freeze([
  Object.freeze({ id: 'track', productId: 'directional-spot-monopoint', x: 0.6184, y: 0.0546, detail: '24V monopoint / 520 lm / 24 deg beam' }),
  Object.freeze({ id: 'pendant', productId: 'linear-pendant-150', x: 0.6091, y: 0.5666, detail: '150 cm / 2,450 lm / 2700K' }),
  Object.freeze({ id: 'shelf', productId: 'floating-shelf-110', x: 0.872, y: 0.4838, detail: 'FSC walnut / 1,150 lm under-lip wash' }),
  Object.freeze({ id: 'column', productId: 'corner-floor-column-140', x: 0.9481, y: 0.5861, detail: '140 cm / 1,800 lm opal slot' }),
]);
