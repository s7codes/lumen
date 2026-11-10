import { useCallback, useState } from 'react';
import { applyMode, isDisplayMode, persistMode, readStoredMode } from '../lib/display-mode.js';

export function useDisplayMode() {
  const [mode, setModeState] = useState(readStoredMode);

  const setMode = useCallback((next) => {
    if (!isDisplayMode(next)) return;
    applyMode(next);
    persistMode(next);
    setModeState(next);
  }, []);

  return [mode, setMode];
}
