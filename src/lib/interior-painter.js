/*
 * Explore the Lumen home: three portrait (4:5) rooms. Each is a 1600 x 2000
 * path-traced photograph of a room furnished with the planner's own parts
 * and furniture, with a hover film of its light (media in
 * src/lib/media-manifest.js). What remains here is the rooms' identity: the
 * id, the caption and where the room's luminaire sits in the frame, which
 * places the hover glow (--glow-x / --glow-y) over the real fixture.
 *
 * The vector painter that drew these rooms before v9 is retired; the module
 * keeps its name and exports so older imports still resolve.
 */

export const INTERIOR_VIEW = Object.freeze({ width: 1600, height: 2000 });

export const INTERIOR_SCENES = Object.freeze({
  dining: Object.freeze({ id: 'dining', label: 'Dining & Living', glow: Object.freeze({ x: 0.43, y: 0.31 }) }),
  bedroom: Object.freeze({ id: 'bedroom', label: 'Bedroom Sanctuary', glow: Object.freeze({ x: 0.26, y: 0.37 }) }),
  studio: Object.freeze({ id: 'studio', label: 'Studio Wall', glow: Object.freeze({ x: 0.33, y: 0.4 }) }),
});

export const INTERIOR_SCENE_IDS = Object.freeze(Object.keys(INTERIOR_SCENES));

/** A room by id; an unknown id reads as the dining room. */
export function interiorScene(scene) {
  return INTERIOR_SCENES[scene] ?? INTERIOR_SCENES.dining;
}
