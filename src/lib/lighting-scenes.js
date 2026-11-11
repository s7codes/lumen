import { getProduct } from '../data/products.js';
import { isOneOf } from '../security/sanitize.js';
import { sanitizeDimPct, withDimPct } from './dimming.js';

/**
 * Architectural DALI-2 scenes. A scene sets every powered channel on, at an
 * arc level chosen by the part's role: task and direct light (shelves, bars,
 * pendants, spots, cubes) or accent and ambient light (frames, sconces,
 * columns, sideboards). Most scenes also set the wall surface mode, which in
 * the 3D room maps to the lighting rig. Passive parts are never touched.
 */

export const TASK_SHAPES = Object.freeze(['shelf', 'lightbar', 'pendant', 'spot', 'cube']);
export const ACCENT_SHAPES = Object.freeze(['frame', 'sconce', 'column', 'sideboard']);

export const LIGHTING_SCENES = Object.freeze([
  Object.freeze({ id: 'full', label: 'Full Output (100%)', short: 'Full', task: 100, accent: 100, surface: null }),
  Object.freeze({ id: 'morning', label: 'Morning Focus', short: 'Morning', task: 100, accent: 65, surface: 'daylight' }),
  Object.freeze({ id: 'evening', label: 'Evening Lounge', short: 'Evening', task: 45, accent: 85, surface: 'ambient' }),
  Object.freeze({ id: 'night', label: 'Night Gallery', short: 'Night', task: 20, accent: 40, surface: 'ambient' }),
]);

export const LIGHTING_SCENE_IDS = Object.freeze(LIGHTING_SCENES.map((scene) => scene.id));
const ROOM_LIGHTING = Object.freeze({ daylight: 'daylight', ambient: 'night' });

export function getLightingScene(id) {
  return isOneOf(id, LIGHTING_SCENE_IDS) ? LIGHTING_SCENES.find((scene) => scene.id === id) : null;
}

/** Arc level a scene assigns to a product, or null for passive parts. */
export function sceneLevel(scene, product) {
  if (!scene || !product || !(product.watts > 0)) return null;
  return ACCENT_SHAPES.includes(product.shape) ? scene.accent : scene.task;
}

/** Applies the scene's channel and level to every powered module. Same array when nothing changes. */
export function applySceneToItems(items, scene) {
  let changed = false;
  const next = items.map((item) => {
    const level = sceneLevel(scene, getProduct(item.productId));
    if (level === null || (item.led === true && sanitizeDimPct(item.dimPct) === level)) return item;
    changed = true;
    return withDimPct({ ...item, led: true }, level);
  });
  return changed ? next : items;
}

/** Wall Studio layout with the scene applied. Same layout object when nothing changes. */
export function applyLightingSceneToLayout(layout, sceneId) {
  const scene = getLightingScene(sceneId);
  if (!scene) return layout;
  const items = applySceneToItems(layout.items, scene);
  const surface = scene.surface ?? layout.wall.surface;
  if (items === layout.items && surface === layout.wall.surface) return layout;
  return { ...layout, wall: { ...layout.wall, surface }, items };
}

/** 3D room with the scene applied; the surface mode selects the lighting rig. */
export function applyLightingSceneToRoom(state, sceneId) {
  const scene = getLightingScene(sceneId);
  if (!scene) return state;
  const items = applySceneToItems(state.items, scene);
  const lighting = scene.surface ? ROOM_LIGHTING[scene.surface] : state.room.lighting;
  if (items === state.items && lighting === state.room.lighting) return state;
  return { ...state, room: { ...state.room, lighting }, items };
}

/**
 * The scene the modules and surface currently match, or null. A wall or room
 * without powered modules matches nothing, so no scene reads as active.
 */
export function matchLightingScene(items, surface) {
  const powered = items
    .map((item) => ({ item, product: getProduct(item.productId) }))
    .filter(({ product }) => product && product.watts > 0);
  if (powered.length === 0) return null;
  const scene = LIGHTING_SCENES.find(
    (entry) =>
      (entry.surface === null || entry.surface === surface) &&
      powered.every(({ item, product }) => item.led !== false && sanitizeDimPct(item.dimPct) === sceneLevel(entry, product)),
  );
  return scene?.id ?? null;
}

export function roomSurface(room) {
  return room.lighting === 'daylight' ? 'daylight' : 'ambient';
}
