import { useEffect, useMemo, useRef, useState } from 'react';
import {
  echoReadout,
  playAcousticAudition,
  stopAcousticAudition,
  synthesizeAcousticProfile,
} from '../lib/acoustic-audition.js';
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

function PlayGlyph() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.5 2.2v7.6L9.6 6 3.5 2.2Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Room echo test: a key that plays the room's decay, the decay curve, and a
 * plain comparison against the same room bare. A faint dashed marker on the
 * curve shows where the bare room's echo would end, beside the amber RT60
 * hairline, so the panels' effect is visible at a glance. A take remounts the
 * curve (keyed by its count), so the CSS sweep restarts on every press; React
 * only re-renders at the start and end of a take.
 */
function AcousticAudition({ physics }) {
  const profile = useMemo(() => synthesizeAcousticProfile(physics), [physics]);
  const [take, setTake] = useState({ count: 0, playing: false, audio: null });
  const timer = useRef(0);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      stopAcousticAudition();
    },
    [],
  );

  const audition = () => {
    const result = playAcousticAudition(physics);
    const holdMs = Math.max(result.durationSec, profile.windowSec) * 1000;
    window.clearTimeout(timer.current);
    setTake((current) => ({ count: current.count + 1, playing: true, audio: result.played ? 'web-audio' : 'silent' }));
    timer.current = window.setTimeout(() => setTake((current) => ({ ...current, playing: false })), holdMs);
  };

  const last = profile.envelope.length - 1;
  const echo = echoReadout(profile);
  const at = (sec) => Math.min(0.995, sec / profile.windowSec).toFixed(3);
  return (
    <span className="audition" data-testid="acoustic-audition">
      <button
        type="button"
        className="audition__key"
        data-testid="audition-room-acoustics"
        data-playing={take.playing || undefined}
        aria-label="Test Room Echo (Audition RT60)"
        title={`Play a soft clap and hear the room's echo: RT60 ${profile.rt60Sec.toFixed(2)} s at 500 Hz`}
        onClick={audition}
      >
        <PlayGlyph />
        Test Room Echo
      </button>
      <span
        key={take.count}
        className="audition__wave"
        data-testid="acoustic-decay-wave"
        data-rt60={profile.rt60Sec.toFixed(2)}
        data-damping-pct={profile.dampingPct}
        data-duration={profile.durationSec.toFixed(2)}
        data-clarity-db={profile.clarityDb.toFixed(1)}
        data-baseline-rt60={profile.baselineRt60Sec.toFixed(2)}
        data-state={take.playing ? 'playing' : 'idle'}
        data-takes={take.count}
        data-audio={take.audio ?? undefined}
        style={{
          '--window-sec': `${profile.windowSec}s`,
          '--rt60-at': Math.min(1, profile.rt60Sec / profile.windowSec).toFixed(3),
          '--baseline-at': at(profile.baselineRt60Sec),
        }}
        aria-hidden="true"
      >
        {profile.envelope.map((level, i) => (
          <span
            key={i}
            className="audition__bar"
            style={{ '--level': level.toFixed(3), '--at': (i / last).toFixed(3) }}
          />
        ))}
        {echo.damped && <span className="audition__baseline" data-testid="acoustic-baseline-mark" />}
        <span className="audition__mark" />
        {take.playing && <span className="audition__playhead" />}
      </span>
      <span
        className="audition__readout"
        data-testid="acoustic-echo-readout"
        data-damped={echo.damped}
        data-rt60={profile.rt60Sec.toFixed(2)}
        data-baseline-rt60={profile.baselineRt60Sec.toFixed(2)}
        data-damping-pct={profile.dampingPct}
      >
        {echo.text}
      </span>
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
        <AcousticAudition physics={physics} />
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
