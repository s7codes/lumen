import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router-dom';
import { LayoutShell } from './components/LayoutShell.jsx';
import { RouteError, RouteFallback } from './components/RouteFallback.jsx';
import { RequireAuth } from './contexts/AuthContext.jsx';
import { ROUTE_LOADERS } from './lib/route-manifest.js';
import AccountPage from './pages/AccountPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';

export { prefetchRoute } from './lib/route-manifest.js';

// The room planner is the heaviest view (it also pulls the WebGL engine
// behind it), so it ships as its own chunk on first visit.
const RoomPlannerPage = lazy(ROUTE_LOADERS['/room-3d']);

/**
 * The 2D Wall Studio is retired: every wall is planned in the 3D Room Planner.
 * Old addresses land there, keeping the query and hash, so a legacy ?scene=
 * share link still opens (on the north wall).
 */
function LegacyStudioRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: '/room-3d', search, hash }} replace />;
}

function deferred(Page, label) {
  return (
    <Suspense fallback={<RouteFallback label={label} />}>
      <Page />
    </Suspense>
  );
}

// A fresh document load has no history.state, so React Router keys it "default".
// Every typed URL in the tab would then share one saved scroll offset. Seeding a
// per-entry key (as React Router's framework mode does) restores only on reload
// or back/forward of that same entry.
if (!window.history.state?.key) {
  const key = Math.random().toString(36).slice(2, 10);
  window.history.replaceState({ ...window.history.state, key }, '');
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LayoutShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'catalog', element: <CatalogPage /> },
      { path: 'catalog/:id', element: <ProductDetailPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'room-3d', element: deferred(RoomPlannerPage, 'Loading spatial engine'), errorElement: <RouteError /> },
      { path: 'studio-2d', element: <LegacyStudioRedirect /> },
      { path: 'studio', element: <LegacyStudioRedirect /> },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
