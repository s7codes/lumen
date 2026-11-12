import { CAMERA_MODE_LABELS } from '../../lib/room-walkthrough.js';
import { Switch } from '../studio/controls.jsx';
import { WallSwitcher } from './WallSwitcher.jsx';

function OrbitGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 4.5 12.5 7v4.5L8 14l-4.5-2.5V7L8 4.5Z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M2 6.5C2 4 4.7 2 8 2s6 2 6 4.5" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
    </svg>
  );
}

function EyeLevelGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 3h12v10H2z" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
      <path d="M2 7.5h12" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.5 1.5" />
      <path d="M8 5.5v4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ElevationGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.1" />
      <path d="M5.5 9.5h5M5.5 6.5h2.5" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" />
    </svg>
  );
}

function ZenGlyph({ on }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {on ? (
        <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
      ) : (
        <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
      )}
    </svg>
  );
}

const LENSES = Object.freeze([
  { id: 'orbit', testId: 'camera-mode-orbit', short: 'Orbit', icon: <OrbitGlyph /> },
  { id: 'inside', testId: 'camera-mode-walkthrough', short: 'Inside 165 cm', icon: <EyeLevelGlyph /> },
  { id: 'elevation', testId: 'camera-mode-elevation', short: 'Elevation', icon: <ElevationGlyph /> },
]);

export function CameraLensSwitcher({ mode, onChange }) {
  return (
    <div className="room3d-lens" role="group" aria-label="Camera lens" data-testid="camera-lens-switcher" data-mode={mode}>
      {LENSES.map((lens) => (
        <button
          key={lens.id}
          type="button"
          className="room3d-lens__option"
          aria-pressed={mode === lens.id}
          aria-label={CAMERA_MODE_LABELS[lens.id]}
          title={CAMERA_MODE_LABELS[lens.id]}
          data-testid={lens.testId}
          data-mode={lens.id}
          onClick={() => onChange(lens.id)}
        >
          {lens.icon}
          <span className="room3d-lens__label">{lens.short}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Workstation header: the page title and envelope, the active wall, the
 * camera lens, transform snapping and the zen viewport key in one bar.
 */
export function StudioHeader({ room, activeWall, counts, onWall, cameraMode, onCameraMode, snapOn, onSnap, zen, onZen }) {
  return (
    <header className="room3d-workstation__header" data-testid="studio-header">
      <div className="room3d-workstation__title">
        <p className="room3d-workstation__crumb mono">Lumen 3D Spatial Studio</p>
        <h1 className="room3d-workstation__heading">Room Planner</h1>
        <p className="room3d-workstation__envelope mono" data-testid="studio-envelope">
          Room {room.widthCm} x {room.depthCm} x {room.heightCm} cm
        </p>
      </div>

      <WallSwitcher active={activeWall} counts={counts} onChange={onWall} />

      <div className="room3d-workstation__tools">
        <CameraLensSwitcher mode={cameraMode} onChange={onCameraMode} />
        <div className="room3d-workstation__snap">
          <Switch
            label="Grid Snap"
            hint={snapOn ? '5 cm' : '1 cm Free'}
            checked={snapOn}
            onChange={onSnap}
            testId="room-grid-snap"
          />
        </div>
        <button
          type="button"
          className="room3d-zen"
          aria-pressed={zen}
          aria-label="Zen / Maximize Viewport"
          title={zen ? 'Restore the docks' : 'Collapse the docks and maximize the viewport'}
          data-testid="toggle-zen-viewport"
          onClick={() => onZen(!zen)}
        >
          <ZenGlyph on={zen} />
          <span className="room3d-zen__label">{zen ? 'Docks' : 'Zen'}</span>
        </button>
      </div>
    </header>
  );
}
