/** Anchors of the spied overview sections, in page order. */
export const SHOWCASE_3D_ID = 'spatial-studio-3d';
export const CORE_MODULES_ID = 'core-modules';
export const WORKSPACES_ID = 'workspaces';

/*
 * Primary navigation, in the order the overview scrolls: the underline steps
 * left to right as the reader moves down the page. `3D Room` opens the
 * showcase on the overview, whose launch key enters the planner; it reads as
 * current inside the planner (`activePath`) and warms the planner chunks on
 * intent (`prefetch`). `spy` names the overview section a route stands for
 * while the overview is scrolled through it.
 */
export const NAV_ROUTES = Object.freeze([
  { path: '/', index: '01', label: 'Overview', title: null },
  {
    path: `/#${SHOWCASE_3D_ID}`,
    hash: SHOWCASE_3D_ID,
    spy: SHOWCASE_3D_ID,
    index: '02',
    label: '3D Room',
    title: 'Room Planner',
    activePath: '/room-3d',
    prefetch: '/room-3d',
    testId: 'nav-3d-showcase',
  },
  { path: '/catalog', spy: CORE_MODULES_ID, index: '03', label: 'Catalog', title: 'Catalog' },
  { path: '/studio-2d', spy: WORKSPACES_ID, index: '04', label: 'Wall Studio', title: 'Wall Studio' },
]);
