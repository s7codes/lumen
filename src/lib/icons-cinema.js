import { clamp01, easeInOutSine, lerp, smoothstep } from './paint-kit.js';

/*
 * Meet our Icons: the overview's full-bleed motion loop. Three macro acts of
 * 4.5 s each cross-dissolve into one another on a 13.5 s loop. This module is
 * the clock and the cameras only: pure functions of time, testable in Node.
 * The painter (icons-cinema-painter.js) draws whatever these return.
 */

export const CINEMA_ACTS = Object.freeze([
  Object.freeze({ id: 'obsidian', numeral: 'I', label: 'Obsidian Dome & Travertine Column' }),
  Object.freeze({ id: 'aperture', numeral: 'II', label: 'Triple-Aperture Optical Diffuser' }),
  Object.freeze({ id: 'track', numeral: 'III', label: 'Linear Anodized Track & Prismatic Brass Louver Glide' }),
]);

export const CINEMA_ACT_IDS = Object.freeze(CINEMA_ACTS.map((act) => act.id));
export const CINEMA_ACT_SECONDS = 4.5;
export const CINEMA_DISSOLVE_SECONDS = 1.2;
export const CINEMA_LOOP_SECONDS = CINEMA_ACT_SECONDS * CINEMA_ACTS.length;
// Reduced motion holds one composed still: Act I, its camera mid-glide.
export const CINEMA_STILL_SECONDS = 2.2;

/** Seconds into the loop for any clock value, negative ones included. */
export function loopTime(t) {
  const span = CINEMA_LOOP_SECONDS;
  const value = Number.isFinite(t) ? t : 0;
  return ((value % span) + span) % span;
}

// Camera progress runs from the moment an act starts dissolving in to the end
// of its own span, so a camera never jumps when its act takes the frame.
function actProgress(secondsIntoAct) {
  return clamp01((secondsIntoAct + CINEMA_DISSOLVE_SECONDS) / (CINEMA_ACT_SECONDS + CINEMA_DISSOLVE_SECONDS));
}

/**
 * The acts on screen at clock t, painted in order. The first layer is the act
 * whose span holds t and is always drawn at full strength; through the last
 * CINEMA_DISSOLVE_SECONDS of its span the next act is composited over it with
 * `weight` rising 0 to 1 on a smoothstep. Drawing an opaque frame at alpha w
 * over another is exactly the dissolve A (1 - w) + B w.
 */
export function cinemaLayers(t) {
  const count = CINEMA_ACTS.length;
  const lt = loopTime(t);
  const index = Math.min(count - 1, Math.floor(lt / CINEMA_ACT_SECONDS));
  const local = lt - index * CINEMA_ACT_SECONDS;
  const base = { index, id: CINEMA_ACT_IDS[index], weight: 1, progress: actProgress(local) };
  const fadeStart = CINEMA_ACT_SECONDS - CINEMA_DISSOLVE_SECONDS;
  if (local < fadeStart) return [base];
  const next = (index + 1) % count;
  return [
    base,
    {
      index: next,
      id: CINEMA_ACT_IDS[next],
      weight: smoothstep(fadeStart, CINEMA_ACT_SECONDS, local),
      progress: actProgress(local - CINEMA_ACT_SECONDS),
    },
  ];
}

/** The act that owns the frame: the incoming one once it passes half strength. */
export function dominantAct(t) {
  const layers = cinemaLayers(t);
  return layers.length > 1 && layers[1].weight >= 0.5 ? layers[1].index : layers[0].index;
}

/**
 * Camera for an act at progress p (0-1). x and y are offsets of the set in
 * scene units (1 unit = 1/100 of the frame's short side), scale is the macro
 * zoom and rot the orbital roll in radians. Each move is one eased glide.
 */
export function cinemaCamera(id, p) {
  const e = easeInOutSine(p);
  if (id === 'obsidian') {
    // Macro pan across the glossy dome, drifting in.
    return { x: lerp(20, -20, e), y: lerp(4, -2, e), scale: lerp(1.22, 1.4, e), rot: 0, sweep: e };
  }
  if (id === 'aperture') {
    // Orbital glide round the ring housing, pressing closer.
    return { x: lerp(-14, 10, e), y: lerp(6, -4, e), scale: lerp(1.32, 1.58, e), rot: lerp(-0.2, 0.32, e), sweep: e };
  }
  // Orbital glide along the 24V track: from the brass louver run (set x -132
  // to -24) onto the glass cylinder spot (set x 0) as its beam sweeps the
  // marble, rolling a few degrees and pressing in. The frame centre sits at -x.
  return { x: lerp(46, -16, e), y: lerp(4, -2, e), scale: lerp(1.2, 1.42, e), rot: lerp(-0.07, 0.05, e), sweep: e };
}

/** Slow living modulation of a light source: a gentle swell, never a flicker. */
export function breathe(time, period, depth) {
  return 1 - depth + depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * time) / period));
}
