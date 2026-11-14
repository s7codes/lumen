import { useLayoutEffect, useSyncExternalStore } from 'react';
import { enterModeScope, getMode, isModeScoped, setMode, subscribeMode } from '../lib/display-mode.js';

/** The mode in effect (Visual outside a planner) and the preference setter. */
export function useDisplayMode() {
  const mode = useSyncExternalStore(subscribeMode, getMode);
  return [mode, setMode];
}

/** True while a planner is mounted and Visual | Specs applies. */
export function useModeScoped() {
  return useSyncExternalStore(subscribeMode, isModeScoped);
}

/**
 * Called by a planner: the stored Visual | Specs preference applies while it
 * is mounted, before its first paint, and the document returns to Visual
 * when it unmounts.
 */
export function usePlannerModeScope() {
  useLayoutEffect(() => enterModeScope(), []);
}
