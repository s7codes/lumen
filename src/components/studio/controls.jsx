import { useId, useState } from 'react';
import { getFinish } from '../../data/products.js';

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
