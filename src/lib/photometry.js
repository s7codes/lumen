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

/*
 * Luminous intensity model. Each lobe follows I(t) = I0 * cos^m(t - axis)
 * within 90 deg of its axis, t measured from nadir. Integrating that lobe
 * over its hemisphere gives a flux of 2 * pi * I0 / (m + 1), so a lobe that
 * carries `flux` lumens peaks at I0 = flux * (m + 1) / (2 * pi).
 */
const BEAM_PROFILES = {
  shelf: { m: 2, lobes: [0], optic: 'Asymmetric wall wash, front lip' },
  cube: { m: 3, lobes: [0], optic: 'Interior downlight, top panel' },
  sideboard: { m: 2, lobes: [0], optic: 'Floor graze, underside' },
  lightbar: { m: 1, lobes: [0], optic: 'Opal diffuser, Lambertian' },
  column: { m: 1, lobes: [-90, 90], optic: 'Full-height opal slot, bilateral' },
  frame: { m: 1, lobes: [-90, 90], optic: 'Rear halo, wall plane' },
  pendant: { m: 2, lobes: [0], optic: 'Microprismatic downlight, UGR<19' },
  sconce: { m: 3, lobes: [0, 180], optic: 'Opal blade, up and down wash' },
};
const SPOT_HALF_ANGLE_DEG = 18;

const toRad = (deg) => (deg * Math.PI) / 180;

// A cos^m lobe falls to half its peak where cos^m(h) = 0.5.
function exponentForHalfAngle(halfDeg) {
  return Math.log(0.5) / Math.log(Math.cos(toRad(halfDeg)));
}

export function beamProfile(product) {
  if (!product || !(product.lumens > 0)) return null;
  const base =
    product.shape === 'spot'
      ? { m: exponentForHalfAngle(SPOT_HALF_ANGLE_DEG), lobes: [0], optic: '36 deg reflector, narrow flood' }
      : (BEAM_PROFILES[product.shape] ?? BEAM_PROFILES.lightbar);
  const flux = product.lumens / base.lobes.length;
  const peakCd = (flux * (base.m + 1)) / (2 * Math.PI);
  const beamDeg = 2 * (Math.acos(0.5 ** (1 / base.m)) * 180) / Math.PI;
  return { ...base, peakCd, beamDeg, lumens: product.lumens };
}

/** Intensity in cd toward `angleDeg` from nadir, summing every lobe. */
export function candelaAt(profile, angleDeg) {
  let total = 0;
  for (const axis of profile.lobes) {
    const delta = Math.abs((((angleDeg - axis) % 360) + 540) % 360 - 180);
    if (delta < 90) total += profile.peakCd * Math.cos(toRad(delta)) ** profile.m;
  }
  return total;
}

/** On-axis illuminance by the inverse-square law, point-source approximation. */
export function luxAt(profile, distanceM) {
  return distanceM > 0 ? profile.peakCd / (distanceM * distanceM) : 0;
}
