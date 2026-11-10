import { lazy, Suspense } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { LayoutShell } from './components/LayoutShell.jsx';
import { RouteError, RouteFallback } from './components/RouteFallback.jsx';
import { RequireAuth } from './contexts/AuthContext.jsx';
import AccountPage from './pages/AccountPage.jsx';
import CatalogPage from './pages/CatalogPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import HomePage from './pages/HomePage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';

// The two planners are the heaviest views (the room planner also pulls the
// WebGL engine behind it), so each ships as its own chunk on first visit.
const RoomPlannerPage = lazy(() => import('./pages/RoomPlannerPage.jsx'));
const WallStudioPage = lazy(() => import('./pages/WallStudioPage.jsx'));

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
      { path: 'studio-2d', element: deferred(WallStudioPage, 'Loading wall studio'), errorElement: <RouteError /> },
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
