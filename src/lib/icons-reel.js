/*
 * Meet our Icons: the overview's full-bleed cinema reel. Three camera films
 * of light in architecture (a timber wave pendant, low sun across sculpted
 * plaster, a step light on an oiled timber stair), each held for 3.0 s and
 * crossfaded into the next, on a 9 s loop. This module is the clock and the
 * copy only: pure functions of time, testable in Node. The hook
 * (src/hooks/useIconsReel.js) plays the films against it.
 */

/** How long each film holds the banner. */
export const REEL_SLOT_SECONDS = 3;

/** The crossfade into the next film (CSS opacity transition, in ms). */
export const REEL_FADE_MS = 700;

/**
 * Length of every reel film. A film starts from its first frame when it
 * takes the banner and keeps playing through its fade out, so it must cover
 * the slot and the fade, with room for a late frame.
 */
export const ICON_FILM_SECONDS = 4.5;

export const ICON_REEL = Object.freeze([
  Object.freeze({
    id: 'pendant',
    index: '01',
    caption: 'A wave-shaped timber pendant draws a warm line of light under a plaster ceiling.',
  }),
  Object.freeze({
    id: 'plaster',
    index: '02',
    caption: 'Low sun rakes across sculpted plaster niches and their stoneware vases.',
  }),
  Object.freeze({
    id: 'stair',
    index: '03',
    caption: 'A recessed step light grazes the treads of an oiled timber stair.',
  }),
]);

export const REEL_IDS = Object.freeze(ICON_REEL.map((icon) => icon.id));
export const REEL_LOOP_SECONDS = REEL_SLOT_SECONDS * ICON_REEL.length;

/** Seconds into the loop for any clock value, negative ones included. */
export function reelTime(t) {
  const span = REEL_LOOP_SECONDS;
  const value = Number.isFinite(t) ? t : 0;
  return ((value % span) + span) % span;
}

/** The film holding the banner at clock t. */
export function reelIndexAt(t) {
  return Math.min(ICON_REEL.length - 1, Math.floor(reelTime(t) / REEL_SLOT_SECONDS));
}

export function isReelIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < ICON_REEL.length;
}

/** The film after `index`, wrapping to the first. */
export function nextReelIndex(index) {
  return isReelIndex(index) ? (index + 1) % ICON_REEL.length : 0;
}
