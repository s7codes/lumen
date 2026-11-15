/*
 * Meet our Icons: the overview's full-bleed cinema reel. Three 2.4:1 films
 * shot on the cinema stage (scripts/media/cinema), each held for 3.0 s and
 * crossfaded into the next, on a 9 s loop. This module is the clock and the
 * copy only: pure functions of time, testable in Node. The hook
 * (src/hooks/useIconsReel.js) plays the films against it.
 */

/** How long each icon holds the banner. */
export const REEL_SLOT_SECONDS = 3;

/** The crossfade into the next icon (CSS opacity transition, in ms). */
export const REEL_FADE_MS = 700;

/**
 * Length of every icon film. A film starts from its first frame when its icon
 * takes the banner and keeps playing through the fade out, so it must cover
 * the slot and the fade.
 */
export const ICON_FILM_SECONDS = 4;

export const ICON_REEL = Object.freeze([
  Object.freeze({
    id: 'monolith',
    index: '01',
    label: 'Monolith Dome',
    caption: 'A glossy obsidian dome on a travertine stem: its 2700K brass reflector dims up and sweeps its light across the stone.',
  }),
  Object.freeze({
    id: 'suspension',
    index: '02',
    label: 'Linear Pendant 150',
    caption: 'The Linear Pendant 150 hung from the Track Bus 200 spine lays a razor-sharp 2700K pool along a dark oak table.',
  }),
  Object.freeze({
    id: 'column',
    index: '03',
    label: 'Floor Column 140',
    caption: 'The Corner Floor Column 140 and recessed ceiling grazers paint overlapping 2700K scallops down dark Venetian plaster.',
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

/** The icon holding the banner at clock t. */
export function reelIndexAt(t) {
  return Math.min(ICON_REEL.length - 1, Math.floor(reelTime(t) / REEL_SLOT_SECONDS));
}

/** How far through its 3 s slot the current icon is, 0 to 1. */
export function reelProgress(t) {
  const local = reelTime(t) - reelIndexAt(t) * REEL_SLOT_SECONDS;
  return Math.max(0, Math.min(1, local / REEL_SLOT_SECONDS));
}

export function isReelIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < ICON_REEL.length;
}

/** The icon after `index`, wrapping to the first. */
export function nextReelIndex(index) {
  return isReelIndex(index) ? (index + 1) % ICON_REEL.length : 0;
}
