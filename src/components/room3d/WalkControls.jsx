import { TURN_STEP_DEG } from '../../lib/room-walkthrough.js';

function Arrow({ rotate = 0 }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M8 3v10M4 7l4-4 4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

function Turn({ mirror = false }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false" style={mirror ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M12.5 12V8.5A3.5 3.5 0 0 0 9 5H3.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 2.5 3.5 5 6 7.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
    </svg>
  );
}

const KEYS = Object.freeze([
  { testId: 'turn-left', label: `Turn left ${TURN_STEP_DEG} deg`, hint: 'Q', icon: <Turn />, turn: -TURN_STEP_DEG },
  { testId: 'walk-forward', label: 'Step forward', hint: 'W', icon: <Arrow />, move: { forward: 1 } },
  { testId: 'turn-right', label: `Turn right ${TURN_STEP_DEG} deg`, hint: 'E', icon: <Turn mirror />, turn: TURN_STEP_DEG },
  { testId: 'walk-left', label: 'Step left', hint: 'A', icon: <Arrow rotate={-90} />, move: { strafe: -1 } },
  { testId: 'walk-backward', label: 'Step back', hint: 'S', icon: <Arrow rotate={180} />, move: { forward: -1 } },
  { testId: 'walk-right', label: 'Step right', hint: 'D', icon: <Arrow rotate={90} />, move: { strafe: 1 } },
]);

/** Tactile step pad for the inside-room lens: three turn and step keys over three strafe keys, and a reset. */
export function WalkControls({ onStep, onTurn, onReset }) {
  return (
    <div className="room3d-walk room3d-hud__pill" role="group" aria-label="Walk inside the room" data-testid="walk-controls">
      <div className="room3d-walk__pad">
        {KEYS.map((key) => (
          <button
            key={key.testId}
            type="button"
            className="tool-button room3d-walk__key"
            data-testid={key.testId}
            aria-label={key.label}
            title={`${key.label} (${key.hint})`}
            onClick={() => (key.turn ? onTurn(key.turn) : onStep(key.move))}
          >
            {key.icon}
          </button>
        ))}
      </div>
      <button type="button" className="tool-button room3d-walk__reset" data-testid="walk-reset" onClick={onReset}>
        Reset Stance
      </button>
    </div>
  );
}
