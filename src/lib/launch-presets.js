/*
 * Quick-launch deep links into the 3D Spatial Studio: `?lens=` picks the
 * camera lens and `?scale=` a room scale preset. The planner reads them once
 * on arrival and drops them from the address bar, like `?scene=`.
 */

export const LAUNCH_PATH = '/room-3d';
export const LENS_PARAM = 'lens';
export const SCALE_PARAM = 'scale';

export function launchHref({ scale, lens } = {}) {
  const params = new URLSearchParams();
  if (scale) params.set(SCALE_PARAM, scale);
  if (lens) params.set(LENS_PARAM, lens);
  const query = params.toString();
  return query ? `${LAUNCH_PATH}?${query}` : LAUNCH_PATH;
}

/**
 * Reads the launch parameters against the ids the planner allows. A value
 * outside the allow-lists reads as absent; `present` still reports that a
 * parameter was there, so the address bar is cleaned either way.
 */
export function readLaunchPreset(search, { lenses, scales }) {
  const params = new URLSearchParams(search);
  const lens = params.get(LENS_PARAM);
  const scale = params.get(SCALE_PARAM);
  return {
    present: params.has(LENS_PARAM) || params.has(SCALE_PARAM),
    lens: lens !== null && lenses.includes(lens) ? lens : null,
    scale: scale !== null && scales.includes(scale) ? scale : null,
  };
}

export function stripLaunchParams(search) {
  const params = new URLSearchParams(search);
  params.delete(LENS_PARAM);
  params.delete(SCALE_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}
