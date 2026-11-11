import { useLayoutEffect, useMemo, useRef } from 'react';
import { formatInt } from '../../lib/format.js';
import { fieldImage, isoLuxContours, LUX_RAMP, LUX_SCALE, luxToRamp } from '../../lib/illuminance-field.js';
import { SLOPE_CM } from '../../lib/wall-studio.js';

const LEVEL_TONE = { 100: 'bronze', 250: 'amber', 500: 'alabaster' };

function rgb(c) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const RAMP_CSS = `linear-gradient(90deg, ${LUX_RAMP.map((stop) => `${rgb(stop.rgb)} ${(stop.t * 100).toFixed(0)}%`).join(', ')})`;

/** Visible wall outline in percent, with the attic slope cut off the top right. */
function wallClip(wall) {
  if (!wall.slope) return undefined;
  const sx = ((wall.widthCm - SLOPE_CM) / wall.widthCm) * 100;
  const sy = (SLOPE_CM / wall.heightCm) * 100;
  return `polygon(0 0, ${sx.toFixed(3)}% 0, 100% ${sy.toFixed(3)}%, 100% 100%, 0 100%)`;
}

/**
 * False-colour illuminance across the wall elevation with 100 / 250 / 500 lx
 * iso-lux contours. The probe readout and reticle are written straight to the
 * DOM by the stage's pointer handler, never through React state.
 */
export function LuxHeatmap({ field, wall, ppcm, probeRef, reticleRef }) {
  const canvasRef = useRef(null);
  const contours = useMemo(() => isoLuxContours(field), [field]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const image = fieldImage(field);
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [field]);

  const H = wall.heightCm;
  const { hotspot } = field;
  const dark = field.directPeakLux === 0;

  return (
    <div
      className="lux-map"
      data-testid="lux-heatmap-overlay"
      data-peak-lux={field.peakLux}
      data-avg-lux={field.avgLux}
      data-min-lux={field.minLux}
      data-uniformity={field.uniformityRatio.toFixed(2)}
      data-ambient-lux={field.ambientLux}
      data-direct-peak-lux={field.directPeakLux}
      data-cols={field.cols}
      data-rows={field.rows}
      data-cells={field.cells}
      data-hotspot-x={hotspot?.xCm}
      data-hotspot-y={hotspot?.yCm}
      data-slope={wall.slope || undefined}
      data-contours={contours.map((c) => `${c.lux}:${c.segments.length}`).join(' ')}
    >
      <div className="lux-map__field" style={{ clipPath: wallClip(wall) }} aria-hidden="true">
        <canvas ref={canvasRef} className="lux-map__canvas" />
        <svg className="lux-map__contours" viewBox={`0 0 ${wall.widthCm} ${H}`} preserveAspectRatio="none" focusable="false">
          {contours.map((contour) => (
            <g key={contour.lux} className="lux-map__iso" data-tone={LEVEL_TONE[contour.lux]} data-lux={contour.lux}>
              {contour.segments.map((s, i) => (
                <line key={i} x1={s[0]} y1={H - s[1]} x2={s[2]} y2={H - s[3]} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          ))}
        </svg>
      </div>

      {hotspot && (
        <span
          className="lux-map__hotspot"
          data-testid="lux-hotspot"
          aria-hidden="true"
          style={{ left: hotspot.xCm * ppcm, bottom: hotspot.yCm * ppcm }}
        />
      )}
      <span ref={reticleRef} className="lux-map__reticle" data-on="false" aria-hidden="true" />

      <div className="lux-map__panel mono" role="group" aria-label="Iso-lux statistics">
        <p className="lux-map__badges">
          <span data-testid="lux-badge-peak">Peak {formatInt(field.peakLux)} lx</span>
          <span data-testid="lux-badge-avg">Avg {formatInt(field.avgLux)} lx</span>
          <span data-testid="lux-badge-uniformity">Uniformity {field.uniformityRatio.toFixed(2)}</span>
        </p>
        <p className="lux-map__probe" ref={probeRef} data-testid="lux-probe-readout" data-dark={dark || undefined} />
        <div className="lux-map__legend" aria-hidden="true">
          <span className="lux-map__ramp" style={{ backgroundImage: RAMP_CSS }}>
            {[100, 250, 500].map((lux) => (
              <span key={lux} className="lux-map__tick" style={{ left: `${(luxToRamp(lux) * 100).toFixed(1)}%` }}>
                {lux}
              </span>
            ))}
          </span>
          <span className="lux-map__scale">
            {LUX_SCALE.min}-{formatInt(LUX_SCALE.max)} lx log
          </span>
        </div>
      </div>
    </div>
  );
}
