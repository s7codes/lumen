import { formatInt } from '../lib/format.js';
import { formatEnvironmentalPhysics } from '../lib/room-physics.js';

// Bar heights share one fixed scale so a change reads as a change, not a re-normalisation.
const SPECTRUM_CEILING_SEC = 2.5;

function OctaveSpectrum({ bands }) {
  return (
    <span className="octave" data-testid="acoustic-octave-spectrum" role="list" aria-label="Octave band RT60, 125 Hz to 4 kHz">
      {bands.map(({ hz, label, rt60 }) => (
        <span
          key={hz}
          className="octave__band"
          role="listitem"
          aria-label={`${label} ${rt60.toFixed(2)} s`}
          data-testid="octave-band"
          data-band={hz}
          data-rt60={rt60.toFixed(2)}
        >
          <span className="octave__value mono">{rt60.toFixed(2)}</span>
          <span className="octave__track">
            <span className="octave__bar" style={{ '--fill': Math.min(1, rt60 / SPECTRUM_CEILING_SEC).toFixed(3) }} />
          </span>
          <span className="octave__label mono">{label}</span>
        </span>
      ))}
    </span>
  );
}

/** Illuminance grade, Sabine RT60 and STI; the octave spectrum and derivation appear in Technical mode only. */
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
      data-sti={physics.stiScore.toFixed(2)}
    >
      <dt>Acoustics &amp; Illuminance</dt>
      <dd data-tone={physics.gradeId}>
        <span className="physics__line" data-testid="physics-illuminance">
          {lines.illuminance}
        </span>
        <span className="physics__line" data-testid="physics-rt60">
          {lines.rt60}
        </span>
        <span className="physics__line" data-testid="acoustic-sti" data-grade={physics.stiGradeId}>
          {lines.sti}
        </span>
        <span className="studio-summary__sub" data-testid="physics-damping" data-damped={physics.acousticDeltaSec < 0}>
          {lines.damping}
        </span>
        <span className="physics__spectrum">
          <OctaveSpectrum bands={lines.octave} />
        </span>
        <span className="studio-summary__sub physics__detail" data-testid="physics-detail">
          {lines.detail}
        </span>
      </dd>
    </div>
  );
}
