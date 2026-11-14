/** Anchors of the spied overview sections, in page order. */
export const SHOWCASE_3D_ID = 'spatial-studio-3d';
export const CORE_MODULES_ID = 'core-modules';
export const WORKSPACES_ID = 'workspaces';

/*
 * Primary navigation, in the order the overview scrolls: the underline steps
 * left to right as the reader moves down the page. Three pages: the overview,
 * the 3D Room Planner (every room and every wall is planned there) and the
 * catalog. Workspace links warm their chunks on intent. `spy` names the
 * overview section a route stands for while the overview is scrolled through it.
 */
export const NAV_ROUTES = Object.freeze([
  { path: '/', index: '01', label: 'Overview', title: null },
  { path: '/room-3d', spy: SHOWCASE_3D_ID, index: '02', label: '3D Room', title: 'Room Planner', testId: 'nav-room-3d' },
  { path: '/catalog', spy: CORE_MODULES_ID, index: '03', label: 'Catalog', title: 'Catalog', testId: 'nav-catalog' },
]);
