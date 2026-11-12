import { lazy, Suspense, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  anchorSchedule,
  BlueprintDrawing,
  BLUEPRINT_VIEWS,
  DEFAULT_SPREAD,
  fmtCm,
  loadExplodedAssembly,
} from '../components/BlueprintViews.jsx';
import { ArrowRight, PlusGlyph } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { PhotometricCurve } from '../components/PhotometricCurve.jsx';
import {
  efficacyLmPerW,
  getCategory,
  getFinish,
  getProduct,
  PRODUCTS,
  productHasFinish,
  STOCK_LABELS,
} from '../data/products.js';
import { useBag } from '../hooks/useBag.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { MAX_LINE_QTY } from '../lib/bag.js';
import { formatLeadTime, formatUsd, padIndex } from '../lib/format.js';
import { appendToRoom } from '../lib/room-3d.js';
import { appendToWallStudio, MAX_WALL_ITEMS } from '../lib/wall-studio.js';
import { isOneOf, isSafeId, sanitizeText } from '../security/sanitize.js';
import '../styles/pages.css';
import '../styles/product.css';
import '../styles/product-detail.css';

const VIEW_IDS = BLUEPRINT_VIEWS.map((view) => view.id);
const ExplosionSpreadControl = lazy(() =>
  loadExplodedAssembly().then((module) => ({ default: module.ExplosionSpreadControl })),
);
const warmExploded = () => {
  loadExplodedAssembly().catch(() => {});
};

function specRows(product) {
  const efficacy = efficacyLmPerW(product);
  const { w, h, d } = product.dimsCm;
  return [
    ['SKU', product.sku],
    ['Dimensions', `W ${w} x H ${h} x D ${d} cm`],
    ['Mass / Weight', `${product.weightKg.toFixed(1)} kg`, 'spec-weight'],
    ['Mounting', `${product.mount}, ${product.mountingPoints} pts`],
    ['24V DC load', `${product.watts} W`],
    ['Output', product.lumens > 0 ? `${product.lumens} lm` : '--'],
    ['Efficacy', efficacy === null ? '--' : `${efficacy.toFixed(1)} lm/W`],
    ['CCT / CRI', product.kelvin ? `${product.kelvin} K / ${product.cri}+` : '--'],
    ['Availability', `${STOCK_LABELS[product.stock]}, ${formatLeadTime(product.leadWeeks)}`],
  ];
}

function NotFound({ id }) {
  useDocumentTitle('Part not found');
  const shown = sanitizeText(id, { maxLength: 48 });
  return (
    <>
      <PageHeader
        index="02"
        section="Catalog"
        title="No part at this index."
        lede={`The catalog has no part with the id "${shown}". It may have been renamed or withdrawn.`}
      />
      <div className="container" data-testid="product-not-found">
        <Link to="/catalog" className="button">
          Back to catalog
          <ArrowRight />
        </Link>
      </div>
    </>
  );
}

function QtyStepper({ qty, onChange }) {
  return (
    <div className="stepper" role="group" aria-label="Quantity">
      <button
        type="button"
        className="stepper__button"
        aria-label="Decrease quantity"
        aria-disabled={qty <= 1}
        onClick={() => qty > 1 && onChange(qty - 1)}
      >
        -
      </button>
      <span className="stepper__value mono" data-testid="detail-qty">
        {qty}
      </span>
      <button
        type="button"
        className="stepper__button"
        aria-label="Increase quantity"
        aria-disabled={qty >= MAX_LINE_QTY}
        onClick={() => qty < MAX_LINE_QTY && onChange(qty + 1)}
      >
        +
      </button>
    </div>
  );
}

function ProductDetail({ product }) {
  useDocumentTitle(product.name);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { add, quantityOf } = useBag();
  const [view, setView] = useState('front');
  const [qty, setQty] = useState(1);
  const [status, setStatus] = useState('');
  const uid = useId();
  const drawingRef = useRef(null);
  const spreadRef = useRef(DEFAULT_SPREAD);

  const [finishId, setFinishId] = useState(() => {
    const requested = params.get('finish');
    return productHasFinish(product, requested) ? requested : product.defaultFinish;
  });
  const finish = getFinish(finishId);
  const category = getCategory(product.category);
  const index = PRODUCTS.indexOf(product) + 1;
  const schedule = anchorSchedule(product);
  const inBag = quantityOf(product.id, finishId);

  const selectFinish = (id) => {
    if (!productHasFinish(product, id)) return;
    setFinishId(id);
    setParams({ finish: id }, { replace: true, preventScrollReset: true });
  };

  const launch = (append, path, place) => {
    const result = append(product.id, finishId);
    if (!result) {
      setStatus(`${place} is full: ${MAX_WALL_ITEMS} modules at most. Remove one there first.`);
      return;
    }
    navigate(path, { state: { launchedUid: result.item.uid } });
  };

  return (
    <>
      <PageHeader
        index={padIndex(index)}
        section={`Catalog / ${category.label}`}
        title={product.name}
        lede={product.summary}
        meta={[
          ['SKU', product.sku],
          ['Unit', formatUsd(product.priceUsd)],
          ['Load', `${product.watts} W`],
          ['Lead', formatLeadTime(product.leadWeeks)],
        ]}
      />

      <div className="detail container" data-testid="product-detail" data-product={product.id}>
        <nav className="detail__crumbs mono" aria-label="Breadcrumb">
          <Link to="/catalog">Catalog</Link>
          <span aria-hidden="true">/</span>
          <Link to={`/catalog?category=${category.id}`}>{category.label}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{product.sku}</span>
        </nav>

        <div className="detail__grid">
          <section className="detail-panel detail__drawing" aria-labelledby={`${uid}-drawing`}>
            <header className="detail-panel__head">
              <p className="index-label">
                <span className="index-label__num">A</span> / Orthographic set
              </p>
              <h2 id={`${uid}-drawing`} className="detail-panel__title" data-testid="blueprint-title">
                {BLUEPRINT_VIEWS.find((entry) => entry.id === view).title}
              </h2>
            </header>
            <div className="segment-switch segment-switch--wide" role="group" aria-label="Drawing view">
              {BLUEPRINT_VIEWS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="segment-switch__option"
                  aria-pressed={view === entry.id}
                  data-testid={entry.testId}
                  onPointerEnter={entry.id === 'exploded' ? warmExploded : undefined}
                  onFocus={entry.id === 'exploded' ? warmExploded : undefined}
                  onClick={() => isOneOf(entry.id, VIEW_IDS) && setView(entry.id)}
                >
                  <span className="segment-switch__index">{entry.index}</span> {entry.label}
                </button>
              ))}
            </div>
            <div className="detail__sheet">
              <BlueprintDrawing product={product} view={view} finish={finish} svgRef={drawingRef} />
            </div>
            {view === 'exploded' && (
              <Suspense fallback={null}>
                <ExplosionSpreadControl targetRef={drawingRef} spreadRef={spreadRef} />
              </Suspense>
            )}
            {view === 'mounting' && (
              <dl className="spec-table spec-table--inline" data-testid="anchor-schedule">
                <div className="spec-table__row">
                  <dt>Anchors</dt>
                  <dd>{schedule.count}</dd>
                </div>
                <div className="spec-table__row">
                  <dt>Spacing c/c</dt>
                  <dd data-testid="anchor-spacing">
                    {schedule.spacingCm === null ? 'Single point' : `${fmtCm(schedule.spacingCm)} cm`}
                  </dd>
                </div>
                <div className="spec-table__row">
                  <dt>Edge to first</dt>
                  <dd>{fmtCm(schedule.edgeCm)} cm</dd>
                </div>
                <div className="spec-table__row">
                  <dt>Fixing</dt>
                  <dd>{schedule.fixing}</dd>
                </div>
              </dl>
            )}
          </section>

          <aside className="detail-panel detail__order" aria-labelledby={`${uid}-order`}>
            <header className="detail-panel__head">
              <p className="index-label">
                <span className="index-label__num">B</span> / Specify
              </p>
              <h2 id={`${uid}-order`} className="detail-panel__title">
                {formatUsd(product.priceUsd)} <span className="detail__unit mono">per unit, ex VAT</span>
              </h2>
            </header>

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
                <span className="swatches__name" data-testid="detail-finish">
                  {finish.name}
                </span>
              </div>
              <p className="swatches__surface mono">{finish.surface}</p>
            </fieldset>

            <div className="detail__buy">
              <QtyStepper qty={qty} onChange={setQty} />
              <button
                type="button"
                className="button button--primary detail__add"
                data-testid="detail-add-to-bag"
                onClick={() => add(product.id, finishId, qty)}
              >
                Add to Cart
                <span className="visually-hidden">
                  : {qty} x {product.name}, {finish.label}
                </span>
                <PlusGlyph />
              </button>
            </div>
            <p className="detail__in-bag mono" data-testid="detail-in-bag">
              {inBag > 0 ? `In cart ${inBag} / ${finish.label}` : `Not in cart / ${finish.label}`}
            </p>

            <div className="detail__launchers">
              <p className="index-label">Place in a workspace</p>
              <button
                type="button"
                className="button detail__launch"
                data-testid="launch-in-wall-studio"
                onClick={() => launch(appendToWallStudio, '/studio-2d', 'The wall')}
              >
                Mount in 2D Wall Studio
                <ArrowRight />
              </button>
              <button
                type="button"
                className="button detail__launch"
                data-testid="launch-in-room-3d"
                onClick={() => launch(appendToRoom, '/room-3d', 'The room')}
              >
                Place in 3D Room
                <ArrowRight />
              </button>
              <p className="detail__status mono" role="status" aria-live="polite" data-testid="launch-status">
                {status}
              </p>
            </div>

            <dl className="spec-table">
              {specRows(product).map(([term, value, testId]) => (
                <div key={term} className="spec-table__row">
                  <dt>{term}</dt>
                  <dd data-testid={testId}>{value}</dd>
                </div>
              ))}
            </dl>
          </aside>

          <section className="detail-panel detail__photometry" aria-labelledby={`${uid}-photometry`}>
            <header className="detail-panel__head">
              <p className="index-label">
                <span className="index-label__num">C</span> / {product.watts > 0 ? 'Photometry' : 'Electrical'}
              </p>
              <h2 id={`${uid}-photometry`} className="detail-panel__title">
                {product.watts > 0 ? 'Polar intensity distribution' : '24V DC current capacity and voltage drop'}
              </h2>
            </header>
            <PhotometricCurve product={product} />
          </section>
        </div>
      </div>
    </>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const product = isSafeId(id) ? getProduct(id) : null;
  return product ? <ProductDetail key={product.id} product={product} /> : <NotFound id={id ?? ''} />;
}
