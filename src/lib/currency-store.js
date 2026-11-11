import { CURRENCY_CODES, loadCurrency, persistCurrency } from './quote.js';
import { isOneOf } from '../security/sanitize.js';

const listeners = new Set();
let current = null;

export function getCurrencyCode() {
  if (current === null) current = loadCurrency();
  return current;
}

/** Validated, persisted, and broadcast to every subscribed view (checkout, command palette). */
export function setCurrencyCode(code) {
  if (!isOneOf(code, CURRENCY_CODES)) return false;
  persistCurrency(code);
  if (code !== getCurrencyCode()) {
    current = code;
    listeners.forEach((listener) => listener());
  }
  return true;
}

export function subscribeCurrency(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
