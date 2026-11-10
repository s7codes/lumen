import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { efficacyLmPerW, getCategory, getFinish, STOCK_LABELS } from '../data/products.js';
import { useBag } from '../hooks/useBag.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { formatLeadTime, formatUsd, padIndex } from '../lib/format.js';
import { rgbTriplet } from '../lib/photometry.js';
import { PlusGlyph } from './icons.jsx';
import { ProductElevation } from './ProductElevation.jsx';
import '../styles/product.css';

function telemetryRows(product) {
  const efficacy = efficacyLmPerW(product);
  return [
    ['SKU', product.sku],
    ['24V DC load', `${product.watts} W`],
    ['Output', product.lumens > 0 ? `${product.lumens} lm` : '--'],
    ['Efficacy', efficacy === null ? '--' : `${efficacy.toFixed(1)} lm/W`],
    ['CRI', product.cri ? `${product.cri}+` : '--'],
    ['CCT', product.kelvin ? `${product.kelvin} K` : '--'],
    ['Mounting', `${product.mountingPoints} pts`],
    ['Lead time', formatLeadTime(product.leadWeeks)],
  ];
}

/**
 * Finish selection is uncontrolled by default. Pass `finishId` and
 * `onFinishChange` to keep the choice alive while the card is filtered out.
 */
export function ProductCard({ product, index, finishId: controlledFinish, onFinishChange }) {
  const [mode] = useDisplayMode();
  const { add, quantityOf } = useBag();
  const [ownFinish, setOwnFinish] = useState(product.defaultFinish);
  const uid = useId();

  const finishId = product.finishes.includes(controlledFinish) ? controlledFinish : ownFinish;
  const finish = getFinish(finishId);
  const category = getCategory(product.category);
  const technical = mode === 'technical';
  const inBag = quantityOf(product.id, finishId);
  const headingId = `${uid}-name`;
  const { w, h, d } = product.dimsCm;

  const selectFinish = (id) => {
    if (!product.finishes.includes(id)) return;
    if (onFinishChange) onFinishChange(product.id, id);
    else setOwnFinish(id);
  };

  const style = {
    '--finish-base': finish.hex,
    '--finish-hi': finish.highlight,
    '--finish-shade': finish.shade,
    '--light-rgb': rgbTriplet(product.kelvin ?? 2700),
  };

  return (
    <article
      className="product-card"
      aria-labelledby={headingId}
      data-finish={finishId}
      data-mode={mode}
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

      <div className="product-card__figure">
        <ProductElevation product={product} finish={finish} technical={technical} />
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
        {technical ? (
          <dl className="telemetry" data-testid="product-telemetry">
            {telemetryRows(product).map(([term, value]) => (
              <div key={term} className="telemetry__cell">
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="product-card__summary">{product.summary}</p>
        )}
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
        {!technical && <p className="swatches__surface mono">{finish.surface}</p>}
      </fieldset>

      <footer className="product-card__foot">
        <p className="product-card__price">
          <span className="mono">{formatUsd(product.priceUsd)}</span>
          {inBag > 0 && (
            <span className="product-card__in-bag mono" data-testid="in-bag">
              In bag {inBag}
            </span>
          )}
        </p>
        <button
          type="button"
          className="button button--primary product-card__add"
          onClick={() => add(product.id, finishId)}
        >
          Add to Bag
          <span className="visually-hidden">
            : {product.name}, {finish.label}
          </span>
          <PlusGlyph />
        </button>
      </footer>
    </article>
  );
}
