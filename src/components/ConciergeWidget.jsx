import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { LumenMark } from './icons.jsx';
import '../styles/concierge.css';

// The panel, its engine and the catalog math behind it load on first intent,
// never with the entry bundle, so a cold load of / stays lean.
const loadPanel = () => import('./ConciergePanel.jsx');
const ConciergePanel = lazy(loadPanel);

const CONCIERGE_PANEL_ID = 'lumen-concierge-panel';

function PanelLoading() {
  return (
    <div className="concierge-panel concierge-panel--loading" role="status" data-testid="concierge-panel-loading">
      <span className="concierge-panel__mark" aria-hidden="true">
        <LumenMark size={16} />
      </span>
      <p className="concierge-panel__loading-copy">Loading Lumen AI</p>
    </div>
  );
}

/**
 * Bottom-right Studio AI dock, mounted once in the layout shell so the
 * conversation survives route changes. The panel mounts on first open and
 * then only hides, so closing never loses the session.
 */
export function ConciergeWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const triggerRef = useRef(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const toggle = () => {
    setLoaded(true);
    setOpen((value) => !value);
  };

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    close();
  };

  return (
    <div className="concierge-dock" data-testid="concierge-dock" data-open={open || undefined} onKeyDown={onKeyDown}>
      {loaded && (
        <Suspense fallback={open ? <PanelLoading /> : null}>
          <ConciergePanel open={open} onClose={close} panelId={CONCIERGE_PANEL_ID} />
        </Suspense>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="concierge-trigger"
        data-testid="concierge-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={loaded ? CONCIERGE_PANEL_ID : undefined}
        aria-label="Ask Studio AI"
        title="Ask Studio AI"
        onClick={toggle}
        onPointerEnter={loadPanel}
        onFocus={loadPanel}
      >
        <LumenMark size={16} className="concierge-trigger__mark" />
        <span className="concierge-trigger__label" aria-hidden="true">
          Ask Studio AI
        </span>
      </button>
    </div>
  );
}
