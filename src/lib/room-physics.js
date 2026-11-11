import { getFinish, getProduct } from '../data/products.js';
import { SLOPE_CM } from './wall-studio.js';

/**
 * Environmental physics for a Wall Studio layout or a 3D room.
 *
 * Illuminance follows the lumen method: each lit module sends a share of its
 * flux straight to the floor, and all flux then inter-reflects inside the
 * envelope as an integrating sphere, E_r = MF * phi * rho / (S * (1 - rho)).
 *
 * Reverberation follows Sabine in six ISO octave bands, 125 Hz to 4 kHz,
 * RT60 = 0.161 * V / (A + 4mV), with A the sum of surface area times the
 * band's absorption coefficient and 4mV the air term above 500 Hz. The
 * baseline is the room as drawn (bare surfaces plus its reference furniture);
 * mounted modules add their face area at their own coefficient in place of the
 * wall they cover. rt60Sec is the 500 Hz reference band.
 *
 * Speech intelligibility is the reverberation-only STI: per band, the
 * modulation transfer m(F) = 1 / sqrt(1 + (2 pi F T / 13.8)^2) over the 14
 * IEC 60268-16 modulation frequencies, mapped to an apparent SNR clipped to
 * +/-15 dB, averaged to a transmission index and weighted across the bands.
 *
 * A 3D room is its own width x depth x height. A 2D wall has no depth, so it
 * is read as the front of a reference zone 260 cm deep.
 */

export const REFERENCE_DEPTH_CM = 260;
// Metric Sabine constant (s/m) for air at 20 C.
export const SABINE_K = 0.161;
export const MAINTENANCE_FACTOR = 0.8;
// EN 12464-1 reading and desk work.
export const TASK_TARGET_LUX = 300;

export const LIGHTING_GRADES = Object.freeze([
  Object.freeze({ id: 'ambient', label: 'Ambient Lounge', range: '<100 lx' }),
  Object.freeze({ id: 'balanced', label: 'Residential Balanced', range: '100-250 lx' }),
  Object.freeze({ id: 'task', label: 'Studio Task', range: '>250 lx' }),
]);

// Light reflectance values. Walls take the scene's surface mode.
const WALL_LRV = Object.freeze({ ambient: 0.35, daylight: 0.7 });
const FLOOR_LRV = 0.2;
const CEILING_LRV = 0.8;

export const OCTAVE_BANDS = Object.freeze([125, 250, 500, 1000, 2000, 4000]);
export const OCTAVE_LABELS = Object.freeze(['125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz']);
const REF_BAND = OCTAVE_BANDS.indexOf(500);

// Absorption coefficients per octave band, 125 Hz to 4 kHz.
export const OCTAVE_ALPHA = Object.freeze({
  floor: Object.freeze([0.15, 0.11, 0.1, 0.07, 0.06, 0.07]), // timber boards on joists
  ceiling: Object.freeze([0.29, 0.1, 0.05, 0.04, 0.07, 0.09]), // plasterboard on battens
  wall: Object.freeze([0.02, 0.02, 0.03, 0.03, 0.04, 0.05]), // painted plaster
  timber: Object.freeze([0.19, 0.14, 0.1, 0.08, 0.07, 0.07]),
  metal: Object.freeze([0.03, 0.03, 0.04, 0.04, 0.05, 0.05]),
  felt: Object.freeze([0.08, 0.3, 0.7, 0.88, 0.92, 0.9]), // 30 mm PET felt, NRC 0.70
  baffle: Object.freeze([0.2, 0.55, 0.85, 1, 1, 0.95]), // 50 mm PET felt, NRC 0.85
});

// The 500 Hz reference coefficients.
export const ALPHA = Object.freeze(
  Object.fromEntries(Object.entries(OCTAVE_ALPHA).map(([key, bands]) => [key, bands[REF_BAND]])),
);

// Air absorption 4m (1/m), ISO 9613-1 at 20 C and 50-70% RH; negligible below 1 kHz.
const AIR_4M = Object.freeze([0, 0, 0, 0.0034, 0.0089, 0.0276]);

// Equivalent absorption of the reference furniture, m2 sabins per band.
const FURNITURE_SABINS = new Map([
  ['bed-160', [1.3, 1.5, 1.6, 1.5, 1.4, 1.3]],
  ['sofa-200', [1.1, 1.3, 1.4, 1.3, 1.2, 1.1]],
  ['desk-140', [0.24, 0.2, 0.15, 0.12, 0.1, 0.1]],
]);

// Felt-core panels: timber border width (cm) and the core's coefficient set.
const FELT_PANELS = new Map([
  ['frame', { borderCm: 5, alpha: OCTAVE_ALPHA.felt }],
  ['baffle', { borderCm: 1.2, alpha: OCTAVE_ALPHA.baffle }],
]);

// IEC 60268-16 modulation frequencies, 0.63 to 12.5 Hz in third octaves.
const MODULATION_HZ = Object.freeze([0.63, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10, 12.5]);
// Houtgast-Steeneken octave weights, 125 Hz to 4 kHz; the 8 kHz share is renormalised away.
const STI_WEIGHTS = Object.freeze([0.13, 0.14, 0.11, 0.12, 0.19, 0.17]);

export const STI_GRADES = Object.freeze([
  Object.freeze({ id: 'poor', label: 'Poor', min: 0 }),
  Object.freeze({ id: 'fair', label: 'Fair', min: 0.45 }),
  Object.freeze({ id: 'good', label: 'Good', min: 0.6 }),
  Object.freeze({ id: 'excellent', label: 'Excellent', min: 0.75 }),
]);

// Share of a module's flux that lands directly on the floor zone; the rest
// reaches the walls and ceiling first.
const DIRECT_FLOOR_RATIO = new Map([
  ['shelf', 0.6],
  ['cube', 0.4],
  ['sideboard', 0.7],
  ['lightbar', 0.5],
  ['column', 0.35],
  ['spot', 0.3],
  ['frame', 0.1],
  ['track', 0],
  ['pendant', 0.75],
  ['sconce', 0.35],
  ['baffle', 0],
  ['hub', 0],
]);

// Of the flux that is not direct, the share that washes the wall the module hangs on.
const MAIN_WALL_SHARE = 0.6;

const round = (value, places = 0) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Envelope in metres. An attic slope removes a 90 x 90 cm prism along the depth. */
function envelope(subject) {
  if (isRecord(subject.room)) {
    const { widthCm, depthCm, heightCm, lighting, furniture } = subject.room;
    return {
      w: widthCm / 100,
      d: depthCm / 100,
      h: heightCm / 100,
      s: 0,
      surface: lighting === 'daylight' ? 'daylight' : 'ambient',
      furniture,
    };
  }
  const { widthCm, heightCm, surface, slope } = subject.wall;
  return {
    w: widthCm / 100,
    d: REFERENCE_DEPTH_CM / 100,
    h: heightCm / 100,
    s: slope ? SLOPE_CM / 100 : 0,
    surface: surface === 'daylight' ? 'daylight' : 'ambient',
    furniture: 'none',
  };
}

function surfaces({ w, d, h, s }) {
  const mainWall = w * h - (s * s) / 2;
  return {
    volume: mainWall * d,
    floor: w * d,
    ceiling: (w - s) * d + Math.SQRT2 * s * d,
    walls: 2 * w * h + 2 * d * h - s * s - s * d,
    mainWall,
  };
}

function materialAlpha(finish, band) {
  return finish.texture === 'grain' ? OCTAVE_ALPHA.timber[band] : OCTAVE_ALPHA.metal[band];
}

/** Net absorption a module adds in one band: its face at its own coefficient, minus the wall it covers. */
function moduleSabins(product, finish, band) {
  if (product.mount === 'recessed') return 0;
  const { w, h } = product.dimsCm;
  const face = (w * h) / 1e4;
  const covered = product.mount === 'wall' ? OCTAVE_ALPHA.wall[band] : 0;
  const panel = FELT_PANELS.get(product.shape);
  if (panel) {
    const b = panel.borderCm;
    const core = (Math.max(0, w - 2 * b) * Math.max(0, h - 2 * b)) / 1e4;
    return core * (panel.alpha[band] - covered) + (face - core) * (materialAlpha(finish, band) - covered);
  }
  return face * (materialAlpha(finish, band) - covered);
}

export function lightingGrade(lux) {
  if (lux < 100) return LIGHTING_GRADES[0];
  if (lux <= 250) return LIGHTING_GRADES[1];
  return LIGHTING_GRADES[2];
}

/** Reverberation-only Speech Transmission Index from per-band RT60 in seconds, 0 to 1. */
export function speechTransmissionIndex(rt60ByBand) {
  let sti = 0;
  let weights = 0;
  rt60ByBand.forEach((t, k) => {
    let ti = 0;
    for (const f of MODULATION_HZ) {
      const x = (2 * Math.PI * f * Math.max(0, t)) / 13.8;
      const m = 1 / Math.sqrt(1 + x * x);
      // m reaches 1 as T reaches 0; the clip keeps the index finite.
      const snr = m >= 1 ? 15 : 10 * Math.log10(m / (1 - m));
      ti += (Math.min(15, Math.max(-15, snr)) + 15) / 30;
    }
    sti += STI_WEIGHTS[k] * (ti / MODULATION_HZ.length);
    weights += STI_WEIGHTS[k];
  });
  return weights > 0 ? sti / weights : 0;
}

export function stiGrade(score) {
  let grade = STI_GRADES[0];
  for (const entry of STI_GRADES) if (score >= entry.min) grade = entry;
  return grade;
}

/**
 * Illuminance and reverberation for a wall layout ({ wall, items }) or a
 * room state ({ room, items }). Pure and deterministic; module positions do
 * not enter the model, only which parts are mounted, their finish and LED state.
 */
export function computeEnvironmentalPhysics(subject) {
  const env = envelope(subject);
  const area = surfaces(env);
  const items = Array.isArray(subject.items) ? subject.items : [];

  let fluxLm = 0;
  let directLm = 0;
  let coverM2 = 0;
  let coverLrv = 0;
  const addedSabins = OCTAVE_BANDS.map(() => 0);
  let acousticFrames = 0;
  let acousticBaffles = 0;

  for (const item of items) {
    const product = getProduct(item.productId);
    const finish = getFinish(item.finish);
    if (!product || !finish) continue;
    if (item.led && product.lumens > 0) {
      fluxLm += product.lumens;
      directLm += product.lumens * (DIRECT_FLOOR_RATIO.get(product.shape) ?? 0.5);
    }
    if (product.mount === 'wall') {
      const face = (product.dimsCm.w * product.dimsCm.h) / 1e4;
      coverM2 += face;
      coverLrv += face * finish.lrv;
    }
    if (product.shape === 'frame') acousticFrames += 1;
    if (product.shape === 'baffle') acousticBaffles += 1;
    for (let band = 0; band < OCTAVE_BANDS.length; band += 1) {
      addedSabins[band] += moduleSabins(product, finish, band);
    }
  }

  // Overlapping modules can claim more face than the wall has; cap and rescale.
  const paint = WALL_LRV[env.surface];
  const covered = Math.min(coverM2, area.mainWall);
  const moduleLrv = coverM2 > 0 ? (coverLrv / coverM2) * covered : 0;
  const mainLrv = (paint * (area.mainWall - covered) + moduleLrv) / area.mainWall;
  const wallLrv = (paint * (area.walls - area.mainWall) + mainLrv * area.mainWall) / area.walls;
  const total = area.floor + area.ceiling + area.walls;
  const rho = (area.floor * FLOOR_LRV + area.ceiling * CEILING_LRV + area.walls * wallLrv) / total;

  const reflected = (MAINTENANCE_FACTOR * fluxLm * rho) / (total * (1 - rho));
  const avgFloorLux = Math.round((MAINTENANCE_FACTOR * directLm) / area.floor + reflected);
  const avgWallLux = Math.round(
    (MAINTENANCE_FACTOR * (fluxLm - directLm) * MAIN_WALL_SHARE) / area.mainWall + reflected,
  );

  const furniture = FURNITURE_SABINS.get(env.furniture);
  const bands = OCTAVE_BANDS.map((_, band) => {
    const surfaceSabins =
      area.floor * OCTAVE_ALPHA.floor[band] +
      area.ceiling * OCTAVE_ALPHA.ceiling[band] +
      area.walls * OCTAVE_ALPHA.wall[band];
    const baseline = surfaceSabins + (furniture?.[band] ?? 0) + AIR_4M[band] * area.volume;
    const absorption = baseline + addedSabins[band];
    return {
      absorption,
      rt60: (SABINE_K * area.volume) / absorption,
      baselineRt60: (SABINE_K * area.volume) / baseline,
    };
  });
  const ref = bands[REF_BAND];
  const baselineRt60Sec = round(ref.baselineRt60, 2);
  const rt60Sec = round(ref.rt60, 2);
  const octaveRt60 = Object.fromEntries(OCTAVE_BANDS.map((hz, k) => [hz, round(bands[k].rt60, 2)]));
  const baselineOctaveRt60 = Object.fromEntries(OCTAVE_BANDS.map((hz, k) => [hz, round(bands[k].baselineRt60, 2)]));
  const stiScore = round(speechTransmissionIndex(bands.map((band) => band.rt60)), 2);
  const sti = stiGrade(stiScore);
  const grade = lightingGrade(avgFloorLux);

  return {
    floorAreaM2: round(area.floor, 2),
    volumeM3: round(area.volume, 2),
    reflectance: round(rho, 2),
    fluxLm,
    // The uniform inter-reflected component every surface point receives.
    reflectedLux: round(reflected, 1),
    avgFloorLux,
    avgWallLux,
    taskTarget: TASK_TARGET_LUX,
    taskCoveragePct: Math.round((avgFloorLux / TASK_TARGET_LUX) * 100),
    lightingGrade: grade.label,
    gradeId: grade.id,
    rt60Sec,
    baselineRt60Sec,
    // From the rounded figures, so the readout always adds up.
    acousticDeltaSec: round(rt60Sec - baselineRt60Sec, 2),
    equivalentAbsorptionSabins: round(ref.absorption, 2),
    octaveRt60,
    baselineOctaveRt60,
    stiScore,
    stiGrade: sti.label,
    stiGradeId: sti.id,
    acousticFrames,
    acousticBaffles,
  };
}

/** Readout lines shared by both summary bars. */
export function formatEnvironmentalPhysics(physics, formatInt = (n) => String(n)) {
  const delta = physics.acousticDeltaSec;
  return {
    illuminance: `Illuminance: ${formatInt(physics.avgFloorLux)} lx (${physics.lightingGrade})`,
    rt60: `RT60: ${physics.rt60Sec.toFixed(2)} s`,
    damping: delta < 0 ? `${delta.toFixed(2)} s damping` : 'No added absorption',
    sti: `STI ${physics.stiScore.toFixed(2)} (${physics.stiGrade})`,
    octave: OCTAVE_BANDS.map((hz, k) => ({ hz, label: OCTAVE_LABELS[k], rt60: physics.octaveRt60[hz] })),
    detail: `V ${physics.volumeM3.toFixed(1)} m3 / A ${physics.equivalentAbsorptionSabins.toFixed(2)} m2 sabins / rho ${physics.reflectance.toFixed(2)} / wall ${formatInt(physics.avgWallLux)} lx / task ${physics.taskCoveragePct}% of ${physics.taskTarget} lx`,
  };
}
