/*
 * The X-ray divider of 03 / 3D Spatial Studio: where the warm photograph
 * hands over to the 1:20 blueprint, as a share of the stage width from the
 * left (0 = all blueprint, 100 = all photograph). Pure and framework-free:
 * the stage drives the DOM with it and the tests read the same numbers.
 */

export const XRAY_SPLIT = Object.freeze({ min: 0, max: 100, initial: 52, step: 1, page: 10 });

/** The three quick views on the stage bar, each a divider position. */
export const XRAY_VIEWS = Object.freeze([
  Object.freeze({ id: 'xray', label: '50/50 X-Ray Split', short: 'X-Ray', split: 52 }),
  Object.freeze({ id: 'photo', label: '2K Optical Photo', short: 'Photo', split: 92 }),
  Object.freeze({ id: 'cad', label: '1:20 CAD Blueprint', short: 'CAD', split: 8 }),
]);

/**
 * Where each capability's callouts begin in the 2560 px frame: choosing a
 * capability opens the blueprint to that point when less of it is showing,
 * never wider than the CAD view and never narrower than the default split.
 */
export const XRAY_FOCUS_FRAME_X = Object.freeze({ envelope: 230, 'eye-level': 640, bus: 1130, exports: 1331 });

/** Critically damped glide for the quick views: about 0.7 s across the stage at any refresh rate. */
export const XRAY_SPRING = Object.freeze({ stiffness: 144, damping: 24 });
export const XRAY_SETTLE = Object.freeze({ distance: 0.05, speed: 0.5 });

const round1 = (value) => Math.round(value * 10) / 10;

export function clampSplit(value) {
  const n = Number.isFinite(value) ? value : XRAY_SPLIT.initial;
  return round1(Math.min(XRAY_SPLIT.max, Math.max(XRAY_SPLIT.min, n)));
}

/** The divider under a pointer at clientX over a stage box starting at `left`, `width` wide. */
export function splitFromPointer(clientX, left, width) {
  if (!(width > 0)) return XRAY_SPLIT.initial;
  return clampSplit(((clientX - left) / width) * 100);
}

/** What the stage mostly shows: the blueprint, the photograph or both. */
export function splitMode(split) {
  if (split <= 20) return 'cad';
  if (split >= 80) return 'photo';
  return 'xray';
}

export const XRAY_MODE_LABELS = Object.freeze({ cad: 'CAD', xray: 'X-RAY', photo: 'PHOTO' });

/** The handle's readout, e.g. "52%". */
export function splitReadout(split) {
  return `${Math.round(clampSplit(split))}%`;
}

/** The slider's spoken value, e.g. "52 percent photograph, 48 percent blueprint". */
export function splitValueText(split) {
  const photo = Math.round(clampSplit(split));
  return `${photo} percent photograph, ${100 - photo} percent blueprint`;
}

/**
 * The divider after a key on the handle, or null for a key the slider does
 * not take: arrows step 1 (10 with Shift), Page Up and Page Down 10, Home
 * and End run to either edge.
 */
export function splitForKey(key, split, shiftKey = false) {
  const step = shiftKey ? XRAY_SPLIT.page : XRAY_SPLIT.step;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampSplit(split - step);
    case 'ArrowRight':
    case 'ArrowUp':
      return clampSplit(split + step);
    case 'PageDown':
      return clampSplit(split - XRAY_SPLIT.page);
    case 'PageUp':
      return clampSplit(split + XRAY_SPLIT.page);
    case 'Home':
      return XRAY_SPLIT.min;
    case 'End':
      return XRAY_SPLIT.max;
    default:
      return null;
  }
}

/** The quick view a divider position sits on, if any. */
export function viewAt(split) {
  return XRAY_VIEWS.find((view) => Math.abs(view.split - split) < 0.5) ?? null;
}

/**
 * The divider that opens the blueprint to a capability's callouts, given
 * where frame x falls on the stage (as a stage percentage), or null when
 * enough of the blueprint already shows.
 */
export function focusSplit(current, framePercent) {
  const cad = XRAY_VIEWS.find((view) => view.id === 'cad').split;
  const target = clampSplit(Math.min(XRAY_SPLIT.initial, Math.max(cad, framePercent)));
  return current > target + 0.5 ? target : null;
}
