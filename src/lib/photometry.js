export const CCT_PRESETS = [
  { kelvin: 2400, label: 'Candle', relativeEfficacy: 0.88 },
  { kelvin: 2700, label: 'Warm Tungsten', relativeEfficacy: 1 },
  { kelvin: 3500, label: 'Neutral Studio', relativeEfficacy: 1.08 },
];

const DEFAULT_KELVIN = 2700;

function channel(value) {
  return Math.round(Math.min(255, Math.max(0, value)));
}

// Tanner Helland's curve fit of blackbody colour to sRGB, within a few percent
// from 1000K to 40000K. Inputs are in hundreds of kelvin; the 66 split is
// where red saturates and blue begins to.
export function kelvinToRgb(kelvin) {
  const k = Number.isFinite(kelvin) && kelvin > 0 ? kelvin : DEFAULT_KELVIN;
  const t = Math.min(400, Math.max(10, k / 100));

  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  let b = 255;
  if (t < 66) b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [channel(r), channel(g), channel(b)];
}

export function rgbTriplet(kelvin) {
  return kelvinToRgb(kelvin).join(', ');
}
