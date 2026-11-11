import { useSyncExternalStore } from 'react';
import { getCurrencyCode, setCurrencyCode, subscribeCurrency } from '../lib/currency-store.js';

export function useCurrency() {
  const code = useSyncExternalStore(subscribeCurrency, getCurrencyCode);
  return [code, setCurrencyCode];
}
