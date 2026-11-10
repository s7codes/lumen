import { useSyncExternalStore } from 'react';
import { getMode, setMode, subscribeMode } from '../lib/display-mode.js';

export function useDisplayMode() {
  const mode = useSyncExternalStore(subscribeMode, getMode);
  return [mode, setMode];
}
