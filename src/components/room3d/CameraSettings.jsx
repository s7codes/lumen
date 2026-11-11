import { useEffect, useId, useRef, useState } from 'react';
import { CAMERA_PITCH, CAMERA_YAW, CAMERA_ZOOM, sanitizeCamera } from '../../lib/room-3d.js';
import { FaderGlyph } from '../icons.jsx';
import { Switch } from '../studio/controls.jsx';

const SLIDERS = [
  { key: 'yaw', label: 'Yaw', range: CAMERA_YAW, step: 1, format: (value) => `${value.toFixed(1)} deg` },
  { key: 'pitch', label: 'Pitch', range: CAMERA_PITCH, step: 1, format: (value) => `${value.toFixed(1)} deg` },
  { key: 'zoom', label: 'Zoom', range: CAMERA_ZOOM, step: 0.05, format: (value) => `${value.toFixed(2)}x` },
];

function fillPercent(value, range) {
  return `${(((value - range.min) / (range.max - range.min)) * 100).toFixed(1)}%`;
}

/**
 * Fine camera control kept out of sight. Orbiting by drag covers most use;
 * the fader button opens exact yaw, pitch and zoom, the wireframe view and
 * the floor illuminance grid.
 * Closes on Escape, on a second press and on any pointer down outside it.
 */
export function CameraSettings({ camera, view, wireframe, floorLux, onCamera, onWireframe, onFloorLux }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const toggleRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    toggleRef.current?.focus();
  };

  const setAxis = (key, raw) => {
    const value = Number(raw);
    if (Number.isFinite(value)) onCamera(sanitizeCamera({ ...camera, [key]: value }));
  };

  return (
    <div ref={rootRef} className="camera-settings" data-open={open || undefined} onKeyDown={onKeyDown}>
      <button
        ref={toggleRef}
        type="button"
        className="camera-settings__toggle"
        aria-label="Camera settings"
        aria-expanded={open}
        aria-controls={panelId}
        title="Camera settings"
        data-testid="camera-settings-toggle"
        onClick={() => setOpen((value) => !value)}
      >
        <FaderGlyph />
      </button>

      <div
        id={panelId}
        className="camera-settings__panel"
        role="group"
        aria-label="Camera"
        data-testid="camera-settings"
        inert={!open}
      >
        <p className="camera-settings__readout mono" data-testid="camera-readout">
          Yaw {view.yaw.toFixed(1)} / Pitch {view.pitch.toFixed(1)} / Zoom {view.zoom.toFixed(2)}x
        </p>

        {SLIDERS.map(({ key, label, range, step, format }) => {
          const id = `${panelId}-${key}`;
          return (
            <div key={key} className="camera-settings__row">
              <label className="camera-settings__label" htmlFor={id}>
                {label}
              </label>
              <output className="camera-settings__value mono" htmlFor={id}>
                {format(camera[key])}
              </output>
              <input
                id={id}
                className="hud-slider"
                type="range"
                min={range.min}
                max={range.max}
                step={step}
                value={camera[key]}
                aria-valuetext={format(camera[key])}
                data-testid={`camera-slider-${key}`}
                style={{ '--fill': fillPercent(camera[key], range) }}
                onChange={(event) => setAxis(key, event.target.value)}
              />
            </div>
          );
        })}

        <Switch
          label="Wireframe"
          hint={wireframe ? 'X-ray' : 'Solid'}
          checked={wireframe}
          onChange={onWireframe}
          testId="camera-wireframe"
        />
        <Switch
          label="Floor Lux Grid"
          hint={floorLux ? 'Point field' : 'Off'}
          checked={floorLux}
          onChange={onFloorLux}
          testId="toggle-floor-lux-grid"
        />
      </div>
    </div>
  );
}
