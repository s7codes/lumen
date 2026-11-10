import { useRouteError } from 'react-router-dom';
import { LumenMark } from './icons.jsx';

/** Shown while a workspace chunk downloads. Centered in the main frame. */
export function RouteFallback({ label = 'Loading workspace' }) {
  return (
    <div className="route-fallback" data-testid="route-fallback" role="status" aria-live="polite">
      <div className="route-fallback__center">
        <span className="route-fallback__mark">
          <LumenMark size={40} />
        </span>
        <span className="route-fallback__track" aria-hidden="true">
          <span className="route-fallback__bar" />
        </span>
        <p className="route-fallback__label mono">{label}</p>
      </div>
    </div>
  );
}

/**
 * A lazy chunk fails when the network drops or a new release replaced the
 * hashed files under an open tab. A reload fetches the current manifest.
 */
export function RouteError() {
  const error = useRouteError();
  const chunk = /dynamically imported module|Importing a module script|error loading dynamically/i.test(String(error?.message ?? ''));
  return (
    <div className="route-fallback" data-testid="route-error" role="alert">
      <div className="route-fallback__center">
        <span className="route-fallback__mark route-fallback__mark--still">
          <LumenMark size={40} />
        </span>
        <p className="route-fallback__title">{chunk ? 'Workspace did not load.' : 'Workspace stopped.'}</p>
        <p className="route-fallback__label mono">
          {chunk ? 'The connection dropped or a new release is live.' : 'An unexpected error interrupted this view.'}
        </p>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}
