import { isOneOf, safeStorage } from '../security/sanitize.js';

export const DISPLAY_MODES = ['architectural', 'technical'];
export const DEFAULT_MODE = 'architectural';

const STORAGE_KEY = 'display-mode';
const listeners = new Set();
let currentMode = null;

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

export function getMode() {
  if (currentMode === null) currentMode = readStoredMode();
  return currentMode;
}

export function setMode(next) {
  if (!isDisplayMode(next) || next === getMode()) return;
  currentMode = next;
  applyMode(next);
  persistMode(next);
  listeners.forEach((listener) => listener());
}

export function subscribeMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
