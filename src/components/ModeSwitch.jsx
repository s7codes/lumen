import { useDisplayMode } from '../hooks/useDisplayMode.js';

const OPTIONS = [
  { id: 'architectural', label: 'Architectural', short: 'Arch' },
  { id: 'technical', label: 'Technical', short: 'Tech' },
];

// The accessible name starts with the visible segment text, so speech input
// ("click Tech") and screen readers ("Technical") both resolve the button.
export function ModeSwitch() {
  const [mode, setMode] = useDisplayMode();

  return (
    <div className="mode-switch" role="group" aria-label="Display mode" data-testid="mode-switch">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className="mode-switch__segment"
          aria-label={option.label}
          aria-pressed={mode === option.id}
          data-mode-option={option.id}
          onClick={() => setMode(option.id)}
        >
          {option.short}
        </button>
      ))}
    </div>
  );
}
