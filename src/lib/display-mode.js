import { isOneOf, safeStorage } from '../security/sanitize.js';

export const DISPLAY_MODES = ['architectural', 'technical'];
export const DEFAULT_MODE = 'architectural';

const STORAGE_KEY = 'display-mode';

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
