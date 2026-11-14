import { useState } from 'react';
import { FINISHES, FINISH_IDS, getFinish, getProduct } from '../data/products.js';
import { CCT_PRESETS, rgbTriplet } from '../lib/photometry.js';
import { clampNumber, isOneOf } from '../security/sanitize.js';

const SOURCE = getProduct('floating-shelf-110');
const SLAT_COUNT = 14;
const SLATS = Array.from({ length: SLAT_COUNT }, (_, i) => i);
const DEFAULT_LEVEL = 72;

/**
 * 24V constant-voltage strips dim by PWM: duty cycle scales power and flux
 * together, so load and output are both linear in the dimmer level and
 * efficacy only moves with the colour temperature of the LED binning.
 */
function computeTelemetry(level, preset, finish) {
  const duty = level / 100;
  const loadW = SOURCE.watts * duty;
  const outputLm = SOURCE.lumens * preset.relativeEfficacy * duty;
  const efficacy = duty > 0 ? (SOURCE.lumens * preset.relativeEfficacy) / SOURCE.watts : null;
  return {
    load: `${loadW.toFixed(1)} W`,
    output: `${Math.round(outputLm)} lm`,
    efficacy: efficacy === null ? '--' : `${efficacy.toFixed(1)} lm/W`,
    cct: `${preset.kelvin} K`,
    lrv: `${Math.round(finish.lrv * 100)}%`,
    reflected: `${Math.round(outputLm * finish.lrv)} lm`,
  };
}

const READOUT = [
  ['load', 'Load'],
  ['output', 'Output'],
  ['efficacy', 'Efficacy'],
  ['cct', 'CCT'],
  ['lrv', 'Surface LRV'],
  ['reflected', 'Reflected'],
];

export function SurfaceLab() {
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [kelvin, setKelvin] = useState(2700);
  const [material, setMaterial] = useState('walnut');

  const preset = CCT_PRESETS.find((p) => p.kelvin === kelvin) ?? CCT_PRESETS[1];
  const finish = getFinish(material);
  const telemetry = computeTelemetry(level, preset, finish);

  const benchStyle = {
    '--lab-level': (level / 100).toFixed(3),
    '--lab-light': rgbTriplet(kelvin),
    '--slat-base': finish.hex,
    '--slat-hi': finish.highlight,
    '--slat-lo': finish.shade,
    '--slat-spec': finish.specular,
    '--slat-lrv': finish.lrv,
  };

  return (
    <div className="lab__rig">
      <div
        className="lab-bench optical"
        data-testid="lab-bench"
        data-kelvin={kelvin}
        data-material={material}
        style={benchStyle}
        role="img"
        aria-label={`${finish.name} slats lit at ${level}% and ${kelvin}K`}
      >
        <div className="lab-bench__slats">
          {SLATS.map((i) => (
            <span key={i} className="lab-bench__slat" />
          ))}
        </div>
        <div className="lab-bench__shade" />
        <div className="lab-bench__falloff" />
        <div className="lab-bench__source">
          <span className="lab-bench__emitter" />
        </div>
        <p className="lab-bench__tag mono">
          CH 01 / {kelvin}K / {String(level).padStart(3, '0')}%
        </p>
        <p className="lab-bench__tag lab-bench__tag--end mono">
          {finish.label} / LRV {telemetry.lrv}
        </p>
      </div>

      <div className="lab-panel" data-testid="lab-panel">
        <div className="lab-control">
          <div className="lab-control__head">
            <label htmlFor="lab-dimmer" className="lab-control__label">
              Dimmer
            </label>
            <span className="lab-control__value mono" data-testid="lab-level">
              {level}%
            </span>
          </div>
          <input
            id="lab-dimmer"
            className="dimmer"
            type="range"
            min="0"
            max="100"
            step="1"
            value={level}
            aria-valuetext={`${level}% intensity`}
            style={{ '--fill': `${level}%` }}
            onChange={(event) => setLevel(Math.round(clampNumber(event.target.value, 0, 100, DEFAULT_LEVEL)))}
          />
          <div className="dimmer__scale mono" aria-hidden="true">
            <span>0</span>
            <span>25</span>
            <span>50</span>
            <span>75</span>
            <span>100</span>
          </div>
        </div>

        <fieldset className="lab-control">
          <legend className="lab-control__label">Colour temperature</legend>
          <div className="segmented">
            {CCT_PRESETS.map((option) => (
              <label key={option.kelvin} className="segmented__option">
                <input
                  className="segmented__input"
                  type="radio"
                  name="lab-cct"
                  value={option.kelvin}
                  checked={option.kelvin === kelvin}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (CCT_PRESETS.some((p) => p.kelvin === next)) setKelvin(next);
                  }}
                />
                <span className="segmented__face" style={{ '--chip': rgbTriplet(option.kelvin) }}>
                  <span className="segmented__value mono">{option.kelvin}K</span>{' '}
                  <span className="segmented__label">{option.label}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="lab-control">
          <legend className="lab-control__label">Surface</legend>
          <div className="slat-picker">
            {FINISHES.map((option) => (
              <label
                key={option.id}
                className="slat-picker__option"
                style={{ '--swatch': option.hex, '--swatch-hi': option.highlight, '--swatch-lo': option.shade }}
              >
                <input
                  className="slat-picker__input"
                  type="radio"
                  name="lab-surface"
                  value={option.id}
                  checked={option.id === material}
                  onChange={(event) => {
                    if (isOneOf(event.target.value, FINISH_IDS)) setMaterial(event.target.value);
                  }}
                />
                <span className="slat-picker__sample" aria-hidden="true" />
                <span className="slat-picker__name">{option.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <dl className="lab-telemetry" data-testid="lab-telemetry">
          {READOUT.map(([key, term]) => (
            <div key={key} className="lab-telemetry__cell">
              <dt>{term}</dt>
              <dd data-testid={`lab-${key}`}>{telemetry[key]}</dd>
            </div>
          ))}
        </dl>
        <p className="lab-panel__note mono">
          Source {SOURCE.sku} / {SOURCE.watts} W / {SOURCE.lumens} lm at 2700K / PWM on 24V DC
        </p>
      </div>
    </div>
  );
}
