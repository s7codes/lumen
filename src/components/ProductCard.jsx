import { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCategory, getFinish, STOCK_LABELS } from '../data/products.js';
import { useBag } from '../hooks/useBag.js';
import { useCursorGlow } from '../hooks/useCursorGlow.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { formatLeadTime, formatUsd, padIndex } from '../lib/format.js';
import { rgbTriplet } from '../lib/photometry.js';
import { PlusGlyph } from './icons.jsx';
import { ProductVisual } from './ProductVisual.jsx';
import '../styles/product.css';

/**
 * A storefront card: a lifelike interior of the part on top, the
 * specification straight on the paper below. The storefront always reads in
 * Visual mode; engineering detail lives on the product page and in the 3D
 * Room Planner. Finish selection is uncontrolled by default. Pass `finishId`
 * and `onFinishChange` to keep the choice alive while the card is filtered out.
 */
export function ProductCard({ product, index, finishId: controlledFinish, onFinishChange }) {
  const { add, quantityOf } = useBag();
  const [ownFinish, setOwnFinish] = useState(product.defaultFinish);
  const uid = useId();
  const cardRef = useRef(null);
  const reveal = useScrollReveal();
  // Callback refs attach before effects run, so useCursorGlow still finds the node.
  const attachCard = useCallback(
    (node) => {
      cardRef.current = node;
      const release = reveal(node);
      return () => {
        release?.();
        cardRef.current = null;
      };
    },
    [reveal],
  );
  useCursorGlow(cardRef);

  const finishId = product.finishes.includes(controlledFinish) ? controlledFinish : ownFinish;
  const finish = getFinish(finishId);
  const category = getCategory(product.category);
  const inBag = quantityOf(product.id, finishId);
  const headingId = `${uid}-name`;
  const { w, h, d } = product.dimsCm;

  const selectFinish = (id) => {
    if (!product.finishes.includes(id)) return;
    if (onFinishChange) onFinishChange(product.id, id);
    else setOwnFinish(id);
  };

  // The cursor light on the plinth takes the fixture's own colour temperature.
  const style = { '--light-rgb': rgbTriplet(product.kelvin ?? 2700) };

  return (
    <article
      ref={attachCard}
      className="product-card reveal-card"
      aria-labelledby={headingId}
      data-finish={finishId}
      data-sku={product.sku}
      style={style}
    >
      <header className="product-card__head">
        <p className="index-label">
          <span className="index-label__num">{padIndex(index)}</span> / {category.label}
        </p>
        <p className="product-card__stock mono" data-stock={product.stock}>
          {STOCK_LABELS[product.stock]} / {formatLeadTime(product.leadWeeks)}
        </p>
      </header>

      {/* The plinth: the part in true perspective in a daylight gallery corner, lit by its own 2700K light. */}
      <div className="product-card__figure">
        <ProductVisual product={product} finish={finish} />
      </div>

      <div className="product-card__body">
        <h3 id={headingId} className="product-card__name">
          <Link
            to={`/catalog/${product.id}?finish=${finishId}`}
            className="product-card__link"
            data-testid="product-spec-link"
          >
            {product.name}
          </Link>
        </h3>
        <p className="product-card__dims mono">
          W {w} / H {h} / D {d} cm
        </p>
        <p className="product-card__summary">{product.summary}</p>
      </div>

      <fieldset className="swatches">
        <legend className="swatches__legend">Finish</legend>
        <div className="swatches__row">
          {product.finishes.map((id) => {
            const option = getFinish(id);
            return (
              <label
                key={id}
                className="swatch"
                style={{ '--swatch': option.hex, '--swatch-hi': option.highlight, '--swatch-lo': option.shade }}
              >
                <input
                  className="swatch__input"
                  type="radio"
                  name={`${uid}-finish`}
                  value={id}
                  checked={id === finishId}
                  onChange={() => selectFinish(id)}
                />
                <span className="swatch__chip" aria-hidden="true" />
                <span className="visually-hidden">{option.label}</span>
              </label>
            );
          })}
          <span className="swatches__name">{finish.name}</span>
        </div>
        <p className="swatches__surface mono">{finish.surface}</p>
      </fieldset>

      <footer className="product-card__foot">
        <p className="product-card__price">
          <span className="mono">{formatUsd(product.priceUsd)}</span>
          {inBag > 0 && (
            <span className="product-card__in-bag mono" data-testid="in-bag">
              In cart {inBag}
            </span>
          )}
        </p>
        <button
          type="button"
          className="button button--primary product-card__add"
          onClick={() => add(product.id, finishId)}
        >
          Add to Cart
          <span className="visually-hidden">
            : {product.name}, {finish.label}
          </span>
          <PlusGlyph />
        </button>
      </footer>
    </article>
  );
}
