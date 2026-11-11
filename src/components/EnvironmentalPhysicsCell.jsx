import { formatInt } from '../lib/format.js';
import { formatEnvironmentalPhysics } from '../lib/room-physics.js';

/** Illuminance grade and Sabine RT60; the derivation line appears in Technical mode only. */
export function EnvironmentalPhysicsCell({ physics }) {
  const lines = formatEnvironmentalPhysics(physics, formatInt);
  return (
    <div
      className="studio-summary__cell studio-summary__cell--physics"
      data-testid="environmental-physics"
      data-lux={physics.avgFloorLux}
      data-grade={physics.gradeId}
      data-rt60={physics.rt60Sec.toFixed(2)}
      data-delta={physics.acousticDeltaSec.toFixed(2)}
    >
      <dt>Acoustics &amp; Illuminance</dt>
      <dd data-tone={physics.gradeId}>
        <span className="physics__line" data-testid="physics-illuminance">
          {lines.illuminance}
        </span>
        <span className="physics__line" data-testid="physics-rt60">
          {lines.rt60}
        </span>
        <span className="studio-summary__sub" data-testid="physics-damping" data-damped={physics.acousticDeltaSec < 0}>
          {lines.damping}
        </span>
        <span className="studio-summary__sub physics__detail" data-testid="physics-detail">
          {lines.detail}
        </span>
      </dd>
    </div>
  );
}
