import { useEffect, useId, useRef, useState } from 'react';
import { getFinish } from '../../data/products.js';
import { DIM_RANGE } from '../../lib/dimming.js';
import { ChevronGlyph } from '../icons.jsx';

/**
 * DALI-2 arc level, 10 to 100% in 5% steps. While the thumb moves, the
 * readout and fill follow by direct DOM writes, never React state; the
 * native `change` event (pointer release, or each key step) commits one
 * undoable edit.
 */
export function DimmingSlider({ value, onCommit, mixed = false, disabled = false, hint = '' }) {
  const id = useId();
  const inputRef = useRef(null);
  const readoutRef = useRef(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const paint = (level, label) => {
    const input = inputRef.current;
    if (!input) return;
    input.style.setProperty('--dim-fill', `${((level - DIM_RANGE.min) / (DIM_RANGE.max - DIM_RANGE.min)) * 100}%`);
    if (readoutRef.current) readoutRef.current.textContent = label;
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.value = String(value);
    paint(value, mixed ? 'Mixed' : `${value}%`);
  }, [value, mixed]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const onInput = () => paint(Number(input.value), `${input.value}%`);
    const onChange = () => commitRef.current(Number(input.value));
    input.addEventListener('input', onInput);
    input.addEventListener('change', onChange);
    return () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('change', onChange);
    };
  }, []);

  return (
    <div className="dim-slider" data-disabled={disabled || undefined}>
      <div className="dim-slider__head">
        <label className="field__label" htmlFor={id}>
          Dimming (10-100%)
        </label>
        <output className="dim-slider__value mono" htmlFor={id} ref={readoutRef} data-testid="module-dim-value">
          {mixed ? 'Mixed' : `${value}%`}
        </output>
      </div>
      <input
        ref={inputRef}
        id={id}
        className="dim-slider__input"
        type="range"
        min={DIM_RANGE.min}
        max={DIM_RANGE.max}
        step={DIM_RANGE.step}
        defaultValue={value}
        disabled={disabled}
        aria-valuetext={mixed ? 'Mixed levels' : `${value} percent`}
        data-testid="module-dim-slider"
        data-dim-pct={mixed ? 'mixed' : value}
      />
      {hint && <p className="dim-slider__hint mono">{hint}</p>}
    </div>
  );
}

/**
 * Numeric input that commits on Enter or blur, never per keystroke, so one
 * edit is one undo step. `normalize` maps a parsed number to the value the
 * store will actually hold (clamped, snapped); the draft shows that value.
 */
export function NumberField({ label, value, min, max, step = 1, normalize, onCommit, disabled, testId }) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);

  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }

  const commit = () => {
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = normalize ? normalize(parsed) : parsed;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="field studio-field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            setDraft(String(value));
          }
        }}
      />
    </div>
  );
}

export function Switch({ label, checked, onChange, disabled, hint, testId }) {
  return (
    <button
      type="button"
      role="switch"
      className="studio-switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    >
      <span className="studio-switch__track" aria-hidden="true">
        <span className="studio-switch__thumb" />
      </span>
      <span className="studio-switch__label">{label}</span>
      {hint && <span className="studio-switch__hint mono">{hint}</span>}
    </button>
  );
}

export function FinishPicker({ product, finishId, onChange }) {
  const uid = useId();
  const finish = getFinish(finishId);
  return (
    <fieldset className="swatches studio-swatches">
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
                onChange={() => onChange(id)}
              />
              <span className="swatch__chip" aria-hidden="true" />
              <span className="visually-hidden">{option.label}</span>
            </label>
          );
        })}
        <span className="swatches__name">{finish.name}</span>
      </div>
    </fieldset>
  );
}

/**
 * Progressive disclosure: a one-line summary that expands to its controls.
 * Collapsed content is inert, so it leaves the tab order and the
 * accessibility tree until the summary is opened.
 */
export function Disclosure({ label, summary, children, testId }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="disclosure" data-open={open || undefined} data-testid={testId}>
      <button
        type="button"
        className="disclosure__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="disclosure__label">{label}</span>
        <span className="disclosure__summary mono">{summary}</span>
        <ChevronGlyph className="disclosure__chevron" />
      </button>
      <div id={id} className="disclosure__panel" inert={!open}>
        <div className="disclosure__inner">{children}</div>
      </div>
    </div>
  );
}

export function PanelSection({ index, title, children, className = '' }) {
  return (
    <section className={`studio-panel__section ${className}`.trim()} aria-label={title}>
      <h2 className="index-label studio-panel__heading">
        <span className="index-label__num">{index}</span> / {title}
      </h2>
      {children}
    </section>
  );
}
