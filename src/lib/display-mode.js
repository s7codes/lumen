import { isOneOf, safeStorage } from '../security/sanitize.js';

export const DISPLAY_MODES = ['architectural', 'technical'];
export const DEFAULT_MODE = 'architectural';

/** Everyday names for the two modes; the stored values stay architectural / technical. */
export const MODE_LABELS = Object.freeze({ architectural: 'Visual', technical: 'Specs' });

/*
 * Visual | Specs is a workstation preference. It lives under the same stored
 * key as before ('display-mode'), but only a planner applies it: a view opens
 * a mode scope while it is mounted (the 3D Room Planner), and outside every
 * scope the effective mode is always Visual, so the storefront renders as a
 * clean gallery whatever the preference says.
 */

const STORAGE_KEY = 'display-mode';
const listeners = new Set();
let preference = null;
let scopes = 0;

export function isDisplayMode(value) {
  return isOneOf(value, DISPLAY_MODES);
}

export function readStoredMode() {
  return safeStorage.read(STORAGE_KEY, { fallback: DEFAULT_MODE, validate: isDisplayMode });
}

export function applyMode(mode) {
  document.documentElement.dataset.mode = isDisplayMode(mode) ? mode : DEFAULT_MODE;
}

export function persistMode(mode) {
  if (isDisplayMode(mode)) safeStorage.write(STORAGE_KEY, mode);
}

/** The stored workstation preference, read once. */
export function getPreference() {
  if (preference === null) preference = readStoredMode();
  return preference;
}

/** True while a planner holds a mode scope open. */
export function isModeScoped() {
  return scopes > 0;
}

/** The mode in effect: the preference inside a planner, Visual everywhere else. */
export function getMode() {
  return scopes > 0 ? getPreference() : DEFAULT_MODE;
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** Sets and stores the preference; it shows at once only inside a planner. */
export function setMode(next) {
  if (!isDisplayMode(next) || next === getPreference()) return;
  preference = next;
  persistMode(next);
  applyMode(getMode());
  notify();
}

/**
 * Opens a mode scope (a planner mounting) and returns the function that
 * closes it. Scopes nest, so a remount under StrictMode never drops the mode.
 */
export function enterModeScope() {
  scopes += 1;
  applyMode(getMode());
  notify();
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    scopes = Math.max(0, scopes - 1);
    applyMode(getMode());
    notify();
  };
}

export function subscribeMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
