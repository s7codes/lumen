import { useDisplayMode } from '../hooks/useDisplayMode.js';

const OPTIONS = [
  { id: 'architectural', label: 'Architectural', short: 'Arch' },
  { id: 'technical', label: 'Technical', short: 'Tech' },
];

export function ModeSwitch() {
  const [mode, setMode] = useDisplayMode();

  return (
    <div className="mode-switch" role="group" aria-label="Display mode">
      <span className="mode-switch__label" aria-hidden="true">
        Mode:
      </span>
      <div className="mode-switch__track">
        {OPTIONS.map((option, i) => (
          <span key={option.id} className="mode-switch__cell">
            {i > 0 && (
              <span className="mode-switch__sep" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              className="mode-switch__option"
              aria-pressed={mode === option.id}
              onClick={() => setMode(option.id)}
            >
              <span className="mode-switch__led" aria-hidden="true" />
              <span className="mode-switch__text-long">{option.label}</span>
              <span className="mode-switch__text-short">{option.short}</span>
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
