import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readLaunchPreset, stripLaunchParams } from '../lib/launch-presets.js';
import { stripSceneParam } from '../lib/scene-codec.js';

/**
 * Consumes `?lens=` and `?scale=` once on arrival. Allowed values reach
 * `apply`; anything else is ignored. Either way the parameters leave the
 * address bar, so a reload opens the studio as the user left it.
 *
 * Call it after useSharedSceneLoader: that effect runs first in the same
 * commit and has already consumed `?scene=`, so this one replace clears all
 * three and cannot race the loader's own replace.
 */
export function useLaunchPreset({ lenses, scales }, apply) {
  const location = useLocation();
  const navigate = useNavigate();
  const handled = useRef(null);

  useEffect(() => {
    const preset = readLaunchPreset(location.search, { lenses, scales });
    if (!preset.present) {
      handled.current = null;
      return;
    }
    // StrictMode re-runs the effect before the replace lands.
    if (handled.current === location.search) return;
    handled.current = location.search;

    navigate(
      { pathname: location.pathname, search: stripSceneParam(stripLaunchParams(location.search)), hash: location.hash },
      { replace: true, state: location.state, preventScrollReset: true },
    );
    if (preset.lens || preset.scale) apply(preset);
  }, [location.search]);
}
