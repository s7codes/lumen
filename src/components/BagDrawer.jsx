import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBag } from '../hooks/useBag.js';
import { MAX_LINE_QTY } from '../lib/bag.js';
import { formatUsd, padIndex } from '../lib/format.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const METER_SEGMENTS = 20;

function Stepper({ label, qty, onStep }) {
  const atMin = qty <= 1;
  const atMax = qty >= MAX_LINE_QTY;
  return (
    <div className="stepper" role="group" aria-label={`Quantity, ${label}`}>
      <button
        type="button"
        className="stepper__button"
        aria-label={`Decrease ${label}`}
        aria-disabled={atMin}
        onClick={() => !atMin && onStep(-1)}
      >
        -
      </button>
      <span className="stepper__value mono" data-testid="bag-line-qty">
        {qty}
      </span>
      <button
        type="button"
        className="stepper__button"
        aria-label={`Increase ${label}`}
        aria-disabled={atMax}
        onClick={() => !atMax && onStep(1)}
      >
        +
      </button>
    </div>
  );
}

function BagLine({ line, onStep, onRemove }) {
  const { product, finish } = line;
  const label = `${product.name}, ${finish.label}`;
  return (
    <li className="bag-line" data-testid="bag-line" data-line={line.key}>
      <span
        className="bag-line__swatch"
        style={{ '--swatch': finish.hex, '--swatch-hi': finish.highlight, '--swatch-lo': finish.shade }}
        aria-hidden="true"
      />
      <div className="bag-line__info">
        <p className="bag-line__name">{product.name}</p>
        <p className="bag-line__meta mono">
          {product.sku} / {finish.label} / {product.watts} W
        </p>
      </div>
      <p className="bag-line__total mono">{formatUsd(line.lineUsd)}</p>
      <Stepper label={label} qty={line.qty} onStep={onStep} />
      <button type="button" className="bag-line__remove" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

function LoadMeter({ psu }) {
  const lit = Math.min(METER_SEGMENTS, Math.ceil(psu.utilisation * METER_SEGMENTS));
  return (
    <div className="load-meter" aria-hidden="true">
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span key={i} className="load-meter__segment" data-on={i < lit || undefined} />
      ))}
    </div>
  );
}

function BagSummary({ count, subtotalUsd, loadW, psu, onClear }) {
  const [armed, setArmed] = useState(false);
  const percent = Math.round(psu.utilisation * 100);
  let note = 'Passive parts only, no driver load';
  if (psu.drivers === 1) note = `Driver utilisation ${percent}% of ${psu.capacityW} W`;
  if (psu.drivers > 1) {
    note = `${psu.drivers}x ${psu.capacityW / psu.drivers}W drivers / ${percent}% of ${psu.capacityW} W`;
  }

  return (
    <footer className="drawer__footer bag-summary">
      <dl className="bag-summary__rows">
        <div className="bag-summary__row">
          <dt>Subtotal</dt>
          <dd data-testid="bag-subtotal">{formatUsd(subtotalUsd)}</dd>
        </div>
        <div className="bag-summary__row">
          <dt>24V System Load</dt>
          <dd data-testid="bag-load">{loadW} W</dd>
        </div>
        <div className="bag-summary__row bag-summary__row--psu">
          <dt>PSU</dt>
          <dd data-testid="bag-psu">{psu.label}</dd>
        </div>
      </dl>
      <LoadMeter psu={psu} />
      <p className="bag-summary__note mono" data-testid="bag-psu-note">
        {note}
      </p>
      {count > 0 && (
        <button
          type="button"
          className="bag-summary__clear"
          data-armed={armed || undefined}
          onBlur={() => setArmed(false)}
          onClick={() => {
            if (armed) onClear();
            else setArmed(true);
          }}
        >
          {armed ? `Confirm: clear ${count} ${count === 1 ? 'item' : 'items'}` : 'Clear bag'}
        </button>
      )}
    </footer>
  );
}

export function BagDrawer({ open, onClose, returnFocusRef }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const listRef = useRef(null);
  const { lines, count, subtotalUsd, loadW, psu, step, remove, clear } = useBag();

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

  // Removing a line unmounts the focused button. Keep focus inside the dialog.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    if (!panelRef.current.contains(document.activeElement)) {
      (listRef.current ?? closeRef.current)?.focus();
    }
  }, [open, lines.length]);

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
              <span className="index-label__num">{padIndex(count)}</span> / Items
            </p>
            <h2 id="bag-drawer-title" className="drawer__title">
              Bag
            </h2>
          </div>
          <button ref={closeRef} type="button" className="drawer__close" onClick={onClose}>
            Close
          </button>
        </header>

        {lines.length > 0 ? (
          <div className="drawer__body drawer__body--lines">
            <ul ref={listRef} className="bag-lines" aria-label="Bag contents" tabIndex={-1}>
              {lines.map((line) => (
                <BagLine
                  key={line.key}
                  line={line}
                  onStep={(delta) => step(line.id, line.finish.id, delta)}
                  onRemove={() => remove(line.id, line.finish.id)}
                />
              ))}
            </ul>
          </div>
        ) : (
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
        )}

        <BagSummary count={count} subtotalUsd={subtotalUsd} loadW={loadW} psu={psu} onClear={clear} />
      </aside>
    </div>
  );
}
