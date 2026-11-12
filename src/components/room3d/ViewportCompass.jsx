import { useCallback } from 'react';
import { WALL_LABELS } from '../../lib/room-3d.js';
import { compassReadout, WALL_LOOK_HEADING } from '../../lib/room-walkthrough.js';

const NODES = Object.freeze([
  { wall: 'north', label: 'N' },
  { wall: 'east', label: 'E' },
  { wall: 'south', label: 'S' },
  { wall: 'west', label: 'W' },
]);

const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);

/**
 * Orientation widget in the stage corner. The dial turns with the view so
 * the top always points where the camera looks; N / E / S / W face that
 * wall, ISO drops to the corner orbit and EYE stands inside at 165 cm. The
 * canvas writes the live bearing straight to --bearing every frame.
 */
export function ViewportCompass({ api, bearing, cameraMode, onWall, onIso, onEye }) {
  const ref = useCallback(
    (el) => {
      api.hud.compass = el;
    },
    [api],
  );
  const azimuth = Math.round(bearing);

  return (
    <div
      ref={ref}
      className="room3d-compass"
      role="group"
      aria-label="View orientation"
      data-testid="viewport-compass"
      data-azimuth={azimuth}
      data-camera-mode={cameraMode}
      style={{ '--bearing': `${bearing}deg` }}
    >
      <div className="room3d-compass__dial">
        <svg className="room3d-compass__ring" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
          <circle r="38" fill="none" stroke="currentColor" strokeOpacity="0.22" />
          {TICKS.map((deg) => (
            <line
              key={deg}
              x1="0"
              y1="-38"
              x2="0"
              y2={deg % 90 === 0 ? -31 : -35}
              stroke="currentColor"
              strokeOpacity={deg % 90 === 0 ? 0.7 : 0.28}
              transform={`rotate(${deg})`}
            />
          ))}
        </svg>
        <svg className="room3d-compass__cone" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
          <path d="M0 0 L-9 -27 L9 -27 Z" fill="currentColor" fillOpacity="0.16" />
          <line x1="0" y1="0" x2="0" y2="-27" stroke="currentColor" strokeOpacity="0.7" />
        </svg>
        {NODES.map((node) => (
          <button
            key={node.wall}
            type="button"
            className="room3d-compass__node"
            style={{ '--at': `${WALL_LOOK_HEADING[node.wall]}deg` }}
            data-node={node.wall}
            data-testid={`compass-${node.wall}`}
            aria-label={`Face the ${WALL_LABELS[node.wall]}`}
            title={`Face the ${WALL_LABELS[node.wall]}`}
            onClick={() => onWall(node.wall)}
          >
            <span>{node.label}</span>
          </button>
        ))}
      </div>
      <p className="room3d-compass__readout mono" data-part="readout">
        {compassReadout(bearing)}
      </p>
      <div className="room3d-compass__quick">
        <button
          type="button"
          className="room3d-compass__key mono"
          data-testid="compass-iso"
          title="Corner iso orbit"
          onClick={onIso}
        >
          ISO
        </button>
        <button
          type="button"
          className="room3d-compass__key mono"
          data-testid="compass-eye"
          aria-pressed={cameraMode === 'inside'}
          title="Stand inside the room at 165 cm"
          onClick={onEye}
        >
          EYE
        </button>
      </div>
    </div>
  );
}
