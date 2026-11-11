import '../styles/cloud.css';

const LABELS = Object.freeze({
  idle: 'Save to Cloud',
  error: 'Retry Save',
  saving: 'Saving to Lumen Cloud...',
  saved: 'Project Saved',
});

function UploadGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M4.5 12.5h-.75a2.75 2.75 0 0 1-.4-5.47 4 4 0 0 1 7.8-.78A2.75 2.75 0 1 1 12 12.5h-.5" stroke="currentColor" strokeWidth="1" />
      <path d="M8 13.5V8.25M5.75 10.25 8 8l2.25 2.25" stroke="currentColor" strokeWidth="1" strokeLinecap="square" />
    </svg>
  );
}

export function SpinnerRing() {
  return (
    <svg className="cloud-save__ring" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg className="cloud-save__check" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" pathLength="1" />
    </svg>
  );
}

/**
 * Save button with an in-place sync state. The glyph and the active label
 * travel as one centred unit; the key's width comes from its row, never from
 * the label, so it holds still while the state changes.
 */
export function CloudSaveButton({ status, disabled = false, onSave, className = '', testId }) {
  const saving = status === 'saving';
  const label = LABELS[status] ?? LABELS.idle;

  return (
    <button
      type="button"
      className={`button cloud-save ${className}`.trim()}
      data-testid={testId}
      data-state={status}
      disabled={disabled || saving}
      aria-busy={saving || undefined}
      onClick={onSave}
    >
      <span className="cloud-save__icon" aria-hidden="true">
        {saving ? <SpinnerRing /> : status === 'saved' ? <CheckGlyph /> : <UploadGlyph />}
      </span>
      <span key={label} className="cloud-save__label">
        {label}
      </span>
    </button>
  );
}

/** Opens the A/B diff of the live draft against its last cloud revision. */
export function CompareChangesButton({ onCompare }) {
  return (
    <button
      type="button"
      className="button studio-summary__compare"
      data-testid="open-draft-diff"
      aria-haspopup="dialog"
      title="Compare the draft with its last saved cloud revision"
      onClick={(event) => onCompare(event.currentTarget)}
    >
      Compare Changes
    </button>
  );
}
