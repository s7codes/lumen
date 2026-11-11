import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { MODE_LABELS } from '../lib/display-mode.js';

const OPTIONS = [
  {
    id: 'architectural',
    label: MODE_LABELS.architectural,
    name: `${MODE_LABELS.architectural} (Architectural)`,
    title: 'Visual mode - clean presentation',
  },
  {
    id: 'technical',
    label: MODE_LABELS.technical,
    name: `${MODE_LABELS.technical} (Technical)`,
    title: 'Specs mode - dimensions, wiring & engineering data',
  },
];

// The accessible name starts with the visible segment text, so speech input
// ("click Specs") and screen readers ("Specs (Technical)") both resolve it.
export function ModeSwitch() {
  const [mode, setMode] = useDisplayMode();

  return (
    <div className="mode-switch" role="group" aria-label="Display mode" data-testid="mode-switch">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className="mode-switch__segment"
          aria-label={option.name}
          aria-pressed={mode === option.id}
          title={option.title}
          data-mode-option={option.id}
          onClick={() => setMode(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
