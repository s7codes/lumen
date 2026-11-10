import { useId, useMemo, useState } from 'react';
import {
  BUS_LOADS_W,
  BUS_RATED_A,
  BUS_RATED_W,
  BUS_VOLTAGE,
  busCurrent,
  CONDUCTOR_MM2,
  DROP_LIMIT,
  maxRunM,
  voltageDrop,
} from '../lib/electrical.js';
import { formatInt } from '../lib/format.js';
import { beamProfile, candelaAt, luxAt } from '../lib/photometry.js';
import { clampNumber } from '../security/sanitize.js';

const LUX_DISTANCES = [
  { m: 0.5, key: '0.5' },
  { m: 1, key: '1.0' },
  { m: 2, key: '2.0' },
];

const r2 = (value) => Math.round(value * 100) / 100;
const toRad = (deg) => (deg * Math.PI) / 180;

function niceCeiling(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * magnitude >= value);
  return step * magnitude;
}

/* Polar candela distribution */

const POLAR = { size: 260, cx: 130, cy: 124, r: 100 };

// Nadir points down the page, so a ray at `deg` from nadir lands at
// (cx + r sin deg, cy + r cos deg).
function polarPoint(deg, radius) {
  return [POLAR.cx + radius * Math.sin(toRad(deg)), POLAR.cy + radius * Math.cos(toRad(deg))];
}

function PolarDiagram({ profile, probeDeg, titleId }) {
  const maxCd = niceCeiling(profile.peakCd);
  const rings = [0.25, 0.5, 0.75, 1];
  const spokes = Array.from({ length: 12 }, (_, i) => i * 30 - 180);

  const curve = useMemo(() => {
    const points = [];
    for (let deg = -180; deg <= 180; deg += 2) {
      const [x, y] = polarPoint(deg, (candelaAt(profile, deg) / maxCd) * POLAR.r);
      points.push(`${r2(x)},${r2(y)}`);
    }
    return points.join(' ');
  }, [profile, maxCd]);

  const probeCd = candelaAt(profile, probeDeg);
  const [px, py] = polarPoint(probeDeg, POLAR.r);
  const [hx, hy] = polarPoint(probeDeg, (probeCd / maxCd) * POLAR.r);

  return (
    <svg
      className="polar"
      viewBox={`0 0 ${POLAR.size} ${POLAR.size}`}
      role="img"
      aria-labelledby={titleId}
      data-testid="photometric-polar"
    >
      <title id={titleId}>
        {`Polar intensity distribution, peak ${Math.round(profile.peakCd)} cd, beam ${Math.round(profile.beamDeg)} deg.`}
      </title>
      <g className="polar__grid">
        {rings.map((ring) => (
          <circle key={ring} cx={POLAR.cx} cy={POLAR.cy} r={r2(ring * POLAR.r)} />
        ))}
        {spokes.map((deg) => {
          const [x, y] = polarPoint(deg, POLAR.r);
          return <line key={deg} x1={POLAR.cx} y1={POLAR.cy} x2={r2(x)} y2={r2(y)} />;
        })}
      </g>
      <g className="polar__labels">
        {rings.map((ring) => (
          <text key={ring} x={r2(POLAR.cx + ring * POLAR.r - 1.5)} y={POLAR.cy - 3} textAnchor="end">
            {formatInt(ring * maxCd)}
          </text>
        ))}
        {[0, 90, 180, -90].map((deg) => {
          const [x, y] = polarPoint(deg, POLAR.r + 9);
          return (
            <text key={deg} x={r2(x)} y={r2(y + 2.5)} textAnchor="middle">
              {Math.abs(deg)}
            </text>
          );
        })}
      </g>
      <polygon className="polar__curve" points={curve} data-testid="polar-curve" />
      <line className="polar__probe" x1={POLAR.cx} y1={POLAR.cy} x2={r2(px)} y2={r2(py)} />
      <circle className="polar__probe-hit" cx={r2(hx)} cy={r2(hy)} r="2.6" />
      <text className="polar__unit" x={8} y={14}>
        cd
      </text>
      <text className="polar__unit" x={POLAR.size - 8} y={14} textAnchor="end">
        C0-C180
      </text>
    </svg>
  );
}

function LuminousPanel({ product }) {
  const profile = useMemo(() => beamProfile(product), [product]);
  const [probe, setProbe] = useState(0);
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const probeCd = candelaAt(profile, probe);

  return (
    <div className="photometric" data-testid="photometric-panel" data-kind="polar">
      <div className="photometric__figure">
        <PolarDiagram profile={profile} probeDeg={probe} titleId={`${uid}-polar`} />
        <label className="photometric__slider">
          <span className="field__label">Probe angle from nadir</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={5}
            value={probe}
            data-testid="probe-angle"
            onChange={(event) => setProbe(clampNumber(event.target.value, -180, 180, 0))}
          />
          <output className="mono" data-testid="probe-readout">
            {probe} deg / {formatInt(probeCd)} cd / {formatInt(probeCd)} lx at 1 m
          </output>
        </label>
      </div>
      <div className="photometric__data">
        <dl className="spec-table">
          <div className="spec-table__row">
            <dt>Flux</dt>
            <dd>{formatInt(profile.lumens)} lm</dd>
          </div>
          <div className="spec-table__row">
            <dt>Peak intensity</dt>
            <dd data-testid="peak-cd">{formatInt(profile.peakCd)} cd</dd>
          </div>
          <div className="spec-table__row">
            <dt>Beam (FWHM)</dt>
            <dd>{Math.round(profile.beamDeg)} deg</dd>
          </div>
          <div className="spec-table__row">
            <dt>Optic</dt>
            <dd>{profile.optic}</dd>
          </div>
          <div className="spec-table__row">
            <dt>CCT / CRI</dt>
            <dd>
              {product.kelvin} K / {product.cri}+
            </dd>
          </div>
        </dl>
        <table className="lux-table">
          <caption className="index-label">On-axis illuminance</caption>
          <thead>
            <tr>
              <th scope="col">Distance</th>
              <th scope="col">Illuminance</th>
            </tr>
          </thead>
          <tbody>
            {LUX_DISTANCES.map(({ m, key }) => (
              <tr key={key}>
                <th scope="row">Lux at {key}m</th>
                <td className="mono" data-testid={`lux-${key}`}>
                  {formatInt(luxAt(profile, m))} lx
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="photometric__note mono">
          Inverse-square law, point-source approximation. I(t) = I0 cos^m(t), m = {profile.m.toFixed(1)}.
        </p>
      </div>
    </div>
  );
}

/* 24V bus: voltage drop and current capacity across run length */

const BUS_CHART = { w: 300, h: 190, x0: 34, x1: 288, y0: 16, y1: 160, maxM: 10, maxPct: 4 };

function busX(m) {
  return BUS_CHART.x0 + (m / BUS_CHART.maxM) * (BUS_CHART.x1 - BUS_CHART.x0);
}

function busY(pct) {
  return BUS_CHART.y1 - (pct / BUS_CHART.maxPct) * (BUS_CHART.y1 - BUS_CHART.y0);
}

function BusChart({ loadW, lengthM, titleId }) {
  const limitPct = DROP_LIMIT * 100;
  const end = voltageDrop(loadW, lengthM);
  const markerPct = Math.min(BUS_CHART.maxPct, end.ratio * 100);

  return (
    <svg
      className="bus-chart"
      viewBox={`0 0 ${BUS_CHART.w} ${BUS_CHART.h}`}
      role="img"
      aria-labelledby={titleId}
      data-testid="bus-drop-curve"
    >
      <title id={titleId}>{`Voltage drop against run length for 60, 100 and 150 W on the 24V bus.`}</title>
      <g className="bus-chart__grid">
        {[0, 1, 2, 3, 4].map((pct) => (
          <line key={pct} x1={BUS_CHART.x0} y1={r2(busY(pct))} x2={BUS_CHART.x1} y2={r2(busY(pct))} />
        ))}
        {[0, 2, 4, 6, 8, 10].map((m) => (
          <line key={m} x1={r2(busX(m))} y1={BUS_CHART.y0} x2={r2(busX(m))} y2={BUS_CHART.y1} />
        ))}
      </g>
      <g className="bus-chart__labels">
        {[0, 1, 2, 3, 4].map((pct) => (
          <text key={pct} x={BUS_CHART.x0 - 4} y={r2(busY(pct) + 2.5)} textAnchor="end">
            {pct}%
          </text>
        ))}
        {[0, 2, 4, 6, 8, 10].map((m) => (
          <text key={m} x={r2(busX(m))} y={BUS_CHART.y1 + 11} textAnchor="middle">
            {m} m
          </text>
        ))}
      </g>
      <line className="bus-chart__limit" x1={BUS_CHART.x0} y1={r2(busY(limitPct))} x2={BUS_CHART.x1} y2={r2(busY(limitPct))} />
      <text className="bus-chart__limit-text" x={BUS_CHART.x0 + 4} y={r2(busY(limitPct) - 3)}>
        3% limit
      </text>
      {BUS_LOADS_W.map((w) => {
        const run = Math.min(BUS_CHART.maxM, maxRunM(w, BUS_CHART.maxPct / 100));
        const pct = voltageDrop(w, run).ratio * 100;
        return (
          <g key={w} className="bus-chart__series" data-active={w === loadW || undefined}>
            <line x1={busX(0)} y1={busY(0)} x2={r2(busX(run))} y2={r2(busY(pct))} />
            <text x={r2(busX(run) - 2)} y={r2(busY(pct) - 3)} textAnchor="end">
              {w} W
            </text>
          </g>
        );
      })}
      <line className="bus-chart__marker" x1={r2(busX(lengthM))} y1={BUS_CHART.y0} x2={r2(busX(lengthM))} y2={BUS_CHART.y1} />
      <circle className="bus-chart__point" cx={r2(busX(lengthM))} cy={r2(busY(markerPct))} r="2.6" />
      <text className="bus-chart__axis" x={BUS_CHART.x1} y={BUS_CHART.h - 4} textAnchor="end">
        Run length, end-fed
      </text>
    </svg>
  );
}

function BusPanel() {
  const [loadW, setLoadW] = useState(BUS_RATED_W);
  const [lengthM, setLengthM] = useState(2);
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const drop = voltageDrop(loadW, lengthM);
  const amps = busCurrent(loadW);
  const run = maxRunM(loadW);

  return (
    <div className="photometric" data-testid="photometric-panel" data-kind="bus">
      <div className="photometric__figure">
        <BusChart loadW={loadW} lengthM={lengthM} titleId={`${uid}-bus`} />
        <div className="photometric__controls">
          <div className="segment-switch" role="group" aria-label="Bus load">
            {BUS_LOADS_W.map((w) => (
              <button
                key={w}
                type="button"
                className="segment-switch__option"
                aria-pressed={w === loadW}
                data-testid={`bus-load-${w}`}
                onClick={() => setLoadW(w)}
              >
                {w} W
              </button>
            ))}
          </div>
          <label className="photometric__slider">
            <span className="field__label">Run length</span>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={lengthM}
              data-testid="bus-length"
              onChange={(event) => setLengthM(clampNumber(event.target.value, 0.5, 10, 2))}
            />
            <output className="mono">{lengthM.toFixed(1)} m</output>
          </label>
        </div>
      </div>
      <div className="photometric__data">
        <dl className="spec-table">
          <div className="spec-table__row">
            <dt>Rated feed</dt>
            <dd>
              {BUS_VOLTAGE} V DC / {BUS_RATED_A.toFixed(2)} A / {BUS_RATED_W} W
            </dd>
          </div>
          <div className="spec-table__row">
            <dt>Conductors</dt>
            <dd>2x {CONDUCTOR_MM2} mm2 Cu</dd>
          </div>
          <div className="spec-table__row">
            <dt>Current at load</dt>
            <dd data-testid="bus-current">{amps.toFixed(2)} A</dd>
          </div>
          <div className="spec-table__row">
            <dt>Drop at {lengthM.toFixed(1)} m</dt>
            <dd data-testid="bus-drop">
              {drop.volts.toFixed(2)} V / {(drop.ratio * 100).toFixed(2)}%
            </dd>
          </div>
          <div className="spec-table__row">
            <dt>Voltage at end</dt>
            <dd data-testid="bus-end-voltage">{drop.endVolts.toFixed(2)} V</dd>
          </div>
          <div className="spec-table__row">
            <dt>Max run at 3%</dt>
            <dd data-testid="bus-max-run">{run.toFixed(1)} m</dd>
          </div>
        </dl>
        <p className="photometric__note mono">
          Worst case: full load lumped at the far end. A load spread along the track drops half as much.
        </p>
      </div>
    </div>
  );
}

export function PhotometricCurve({ product }) {
  return product.watts > 0 && product.lumens > 0 ? <LuminousPanel product={product} /> : <BusPanel />;
}
