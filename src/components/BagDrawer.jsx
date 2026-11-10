import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BagDrawer({ open, onClose, returnFocusRef }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const trigger = returnFocusRef?.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const nodes = panelRef.current.querySelectorAll(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  if (!open) return null;

  return (
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        id="bag-drawer"
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-drawer-title"
      >
        <header className="drawer__header">
          <div>
            <p className="index-label">
              <span className="index-label__num">00</span> / Items
            </p>
            <h2 id="bag-drawer-title" className="drawer__title">
              Bag
            </h2>
          </div>
          <button ref={closeRef} type="button" className="drawer__close" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="drawer__body">
          <p className="drawer__empty">Your bag is empty.</p>
          <p className="drawer__hint">
            Systems configured in the planners are added here as a complete parts list: fixtures,
            rail lengths, drivers and mounting hardware.
          </p>
          <Link to="/catalog" className="button" onClick={onClose}>
            Browse catalog
          </Link>
        </div>

        <footer className="drawer__footer mono">
          <span>Subtotal</span>
          <span>--</span>
        </footer>
      </aside>
    </div>
  );
}
