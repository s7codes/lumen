/*
 * Lazy workspace chunks, keyed by path. The router renders them through
 * React.lazy; the navbar and the command palette warm them on intent
 * (pointer enter, focus, keyboard highlight) so the click lands on a cached
 * chunk. Nothing here runs on a cold load of the overview.
 */

const loadRoomCanvas = () => import('../components/room3d/RoomCanvas.jsx');

export const ROUTE_LOADERS = Object.freeze({
  '/room-3d': () => import('../pages/RoomPlannerPage.jsx'),
  '/studio-2d': () => import('../pages/WallStudioPage.jsx'),
});

// The room planner's WebGL engine is a second lazy chunk behind the page.
const FOLLOW_UPS = Object.freeze({ '/room-3d': loadRoomCanvas });

const warmed = new Set();

function constrainedNetwork() {
  const connection = typeof navigator === 'undefined' ? null : navigator.connection;
  return Boolean(connection?.saveData) || /(^|-)2g$/.test(connection?.effectiveType ?? '');
}

/** Starts downloading a workspace chunk once per session. Returns true when a fetch was started. */
export function prefetchRoute(path) {
  if (typeof path !== 'string' || !Object.hasOwn(ROUTE_LOADERS, path)) return false;
  if (warmed.has(path) || constrainedNetwork()) return false;
  warmed.add(path);
  ROUTE_LOADERS[path]()
    .then(() => FOLLOW_UPS[path]?.())
    .catch(() => warmed.delete(path));
  return true;
}
