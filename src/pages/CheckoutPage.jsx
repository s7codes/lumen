import { useId, useMemo, useRef, useState } from 'react';
import { submitQuote } from '../api/client.js';
import { SpinnerRing } from '../components/CloudSaveButton.jsx';
import { EmptyState } from '../components/EmptyState.jsx';
import { ArrowRight } from '../components/icons.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useBag } from '../hooks/useBag.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { padIndex } from '../lib/format.js';
import {
  buildQuote,
  CURRENCIES,
  FIELD_LIMITS,
  formatMoney,
  ISSUER,
  resolvePromo,
  sanitizeProject,
  serializeQuote,
  validateProject,
} from '../lib/quote.js';
import '../styles/pages.css';
import '../styles/checkout.css';

const EMPTY_FORM = { reference: '', preparedFor: '', notes: '' };

function rateLabel(currency) {
  return currency.code === 'USD' ? 'Base currency' : `1 USD = ${currency.num / currency.den} ${currency.code}`;
}

function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({ id, label, error, hint, children }) {
  return (
    <div className="field checkout-field" data-invalid={error ? 'true' : undefined}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="checkout-field__error mono">
          {error}
        </p>
      ) : (
        hint && <p className="checkout-field__hint mono">{hint}</p>
      )}
    </div>
  );
}

function Money({ value, currency, testId, deduct = false }) {
  return (
    <span className="mono" data-testid={testId} data-minor={value}>
      {formatMoney(deduct ? -value : value, currency)}
    </span>
  );
}

function InstallationSchedule({ installation }) {
  const { totalAnchors, totalLinearWidthCm, recommendedCableM, circuits, circuitRatedW } = installation;
  return (
    <section
      className="quote-sheet__section install-schedule"
      aria-label="Installation and hardware schedule"
      data-testid="installation-schedule"
    >
      <p className="index-label">
        <span className="index-label__num">02</span> / Installation &amp; Hardware Schedule
      </p>
      <dl className="install-schedule__grid">
        <div className="install-schedule__cell">
          <dt>Wall anchors</dt>
          <dd data-testid="install-anchors" data-value={totalAnchors}>
            {totalAnchors} pcs
          </dd>
          <p className="install-schedule__note">Per catalog mounting points</p>
        </div>
        <div className="install-schedule__cell">
          <dt>Linear wall span</dt>
          <dd data-testid="install-span" data-value={totalLinearWidthCm}>
            {totalLinearWidthCm} cm / {(totalLinearWidthCm / 100).toFixed(2)} m
          </dd>
          <p className="install-schedule__note">Wall-hung and recessed parts</p>
        </div>
        <div className="install-schedule__cell">
          <dt>24V trunk cable</dt>
          <dd data-testid="install-cable" data-value={recommendedCableM}>
            {recommendedCableM.toFixed(1)} m
          </dd>
          <p className="install-schedule__note">2 x 2.5 mm2 Cu, incl. lead-in</p>
        </div>
        <div className="install-schedule__cell">
          <dt>SELV circuits</dt>
          <dd data-testid="install-circuits" data-value={circuits}>
            {circuits === 0 ? 'None' : `${circuits} x ${circuitRatedW} W`}
          </dd>
          <p className="install-schedule__note">{circuits === 0 ? 'Passive parts only' : 'Class 2, under 3% drop'}</p>
        </div>
      </dl>
    </section>
  );
}

const FULFILMENT_OPTIONS = [
  { mode: 'consolidated', label: 'Consolidated Dispatch' },
  { mode: 'split', label: 'Split Rough-In Dispatch' },
];

function formatKg(value) {
  return `${value.toFixed(1)} kg`;
}

function LogisticsSchedule({ logistics, onModeChange }) {
  const { crates, waves } = logistics;
  return (
    <section
      className="quote-sheet__section logistics"
      aria-label="Logistics and crate schedule"
      data-testid="logistics-schedule"
      data-mode={logistics.mode}
    >
      <div className="logistics__head">
        <p className="index-label">
          <span className="index-label__num">04</span> / Logistics &amp; Crate Schedule
        </p>
        <div className="segment-switch logistics__switch no-print" role="group" aria-label="Fulfilment mode">
          {FULFILMENT_OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              className="segment-switch__option"
              aria-pressed={logistics.mode === option.mode}
              data-testid={`fulfilment-${option.mode}`}
              onClick={() => onModeChange(option.mode)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <dl className="install-schedule__grid">
        <div className="install-schedule__cell">
          <dt>Net / gross mass</dt>
          <dd
            data-testid="logistics-weight"
            data-net={logistics.netWeightKg}
            data-tare={logistics.tareWeightKg}
            data-gross={logistics.grossWeightKg}
          >
            {logistics.netWeightKg.toFixed(1)} / {formatKg(logistics.grossWeightKg)}
          </dd>
          <p className="install-schedule__note">Tare {formatKg(logistics.tareWeightKg)}, crating and foam</p>
        </div>
        <div className="install-schedule__cell">
          <dt>Crated volume</dt>
          <dd data-testid="logistics-volume" data-value={logistics.totalVolumeM3}>
            {logistics.totalVolumeM3.toFixed(2)} m3
          </dd>
          <p className="install-schedule__note">
            {crates.length} {crates.length === 1 ? 'crate' : 'crates'}, {logistics.pieceCount} pcs
          </p>
        </div>
        <div className="install-schedule__cell">
          <dt>Freight class</dt>
          <dd data-testid="logistics-freight-class">{logistics.freightClass ?? '--'}</dd>
          <p className="install-schedule__note">Longest crate {logistics.longestCrateCm} cm</p>
        </div>
        <div className="install-schedule__cell">
          <dt>Dispatch window</dt>
          <dd data-testid="logistics-window">{logistics.windowLabel}</dd>
          <p className="install-schedule__note" data-testid="logistics-mode-label">
            {logistics.modeLabel}
          </p>
        </div>
      </dl>

      <div className="logistics__columns">
        <div className="logistics__column">
          <p className="logistics__caption">Packing manifest</p>
          <ol className="logistics__list" data-testid="logistics-crate-list">
            {crates.map((crate) => (
              <li
                key={crate.id}
                className="logistics__item"
                data-testid="logistics-crate"
                data-code={crate.code}
                data-type={crate.type}
              >
                <div className="logistics__item-head">
                  <span className="logistics__code mono">{crate.code}</span>
                  <span className="logistics__label">{crate.label}</span>
                  <span className="logistics__figure mono">{formatKg(crate.grossWeightKg)}</span>
                </div>
                <p className="logistics__meta mono">
                  {crate.dimsCm.w} x {crate.dimsCm.h} x {crate.dimsCm.d} cm / {crate.itemCount} pcs
                </p>
                <ul className="logistics__skus" aria-label={`${crate.code} contents`}>
                  {crate.contents.map((entry) => (
                    <li key={entry.sku} className="logistics__sku mono" data-sku={entry.sku}>
                      {entry.qty} x {entry.sku}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>

        <div className="logistics__column">
          <p className="logistics__caption">Dispatch waves</p>
          <ol className="logistics__list" data-testid="logistics-wave-list">
            {waves.map((wave) => (
              <li key={wave.id} className="logistics__item" data-testid="logistics-wave" data-code={wave.code}>
                <div className="logistics__item-head">
                  <span className="logistics__code mono">{wave.code}</span>
                  <span className="logistics__label">{wave.label}</span>
                  <span className="logistics__figure mono">{wave.window}</span>
                </div>
                <ul className="logistics__wave-lines">
                  {wave.lines.map((line) => (
                    <li key={line.sku} className="logistics__wave-line mono" data-sku={line.sku}>
                      <span>
                        {line.qty} x {line.name}
                      </span>
                      <span className="logistics__lead">{line.lead}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          {logistics.note && (
            <p className="logistics__note mono" data-testid="logistics-note">
              {logistics.note}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function QuoteSheet({ quote, project, onModeChange }) {
  const { currency, totals, electrical } = quote;
  const { psu } = electrical;
  const utilisation = Math.round(psu.utilisation * 100);

  return (
    <article className="quote-sheet" aria-labelledby="quote-title" data-testid="quote-sheet">
      <header className="quote-sheet__head">
        <div className="quote-sheet__issuer">
          <p className="quote-sheet__brand">{ISSUER.name}</p>
          <p className="mono">{ISSUER.address}</p>
          <p className="mono">{ISSUER.country}</p>
        </div>
        <dl className="quote-sheet__meta">
          <div>
            <dt>Quote</dt>
            <dd data-testid="quote-id">{quote.quoteId}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd data-testid="quote-date">{quote.date}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{quote.validUntil}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd data-testid="quote-currency">
              {currency.code} / {rateLabel(currency)}
            </dd>
          </div>
        </dl>
      </header>

      <h2 id="quote-title" className="quote-sheet__title">
        Project Quote and Specification
      </h2>

      <dl className="quote-sheet__project">
        <div>
          <dt>Project reference</dt>
          <dd data-testid="quote-project">{project.reference || '--'}</dd>
        </div>
        <div>
          <dt>Prepared for</dt>
          <dd data-testid="quote-client">{project.preparedFor || '--'}</dd>
        </div>
        <div className="quote-sheet__notes">
          <dt>Installation notes</dt>
          <dd data-testid="quote-notes">{project.notes || '--'}</dd>
        </div>
      </dl>

      <section className="quote-sheet__section" aria-label="24V electrical summary" data-testid="quote-electrical">
        <p className="index-label">
          <span className="index-label__num">01</span> / 24V electrical summary
        </p>
        <dl className="quote-sheet__electrical">
          <div>
            <dt>Bus</dt>
            <dd>{electrical.busVoltage} V DC</dd>
          </div>
          <div>
            <dt>Connected load</dt>
            <dd data-testid="quote-load">{electrical.loadW} W</dd>
          </div>
          <div>
            <dt>Current</dt>
            <dd>{electrical.currentA.toFixed(2)} A</dd>
          </div>
          <div>
            <dt>Driver</dt>
            <dd data-testid="quote-psu">
              {psu.label}
              {psu.drivers > 0 && ` / ${utilisation}% of ${psu.capacityW} W`}
            </dd>
          </div>
        </dl>
        {psu.drivers > 0 && !electrical.driverIncluded && (
          <p className="quote-sheet__warning mono" data-testid="driver-excluded">
            Driver excluded. Supply by others to {psu.capacityW} W at 24V DC.
          </p>
        )}
      </section>

      <InstallationSchedule installation={quote.installation} />

      <section className="quote-sheet__section" aria-label="Bill of materials">
        <p className="index-label">
          <span className="index-label__num">03</span> / Bill of materials
        </p>
        <div className="bom-wrap">
          <table className="bom" data-testid="quote-bom">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="bom__num">
                  Qty
                </th>
                <th scope="col" className="bom__num bom__unit">
                  Unit
                </th>
                <th scope="col" className="bom__num">
                  Line
                </th>
              </tr>
            </thead>
            <tbody>
              {quote.lines.map((line, i) => (
                <tr
                  key={line.key}
                  data-testid={line.driver ? 'quote-driver-line' : 'quote-line'}
                  data-sku={line.sku}
                >
                  <th scope="row">
                    <span className="bom__index mono">{padIndex(i + 1)}</span>
                    <span className="bom__name">{line.name}</span>
                    <span className="bom__meta mono">
                      {line.sku} / {line.finish}
                      {line.watts > 0 && ` / ${line.watts} W`}
                    </span>
                  </th>
                  <td className="bom__num mono">{line.qty}</td>
                  <td className="bom__num bom__unit mono">{formatMoney(line.unitMinor, currency)}</td>
                  <td className="bom__num mono" data-minor={line.lineMinor}>
                    {formatMoney(line.lineMinor, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <dl className="quote-totals" data-testid="quote-totals">
        <div className="quote-totals__row">
          <dt>Net</dt>
          <dd>
            <Money value={totals.net} currency={currency} testId="quote-net" />
          </dd>
        </div>
        <div className="quote-totals__row">
          <dt>Discount{quote.promo ? ` ${quote.promo.code}, ${totals.discountPct}%` : ''}</dt>
          <dd>
            <Money value={totals.discount} currency={currency} testId="quote-discount" deduct />
          </dd>
        </div>
        <div className="quote-totals__row">
          <dt>Net after discount</dt>
          <dd>
            <Money value={totals.netAfterDiscount} currency={currency} testId="quote-net-after" />
          </dd>
        </div>
        <div className="quote-totals__row">
          <dt>VAT {totals.vatPct}%</dt>
          <dd>
            <Money value={totals.vat} currency={currency} testId="quote-vat" />
          </dd>
        </div>
        <div className="quote-totals__row quote-totals__row--gross">
          <dt>Gross total</dt>
          <dd>
            <Money value={totals.gross} currency={currency} testId="quote-gross" />
          </dd>
        </div>
      </dl>

      <LogisticsSchedule logistics={quote.logistics} onModeChange={onModeChange} />

      <footer className="quote-sheet__foot mono">
        Prices ex works Budapest. Lead times per catalog, freight quoted separately. Quote valid {quote.validUntil}. All
        fixtures 24V DC SELV.
      </footer>
    </article>
  );
}

export default function CheckoutPage() {
  useDocumentTitle('Checkout');
  const uid = useId();
  const { items, count } = useBag();
  const [currencyCode, selectCurrency] = useCurrency();
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState(null);
  const [promoNote, setPromoNote] = useState({ text: '', tone: 'info' });
  const [includeDriver, setIncludeDriver] = useState(true);
  const [fulfilmentMode, setFulfilmentMode] = useState('consolidated');
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [confirmed, setConfirmed] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const { addToast } = useToast();

  const quote = useMemo(
    () => buildQuote({ items, currencyCode, promo, includeDriver, fulfilmentMode }),
    [items, currencyCode, promo, includeDriver, fulfilmentMode],
  );
  const project = useMemo(() => sanitizeProject(form), [form]);
  const needsDriver = quote.electrical.psu.drivers > 0;

  const applyPromo = (event) => {
    event.preventDefault();
    const match = resolvePromo(promoInput);
    if (match) {
      setPromo(match);
      setPromoInput(match.code);
      setPromoNote({ text: `${match.code} applied: ${match.label}, ${match.pct}% off net.`, tone: 'info' });
    } else {
      setPromo(null);
      setPromoNote({ text: 'Code not recognised. Trade codes are issued by the Lumen trade desk.', tone: 'fault' });
    }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoInput('');
    setPromoNote({ text: 'Promo code removed.', tone: 'info' });
  };

  const updateField = (key) => (event) => {
    const value = event.target.value.slice(0, FIELD_LIMITS[key]);
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    const next = validateProject(project);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = next.reference ? 'reference' : 'preparedFor';
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      const record = await submitQuote({ quote, project });
      setConfirmed({ ref: record.ref, quoteId: record.quoteId, project, gross: quote.totals.gross, currency: quote.currency });
      addToast(`Requisition ${record.ref} logged for ${project.reference}.`, 'success');
    } catch (error) {
      addToast(error?.name === 'ApiError' ? error.message : 'Submission failed. Try again.', 'error');
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const exportJson = () => {
    downloadJson(`lumen-quote-${quote.quoteId}.json`, serializeQuote(quote, project));
    addToast(`Quote ${quote.quoteId} saved as JSON.`, 'success');
  };

  if (count === 0 && !confirmed) {
    return (
      <>
        <PageHeader
          index="05"
          section="Checkout"
          title="Project Quote"
          lede="The cart is empty, so there is nothing to quote yet. Specify parts in the catalog or send a planned wall or room to the cart."
        />
        <div className="container checkout-empty" data-testid="checkout-empty">
          <div className="checkout-empty__card bento">
            <EmptyState
              art="shelf"
              title="No parts specified yet."
              body="Compose a wall in the studio or specify parts from the catalog. The quote, driver sizing and VAT build here."
              actions={[
                { to: '/studio-2d', label: 'Start 2D Wall Studio', primary: true },
                { to: '/catalog', label: 'Browse Catalog' },
              ]}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="no-print">
        <PageHeader
          index="05"
          section="Checkout"
          title="Project Quote"
          lede="Bill of materials, 24V driver provisioning, currency and trade terms in one sheet. Print it, export it as JSON or submit it as a requisition."
          meta={[
            ['Lines', padIndex(quote.lines.length)],
            ['Load', `${quote.electrical.loadW} W`],
            ['VAT', `${quote.totals.vatPct}%`],
          ]}
        />
      </div>

      <div className="checkout container">
        <div className="checkout__controls no-print">
          <section className="checkout-panel" aria-labelledby={`${uid}-terms`}>
            <h2 id={`${uid}-terms`} className="index-label">
              <span className="index-label__num">A</span> / Currency and terms
            </h2>
            <div className="segment-switch segment-switch--wide segment-switch--row" role="group" aria-label="Currency">
              {CURRENCIES.map((currency) => (
                <button
                  key={currency.code}
                  type="button"
                  className="segment-switch__option"
                  aria-pressed={currency.code === currencyCode}
                  data-testid={`currency-${currency.code}`}
                  onClick={() => selectCurrency(currency.code)}
                >
                  {currency.code}
                </button>
              ))}
            </div>
            <p className="checkout-panel__note mono">{rateLabel(quote.currency)}</p>

            <form className="promo" onSubmit={applyPromo} noValidate>
              <div className="field promo__field">
                <label className="field__label" htmlFor={`${uid}-promo`}>
                  Trade / studio code
                </label>
                <input
                  id={`${uid}-promo`}
                  className="field__input"
                  type="text"
                  value={promoInput}
                  maxLength={24}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="promo-input"
                  onChange={(event) => setPromoInput(event.target.value.slice(0, 24))}
                />
              </div>
              <button type="submit" className="button promo__apply" data-testid="promo-apply">
                Apply
              </button>
              {promo && (
                <button type="button" className="button promo__apply" onClick={clearPromo}>
                  Remove
                </button>
              )}
            </form>
            <p
              className="checkout-panel__note mono"
              data-tone={promoNote.tone}
              role="status"
              aria-live="polite"
              data-testid="promo-status"
            >
              {promoNote.text}
            </p>

            <label className="checkout-toggle" data-disabled={!needsDriver || undefined}>
              <input
                type="checkbox"
                checked={includeDriver && needsDriver}
                disabled={!needsDriver}
                data-testid="driver-toggle"
                onChange={(event) => setIncludeDriver(event.target.checked)}
              />
              <span>
                Provision 24V driver
                <span className="checkout-toggle__meta mono">{quote.electrical.psu.label}</span>
              </span>
            </label>
          </section>

          <form className="checkout-panel" aria-labelledby={`${uid}-project`} onSubmit={submit} noValidate>
            <h2 id={`${uid}-project`} className="index-label">
              <span className="index-label__num">B</span> / Project and client
            </h2>
            <Field id={`${uid}-reference`} label="Project reference" error={errors.reference}>
              <input
                id={`${uid}-reference`}
                className="field__input"
                type="text"
                value={form.reference}
                maxLength={FIELD_LIMITS.reference}
                placeholder="Nordic Residence - Living Wall"
                autoComplete="off"
                aria-invalid={errors.reference ? 'true' : undefined}
                aria-describedby={errors.reference ? `${uid}-reference-error` : undefined}
                data-testid="project-reference"
                onChange={updateField('reference')}
              />
            </Field>
            <Field id={`${uid}-preparedFor`} label="Prepared for (client / studio)" error={errors.preparedFor}>
              <input
                id={`${uid}-preparedFor`}
                className="field__input"
                type="text"
                value={form.preparedFor}
                maxLength={FIELD_LIMITS.preparedFor}
                placeholder="Studio Halvorsen Arkitekter"
                autoComplete="organization"
                aria-invalid={errors.preparedFor ? 'true' : undefined}
                aria-describedby={errors.preparedFor ? `${uid}-preparedFor-error` : undefined}
                data-testid="project-client"
                onChange={updateField('preparedFor')}
              />
            </Field>
            <Field
              id={`${uid}-notes`}
              label="Installation notes"
              hint={`${form.notes.length} / ${FIELD_LIMITS.notes}`}
            >
              <textarea
                id={`${uid}-notes`}
                className="field__input checkout-field__textarea"
                rows={4}
                value={form.notes}
                maxLength={FIELD_LIMITS.notes}
                placeholder="Plaster-in track before skim coat. Driver in utility void, max 3 m feed."
                data-testid="project-notes"
                onChange={updateField('notes')}
              />
            </Field>

            <div className="checkout-actions">
              <button type="button" className="button" data-testid="print-quote" onClick={() => window.print()}>
                Print Official Quote
              </button>
              <button type="button" className="button" data-testid="download-quote" onClick={exportJson}>
                Download Spec JSON
              </button>
              <button
                type="submit"
                className="button button--primary cloud-save"
                data-testid="submit-requisition"
                data-state={submitting ? 'saving' : 'idle'}
                disabled={submitting}
                aria-busy={submitting || undefined}
              >
                {submitting ? (
                  <>
                    <span className="cloud-save__icon">
                      <SpinnerRing />
                    </span>
                    Submitting to Lumen Cloud...
                  </>
                ) : (
                  <>
                    Submit Project Requisition
                    <ArrowRight />
                  </>
                )}
              </button>
            </div>

            {confirmed && (
              <div className="requisition" role="status" data-testid="requisition-confirmed">
                <p className="index-label">Requisition logged</p>
                <p className="requisition__ref mono" data-testid="requisition-ref">
                  {confirmed.ref}
                </p>
                <dl className="spec-table">
                  <div className="spec-table__row">
                    <dt>Quote</dt>
                    <dd>{confirmed.quoteId}</dd>
                  </div>
                  <div className="spec-table__row">
                    <dt>Project</dt>
                    <dd data-testid="requisition-project">{confirmed.project.reference}</dd>
                  </div>
                  <div className="spec-table__row">
                    <dt>Client</dt>
                    <dd>{confirmed.project.preparedFor}</dd>
                  </div>
                  <div className="spec-table__row">
                    <dt>Gross</dt>
                    <dd>{formatMoney(confirmed.gross, confirmed.currency)}</dd>
                  </div>
                </dl>
                <p className="checkout-panel__note mono">
                  Status: pending trade desk review. Quote the reference in all correspondence.
                </p>
              </div>
            )}
          </form>
        </div>

        <div className="checkout__sheet">
          <QuoteSheet quote={quote} project={project} onModeChange={setFulfilmentMode} />
        </div>
      </div>
    </>
  );
}
