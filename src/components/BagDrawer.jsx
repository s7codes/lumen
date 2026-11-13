import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext.jsx';
import { useBag } from '../hooks/useBag.js';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { MAX_LINE_QTY } from '../lib/bag.js';
import { formatUsd } from '../lib/format.js';
import { ArrowRight, BagGlyph, CloseGlyph, CubeGlyph, MinusGlyph, PlusGlyph } from './icons.jsx';
import { ProductThumbGlyph } from './ProductThumbGlyph.jsx';

const METER_SEGMENTS = 20;

/** "0 items", "1 item", "3 items": the header pill, the clear prompt and its toast. */
function itemCount(count) {
  return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function Stepper({ label, qty, onStep }) {
  const atMin = qty <= 1;
  const atMax = qty >= MAX_LINE_QTY;
  return (
    <div className="bag-stepper" role="group" aria-label={`Quantity, ${label}`}>
      <button
        type="button"
        className="bag-stepper__key"
        aria-label={`Decrease ${label}`}
        aria-disabled={atMin}
        onClick={() => !atMin && onStep(-1)}
      >
        <MinusGlyph />
      </button>
      <span className="bag-stepper__value" data-testid="bag-line-qty">
        {qty}
      </span>
      <button
        type="button"
        className="bag-stepper__key"
        aria-label={`Increase ${label}`}
        aria-disabled={atMax}
        onClick={() => !atMax && onStep(1)}
      >
        <PlusGlyph />
      </button>
    </div>
  );
}

// One cart line on its own card: the part drawing in the line's finish, the
// name and a finish badge, then quantity and Remove. The SKU / finish / load
// line stays in the DOM for Specs mode and the planner sync checks.
function BagLine({ line, onStep, onRemove }) {
  const { product, finish } = line;
  const label = `${product.name}, ${finish.label}`;
  return (
    <li className="bag-line" data-testid="bag-line" data-line={line.key}>
      <ProductThumbGlyph
        product={product}
        finish={finish.id}
        lit={product.watts > 0}
        className="bag-line__thumb"
      />
      <div className="bag-line__info">
        <p className="bag-line__name">{product.name}</p>
        <p className="bag-line__finish">
          <span
            className="bag-line__swatch"
            style={{ '--swatch': finish.hex, '--swatch-hi': finish.highlight, '--swatch-lo': finish.shade }}
            aria-hidden="true"
          />
          {finish.label}
        </p>
      </div>
      <p className="bag-line__meta">{`${product.sku} / ${finish.label} / ${product.watts} W`}</p>
      <p className="bag-line__price">
        <span className="bag-line__total">{formatUsd(line.lineUsd)}</span>
        {line.qty > 1 && <span className="bag-line__each">{`${formatUsd(product.priceUsd)} each`}</span>}
      </p>
      <Stepper label={label} qty={line.qty} onStep={onStep} />
      <button type="button" className="bag-line__remove" aria-label={`Remove ${label}`} onClick={onRemove}>
        Remove
      </button>
    </li>
  );
}

function EmptyCart({ onNavigate }) {
  return (
    <div className="bag-empty">
      <span className="bag-empty__emblem" aria-hidden="true">
        <BagGlyph testId={null} />
      </span>
      <h3 className="bag-empty__title">Your cart is empty</h3>
      <p className="bag-empty__copy">
        Explore our modular lighting and shelving or design your space in 3D to build your system.
      </p>
      <div className="bag-empty__actions">
        <Link to="/catalog" className="bag-pill bag-pill--primary" onClick={onNavigate}>
          Browse Catalog
          <ArrowRight />
        </Link>
        <Link to="/room-3d" className="bag-pill bag-pill--ghost" onClick={onNavigate}>
          <CubeGlyph />
          Open 3D Room Planner
        </Link>
      </div>
    </div>
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

// The summary card. The 24V block (load, power supply, meter and note) is
// always rendered: Visual mode shows the two rows of a filled cart, Specs mode
// adds the meter and the utilisation note, and an empty cart in Visual mode
// folds the whole card away (shell.css), so every value keeps its exact text.
function BagSummary({ count, subtotalUsd, loadW, psu, onClear, onCheckout }) {
  const [armed, setArmed] = useState(false);
  const percent = Math.round(psu.utilisation * 100);
  let note = 'Passive parts only, no driver load';
  if (psu.drivers === 1) note = `Driver utilisation ${percent}% of ${psu.capacityW} W`;
  if (psu.drivers > 1) {
    note = `${psu.drivers}x ${psu.capacityW / psu.drivers}W drivers / ${percent}% of ${psu.capacityW} W`;
  }

  return (
    <footer className="bag-summary">
      <div className="bag-summary__power">
        <dl className="bag-summary__rows">
          <div className="bag-summary__row">
            <dt>24V System Load</dt>
            <dd data-testid="bag-load">{`${loadW} W`}</dd>
          </div>
          <div className="bag-summary__row bag-summary__row--psu">
            <dt>Power Supply</dt>
            <dd data-testid="bag-psu">{psu.label}</dd>
          </div>
        </dl>
        <LoadMeter psu={psu} />
        <p className="bag-summary__note" data-testid="bag-psu-note">
          {note}
        </p>
      </div>
      <dl className="bag-summary__total">
        <div className="bag-summary__row bag-summary__row--subtotal">
          <dt>Subtotal</dt>
          <dd data-testid="bag-subtotal">{formatUsd(subtotalUsd)}</dd>
        </div>
      </dl>
      {count > 0 && <p className="bag-summary__fineprint">VAT and trade codes are applied at checkout.</p>}
      {count > 0 && (
        <Link
          to="/checkout"
          className="bag-pill bag-pill--primary bag-summary__checkout"
          data-testid="proceed-to-checkout"
          onClick={onCheckout}
        >
          Proceed to Checkout
          <ArrowRight />
        </Link>
      )}
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
          {armed ? `Confirm: clear ${itemCount(count)}` : 'Clear cart'}
        </button>
      )}
    </footer>
  );
}

export function BagDrawer({ open, onClose, returnFocus }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const listRef = useRef(null);
  const { lines, count, subtotalUsd, loadW, psu, step, remove, clear } = useBag();
  const { addToast } = useToast();

  const removeLine = (line) => {
    remove(line.id, line.finish.id);
    addToast(`Removed ${line.product.name}, ${line.finish.label} from the cart.`, 'info');
  };

  const clearBag = () => {
    clear();
    addToast(`Cart cleared: ${itemCount(count)} removed.`, 'info');
  };

  useModalDialog({ open, panelRef, initialFocusRef: closeRef, returnFocus, onClose });

  // Removing a line unmounts the focused button. Keep focus inside the dialog.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    if (!panelRef.current.contains(document.activeElement)) {
      (listRef.current ?? closeRef.current)?.focus();
    }
  }, [open, lines.length]);

  if (!open) return null;

  const filled = lines.length > 0;

  return (
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        id="bag-drawer"
        ref={panelRef}
        className="drawer bag-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bag-drawer-title"
        data-state={filled ? 'filled' : 'empty'}
      >
        <header className="bag-drawer__header">
          <div className="bag-drawer__heading">
            <BagGlyph className="bag-drawer__glyph" testId={null} />
            <h2 id="bag-drawer-title" className="bag-drawer__title">
              Your Cart
            </h2>
            <span className="bag-drawer__count" data-testid="bag-count">
              {itemCount(count)}
            </span>
          </div>
          <button ref={closeRef} type="button" className="bag-drawer__close" aria-label="Close" onClick={onClose}>
            <CloseGlyph />
          </button>
        </header>

        {filled ? (
          <div className="bag-drawer__body">
            <ul ref={listRef} className="bag-lines" aria-label="Cart contents" tabIndex={-1}>
              {lines.map((line) => (
                <BagLine
                  key={line.key}
                  line={line}
                  onStep={(delta) => step(line.id, line.finish.id, delta)}
                  onRemove={() => removeLine(line)}
                />
              ))}
            </ul>
          </div>
        ) : (
          <div className="bag-drawer__body bag-drawer__body--empty">
            <EmptyCart onNavigate={onClose} />
          </div>
        )}

        <BagSummary
          count={count}
          subtotalUsd={subtotalUsd}
          loadW={loadW}
          psu={psu}
          onClear={clearBag}
          onCheckout={onClose}
        />
      </aside>
    </div>
  );
}
