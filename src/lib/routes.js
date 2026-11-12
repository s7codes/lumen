/** Anchor of the 3D Spatial Studio showcase on the overview. */
export const SHOWCASE_3D_ID = 'spatial-studio-3d';

/*
 * Primary navigation. `3D Room` opens the showcase on the overview, whose
 * launch key enters the planner; it reads as current inside the planner
 * (`activePath`) and warms the planner chunks on intent (`prefetch`).
 */
export const NAV_ROUTES = Object.freeze([
  { path: '/', index: '01', label: 'Overview', title: null },
  { path: '/catalog', index: '02', label: 'Catalog', title: 'Catalog' },
  { path: '/studio-2d', index: '03', label: 'Wall Studio', title: 'Wall Studio' },
  {
    path: `/#${SHOWCASE_3D_ID}`,
    hash: SHOWCASE_3D_ID,
    index: '04',
    label: '3D Room',
    title: 'Room Planner',
    activePath: '/room-3d',
    prefetch: '/room-3d',
    testId: 'nav-3d-showcase',
  },
]);
