import { activePreset, CAMERA_PRESETS, CAMERA_ZOOM, DEFAULT_CAMERA, sameCamera } from '../../lib/room-3d.js';

const ZOOM_STEP = 0.1;

export function RoomToolbar({ camera, notice, onCamera }) {
  const preset = activePreset(camera);
  const atDefault = sameCamera(camera, DEFAULT_CAMERA);
  const zoomBy = (delta) => onCamera({ ...camera, zoom: camera.zoom + delta });

  return (
    <div className="studio-toolbar room3d-toolbar">
      <div className="studio-toolbar__group" role="group" aria-label="Camera presets">
        {CAMERA_PRESETS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="tool-button"
            aria-pressed={preset === entry.id}
            data-testid={`camera-preset-${entry.id}`}
            onClick={() => onCamera(entry.camera)}
          >
            {entry.label}
          </button>
        ))}
        <button
          type="button"
          className="tool-button"
          data-testid="camera-reset"
          disabled={atDefault}
          onClick={() => onCamera(DEFAULT_CAMERA)}
        >
          Reset Camera
        </button>
      </div>

      <div className="studio-toolbar__group room3d-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="tool-button room3d-zoom__step"
          aria-label="Zoom out"
          disabled={camera.zoom <= CAMERA_ZOOM.min}
          onClick={() => zoomBy(-ZOOM_STEP)}
        >
          -
        </button>
        <output className="room3d-zoom__value mono" data-testid="camera-zoom" aria-live="off">
          {camera.zoom.toFixed(2)}x
        </output>
        <button
          type="button"
          className="tool-button room3d-zoom__step"
          aria-label="Zoom in"
          disabled={camera.zoom >= CAMERA_ZOOM.max}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          +
        </button>
      </div>

      <p className="studio-toolbar__notice mono" role="status" aria-live="polite" data-tone={notice.tone}>
        <span key={notice.serial} data-testid="room-notice">
          {notice.text}
        </span>
      </p>
    </div>
  );
}
