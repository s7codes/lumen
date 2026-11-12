import { useState } from 'react';
import { activePreset, CAMERA_PRESETS, CAMERA_ZOOM, DEFAULT_CAMERA, sameCamera } from '../../lib/room-3d.js';
import { ResetGlyph } from '../icons.jsx';
import { LightingSceneBar } from '../LightingSceneBar.jsx';

const ZOOM_STEP = 0.1;

/**
 * Floating HUD over the room viewport in clean clusters: view presets and
 * zoom on the first row (orbit lens only, the other lenses frame themselves); edit (undo, redo, clear the active wall) and DALI-2
 * scene recall on the second; a transient status line along the bottom edge.
 * Rendered as siblings inside .room3d-hud so the viewport can lay them out.
 */
export function RoomToolbar({
  camera,
  cameraMode = 'orbit',
  notice,
  onCamera,
  activeScene = null,
  sceneDisabled = false,
  canUndo = false,
  canRedo = false,
  wallLabel = 'North Wall',
  wallCount = 0,
  onApplyScene,
  onUndo,
  onRedo,
  onClearWall,
}) {
  const [armed, setArmed] = useState(false);
  const preset = activePreset(camera);
  const atDefault = sameCamera(camera, DEFAULT_CAMERA);
  const zoomBy = (delta) => onCamera({ ...camera, zoom: camera.zoom + delta });

  const orbit = cameraMode === 'orbit';

  return (
    <>
      {orbit && (
        <div className="studio-toolbar__group room3d-hud__pill room3d-hud__presets" role="group" aria-label="Camera presets">
          <span className="studio-toolbar__caption" aria-hidden="true">
            View
          </span>
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
            className="tool-button room3d-hud__icon"
            data-testid="camera-reset"
            aria-label="Reset Camera"
            title="Reset camera"
            disabled={atDefault}
            onClick={() => onCamera(DEFAULT_CAMERA)}
          >
            <ResetGlyph />
          </button>
        </div>
      )}

      {orbit && (
        <div className="studio-toolbar__group room3d-hud__pill room3d-zoom" role="group" aria-label="Zoom">
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
      )}

      <div className="room3d-hud__row">
        <div className="studio-toolbar__group room3d-hud__pill" role="group" aria-label="History and edit">
          <span className="studio-toolbar__caption" aria-hidden="true">
            Edit
          </span>
          <button
            type="button"
            className="tool-button"
            data-testid="room-undo"
            disabled={!canUndo}
            aria-keyshortcuts="Control+Z"
            onClick={onUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="room-redo"
            disabled={!canRedo}
            aria-keyshortcuts="Control+Y"
            onClick={onRedo}
          >
            Redo
          </button>
          <button
            type="button"
            className="tool-button tool-button--danger"
            data-testid="room-clear-wall"
            data-armed={armed || undefined}
            disabled={wallCount === 0}
            title={`Take every module off the ${wallLabel}`}
            onBlur={() => setArmed(false)}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              onClearWall();
            }}
          >
            {armed ? `Confirm: clear ${wallCount}` : 'Clear Wall'}
          </button>
        </div>
        <LightingSceneBar
          className="room3d-hud__pill"
          active={activeScene}
          disabled={sceneDisabled}
          onApply={onApplyScene}
        />
      </div>

      <p className="studio-toolbar__notice room3d-hud__notice" role="status" aria-live="polite" data-tone={notice.tone}>
        <span key={notice.serial} className="notice-transient" data-testid="room-notice">
          {notice.text}
        </span>
      </p>
    </>
  );
}
