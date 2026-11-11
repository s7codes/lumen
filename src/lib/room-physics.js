import { getFinish, getProduct } from '../data/products.js';
import { SLOPE_CM } from './wall-studio.js';

/**
 * Environmental physics for a Wall Studio layout or a 3D room.
 *
 * Illuminance follows the lumen method: each lit module sends a share of its
 * flux straight to the floor, and all flux then inter-reflects inside the
 * envelope as an integrating sphere, E_r = MF * phi * rho / (S * (1 - rho)).
 *
 * Reverberation follows Sabine at 500 Hz, RT60 = 0.161 * V / A, with A the
 * sum of surface area times absorption coefficient. The baseline is the room
 * as drawn (bare surfaces plus its reference furniture); mounted modules add
 * their face area at their own coefficient in place of the wall they cover.
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

// Absorption coefficients at 500 Hz.
export const ALPHA = Object.freeze({
  floor: 0.1, // timber boards on joists
  ceiling: 0.05, // plasterboard
  wall: 0.03, // painted plaster
  timber: 0.1,
  metal: 0.04,
  felt: 0.7, // 30 mm PET felt core, NRC 0.70
});

// Equivalent absorption of the reference furniture, m2 sabins at 500 Hz.
const FURNITURE_SABINS = new Map([
  ['bed-160', 1.6],
  ['sofa-200', 1.4],
  ['desk-140', 0.15],
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
]);

// Of the flux that is not direct, the share that washes the wall the module hangs on.
const MAIN_WALL_SHARE = 0.6;
const FRAME_BORDER_CM = 5;

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

function materialAlpha(finish) {
  return finish.texture === 'grain' ? ALPHA.timber : ALPHA.metal;
}

/** Net absorption a module adds: its face at its own coefficient, minus the wall it covers. */
function moduleSabins(product, finish) {
  if (product.mount === 'recessed') return 0;
  const { w, h } = product.dimsCm;
  const face = (w * h) / 1e4;
  const covered = product.mount === 'wall' ? ALPHA.wall : 0;
  if (product.shape === 'frame') {
    const core = (Math.max(0, w - 2 * FRAME_BORDER_CM) * Math.max(0, h - 2 * FRAME_BORDER_CM)) / 1e4;
    return core * (ALPHA.felt - covered) + (face - core) * (materialAlpha(finish) - covered);
  }
  return face * (materialAlpha(finish) - covered);
}

export function lightingGrade(lux) {
  if (lux < 100) return LIGHTING_GRADES[0];
  if (lux <= 250) return LIGHTING_GRADES[1];
  return LIGHTING_GRADES[2];
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
  let addedSabins = 0;
  let acousticFrames = 0;

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
    addedSabins += moduleSabins(product, finish);
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

  const surfaceSabins = area.floor * ALPHA.floor + area.ceiling * ALPHA.ceiling + area.walls * ALPHA.wall;
  const baselineSabins = surfaceSabins + (FURNITURE_SABINS.get(env.furniture) ?? 0);
  const equivalentAbsorptionSabins = baselineSabins + addedSabins;
  const baselineRt60Sec = round((SABINE_K * area.volume) / baselineSabins, 2);
  const rt60Sec = round((SABINE_K * area.volume) / equivalentAbsorptionSabins, 2);
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
    equivalentAbsorptionSabins: round(equivalentAbsorptionSabins, 2),
    acousticFrames,
  };
}

/** Readout lines shared by both summary bars. */
export function formatEnvironmentalPhysics(physics, formatInt = (n) => String(n)) {
  const delta = physics.acousticDeltaSec;
  return {
    illuminance: `Illuminance: ${formatInt(physics.avgFloorLux)} lx (${physics.lightingGrade})`,
    rt60: `RT60: ${physics.rt60Sec.toFixed(2)} s`,
    damping: delta < 0 ? `${delta.toFixed(2)} s damping` : 'No added absorption',
    detail: `V ${physics.volumeM3.toFixed(1)} m3 / A ${physics.equivalentAbsorptionSabins.toFixed(2)} m2 sabins / rho ${physics.reflectance.toFixed(2)} / wall ${formatInt(physics.avgWallLux)} lx / task ${physics.taskCoveragePct}% of ${physics.taskTarget} lx`,
  };
}
