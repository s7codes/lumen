import { getProduct } from '../data/products.js';
import { dimFactor } from './dimming.js';
import { beamProfile } from './photometry.js';
import { computeEnvironmentalPhysics, MAINTENANCE_FACTOR, REFERENCE_DEPTH_CM } from './room-physics.js';
import { SLOPE_CM } from './wall-studio.js';

/**
 * Point-by-point illuminance on the main wall and on the floor.
 *
 * Every lit module is reduced to its emission aperture: a line (or a point)
 * where the LED channel sits, carrying the cos^m lobes of its optic from
 * photometry.js. A line is split into short segments, each a point source
 * with an equal share of the lobe intensity. At a surface point P with normal
 * n, each segment S adds E = I0 * cos^m(theta) * cos(phi) / r^2, with theta
 * from the lobe axis, phi between n and the ray, r in metres.
 *
 * On top of the direct term every point receives the uniform inter-reflected
 * component of computeEnvironmentalPhysics, so unlit corners still read the
 * cavity bounce. Frame: cm, x along the main wall, y up from the floor, z out
 * into the room. Floor fields report plan coordinates, y measured out from
 * the main wall.
 */

export const ISO_LUX_LEVELS = Object.freeze([100, 250, 500]);
export const WALL_GRID = Object.freeze({ cols: 24, rows: 16 });
export const FLOOR_GRID = Object.freeze({ cols: 24, rows: 16 });
export const LUX_SCALE = Object.freeze({ min: 5, max: 2000 });

// Basalt, deep bronze, tungsten amber, warm alabaster.
export const LUX_RAMP = Object.freeze([
  Object.freeze({ t: 0, rgb: Object.freeze([18, 17, 16]) }),
  Object.freeze({ t: 0.38, rgb: Object.freeze([92, 54, 26]) }),
  Object.freeze({ t: 0.72, rgb: Object.freeze([214, 136, 58]) }),
  Object.freeze({ t: 1, rgb: Object.freeze([246, 239, 228]) }),
]);

const GRID_LIMIT = Object.freeze({ min: 4, max: 96 });
const SEGMENT_CM = 2.5;
const MAX_SEGMENTS = 48;
// Below 2 cm the point-source model breaks down; clamp instead of diverging.
const MIN_R_M = 0.02;

const DOWN = Object.freeze([0, -1, 0]);
const UP = Object.freeze([0, 1, 0]);
const LEFT = Object.freeze([-1, 0, 0]);
const RIGHT = Object.freeze([1, 0, 0]);

const round = (value, places = 0) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function gridSize(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(GRID_LIMIT.max, Math.max(GRID_LIMIT.min, Math.round(value)));
}

/** Emission apertures in cm, matching the emitter strips the 3D scene draws. */
function apertures(shape, b) {
  const xMid = (b.x0 + b.x1) / 2;
  switch (shape) {
    case 'shelf':
      return [{ from: [b.x0 + 2, b.y0, b.z1 - 2], to: [b.x1 - 2, b.y0, b.z1 - 2], axes: [DOWN] }];
    case 'cube':
      return [{ from: [b.x0 + 2, b.y1 - 3, b.z1 - 1], to: [b.x1 - 2, b.y1 - 3, b.z1 - 1], axes: [DOWN] }];
    case 'sideboard':
      return [{ from: [b.x0 + 2, b.y0, b.z1 - 3], to: [b.x1 - 2, b.y0, b.z1 - 3], axes: [DOWN] }];
    case 'lightbar':
      return [{ from: [b.x0 + 1, b.y0 + 2.4, b.z1], to: [b.x1 - 1, b.y0 + 2.4, b.z1], axes: [DOWN] }];
    case 'column':
      return [{ from: [xMid, b.y0 + 4, b.z1], to: [xMid, b.y1 - 6, b.z1], axes: [LEFT, RIGHT] }];
    case 'spot':
      return [{ from: [xMid, b.y0, (b.z0 + b.z1) / 2], to: null, axes: [DOWN] }];
    case 'frame':
      // Rear halo: one perimeter channel per side, each throwing into the wall plane.
      return [
        { from: [b.x0 + 2, b.y0 + 3, 1.5], to: [b.x0 + 2, b.y1 - 3, 1.5], axes: [LEFT] },
        { from: [b.x1 - 2, b.y0 + 3, 1.5], to: [b.x1 - 2, b.y1 - 3, 1.5], axes: [RIGHT] },
      ];
    case 'pendant': {
      const zMid = (b.z0 + b.z1) / 2;
      return [{ from: [b.x0 + 2, b.y0, zMid], to: [b.x1 - 2, b.y0, zMid], axes: [DOWN] }];
    }
    case 'sconce':
      // Open blade ends: one lobe down the wall from the foot, one up from the head.
      return [
        { from: [xMid, b.y0, b.z1 - 1], to: null, axes: [DOWN] },
        { from: [xMid, b.y1, b.z1 - 1], to: null, axes: [UP] },
      ];
    default:
      return [];
  }
}

/**
 * Point sources for every active luminous module (watts > 0, led !== false).
 * Each entry is { x, y, z, cd, ax, ay, az, m } with cd already scaled by the
 * maintenance factor and the module's DALI-2 dim level.
 */
export function luminousSources(items) {
  const sources = [];
  if (!Array.isArray(items)) return sources;
  for (const item of items) {
    if (!isRecord(item) || item.led === false) continue;
    const product = getProduct(item.productId);
    if (!product || !(product.watts > 0)) continue;
    const profile = beamProfile(product);
    if (!profile || !Number.isFinite(item.xCm) || !Number.isFinite(item.yCm)) continue;

    const { w, h, d } = product.dimsCm;
    const box = { x0: item.xCm, x1: item.xCm + w, y0: item.yCm, y1: item.yCm + h, z0: 0, z1: d };
    const list = apertures(product.shape, box);
    const lobes = list.reduce((sum, a) => sum + a.axes.length, 0);
    if (lobes === 0) continue;
    const lobeCd =
      ((product.lumens * dimFactor(item)) / lobes) * ((profile.m + 1) / (2 * Math.PI)) * MAINTENANCE_FACTOR;

    for (const aperture of list) {
      const { from, to } = aperture;
      const length = to ? Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) : 0;
      const n = to ? Math.min(MAX_SEGMENTS, Math.max(1, Math.ceil(length / SEGMENT_CM))) : 1;
      for (const axis of aperture.axes) {
        const cd = lobeCd / n;
        for (let i = 0; i < n; i += 1) {
          const t = to ? (i + 0.5) / n : 0;
          sources.push({
            x: to ? from[0] + (to[0] - from[0]) * t : from[0],
            y: to ? from[1] + (to[1] - from[1]) * t : from[1],
            z: to ? from[2] + (to[2] - from[2]) * t : from[2],
            cd,
            ax: axis[0],
            ay: axis[1],
            az: axis[2],
            m: profile.m,
          });
        }
      }
    }
  }
  return sources;
}

/** Direct lux at a point on the main wall (z = 0, normal +z). */
export function wallPointLux(sources, xCm, yCm) {
  let total = 0;
  for (const s of sources) {
    if (s.z <= 0) continue;
    const dx = (xCm - s.x) / 100;
    const dy = (yCm - s.y) / 100;
    const dz = -s.z / 100;
    const r = Math.max(MIN_R_M, Math.hypot(dx, dy, dz));
    const cosTheta = (dx * s.ax + dy * s.ay + dz * s.az) / r;
    if (cosTheta <= 0) continue;
    total += (s.cd * cosTheta ** s.m * (-dz / r)) / (r * r);
  }
  return total;
}

/** Direct lux at a point on the floor (y = 0, normal +y), plan y out from the wall. */
export function floorPointLux(sources, xCm, planYCm) {
  let total = 0;
  for (const s of sources) {
    if (s.y <= 0) continue;
    const dx = (xCm - s.x) / 100;
    const dy = -s.y / 100;
    const dz = (planYCm - s.z) / 100;
    const r = Math.max(MIN_R_M, Math.hypot(dx, dy, dz));
    const cosTheta = (dx * s.ax + dy * s.ay + dz * s.az) / r;
    if (cosTheta <= 0) continue;
    total += (s.cd * cosTheta ** s.m * (-dy / r)) / (r * r);
  }
  return total;
}

function wallEnvelope(subject) {
  if (isRecord(subject.room)) {
    return { widthCm: subject.room.widthCm, heightCm: subject.room.heightCm, slope: false };
  }
  const wall = isRecord(subject.wall) ? subject.wall : {};
  return { widthCm: wall.widthCm, heightCm: wall.heightCm, slope: wall.slope === true };
}

function floorEnvelope(subject) {
  if (isRecord(subject.room)) return { widthCm: subject.room.widthCm, depthCm: subject.room.depthCm };
  const wall = isRecord(subject.wall) ? subject.wall : {};
  return { widthCm: wall.widthCm, depthCm: REFERENCE_DEPTH_CM };
}

/** True where a wall point is real wall, not the attic slope cut-out. */
export function onWall(wall, xCm, yCm) {
  return !wall.slope || xCm + yCm <= wall.widthCm + wall.heightCm - SLOPE_CM;
}

/**
 * Samples `pointLux` at cell centres, then scans whole centimetres within one
 * cell of the brightest centre so the hotspot follows a module cm for cm.
 */
function sampleField({ surface, spanX, spanY, cols, rows, pointLux, inside, ambientLux }) {
  const cellW = spanX / cols;
  const cellH = spanY / rows;
  const values = new Array(cols * rows);
  const direct = new Array(cols * rows);
  const mask = new Array(cols * rows);

  let sum = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let directPeak = 0;
  let best = -1;

  for (let j = 0; j < rows; j += 1) {
    const y = (j + 0.5) * cellH;
    for (let i = 0; i < cols; i += 1) {
      const x = (i + 0.5) * cellW;
      const k = j * cols + i;
      const e = pointLux(x, y);
      const total = e + ambientLux;
      direct[k] = round(e, 1);
      values[k] = round(total, 1);
      mask[k] = inside(x, y);
      if (!mask[k]) continue;
      sum += total;
      count += 1;
      min = Math.min(min, total);
      if (total > max) {
        max = total;
        best = k;
      }
      directPeak = Math.max(directPeak, e);
    }
  }

  let hotspot = null;
  if (best >= 0 && directPeak > 0) {
    const cx = ((best % cols) + 0.5) * cellW;
    const cy = (Math.floor(best / cols) + 0.5) * cellH;
    const x0 = Math.max(0, Math.ceil(cx - cellW));
    const x1 = Math.min(spanX, Math.floor(cx + cellW));
    const y0 = Math.max(0, Math.ceil(cy - cellH));
    const y1 = Math.min(spanY, Math.floor(cy + cellH));
    let peak = -Infinity;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!inside(x, y)) continue;
        const e = pointLux(x, y);
        if (e > peak + 1e-9) {
          peak = e;
          hotspot = { xCm: x, yCm: y, lux: Math.round(e + ambientLux) };
        }
      }
    }
  }

  const avg = count > 0 ? sum / count : 0;
  const peakLux = Math.round(Math.max(max, hotspot ? hotspot.lux : 0, 0));
  const minLux = count > 0 ? Math.round(min) : 0;
  const avgLux = Math.round(avg);

  const isoLux = ISO_LUX_LEVELS.map((lux) => {
    let cells = 0;
    for (let k = 0; k < values.length; k += 1) if (mask[k] && values[k] >= lux) cells += 1;
    return { lux, cells, areaPct: count > 0 ? Math.round((cells / count) * 100) : 0 };
  });

  return {
    surface,
    spanXCm: spanX,
    spanYCm: spanY,
    cols,
    rows,
    cellWCm: round(cellW, 3),
    cellHCm: round(cellH, 3),
    values,
    direct,
    mask,
    cells: count,
    ambientLux: round(ambientLux, 1),
    directPeakLux: Math.round(directPeak),
    peakLux,
    minLux,
    avgLux,
    // EN 12464-1 U0: minimum over average.
    uniformityRatio: avg > 0 ? round(min / avg, 2) : 0,
    diversityRatio: peakLux > 0 ? round(avg / peakLux, 2) : 0,
    hotspot,
    isoLux,
  };
}

/**
 * Illuminance across the main wall of a wall layout ({ wall, items }) or a
 * room ({ room, items }). Cells inside an attic slope are masked out of the
 * statistics. Row 0 is the bottom row, at the floor.
 */
export function computeWallLuxField(layout, options = {}) {
  const subject = isRecord(layout) ? layout : {};
  const opts = isRecord(options) ? options : {};
  const wall = wallEnvelope(subject);
  const sources = luminousSources(subject.items);
  const ambientLux = opts.ambient === false ? 0 : computeEnvironmentalPhysics(subject).reflectedLux;
  const field = sampleField({
    surface: 'wall',
    spanX: wall.widthCm,
    spanY: wall.heightCm,
    cols: gridSize(opts.cols, WALL_GRID.cols),
    rows: gridSize(opts.rows, WALL_GRID.rows),
    pointLux: (x, y) => wallPointLux(sources, x, y),
    inside: (x, y) => onWall(wall, x, y),
    ambientLux,
  });
  return { ...field, widthCm: wall.widthCm, heightCm: wall.heightCm, slope: wall.slope, sources: sources.length };
}

/**
 * Illuminance across the floor of a room ({ room, items }); a wall layout is
 * read over its 260 cm reference zone. Row 0 runs along the main wall.
 */
export function computeFloorLuxField(roomState, options = {}) {
  const subject = isRecord(roomState) ? roomState : {};
  const opts = isRecord(options) ? options : {};
  const floor = floorEnvelope(subject);
  const sources = luminousSources(subject.items);
  const ambientLux = opts.ambient === false ? 0 : computeEnvironmentalPhysics(subject).reflectedLux;
  const field = sampleField({
    surface: 'floor',
    spanX: floor.widthCm,
    spanY: floor.depthCm,
    cols: gridSize(opts.cols, FLOOR_GRID.cols),
    rows: gridSize(opts.rows, FLOOR_GRID.rows),
    pointLux: (x, y) => floorPointLux(sources, x, y),
    inside: () => true,
    ambientLux,
  });
  return { ...field, widthCm: floor.widthCm, depthCm: floor.depthCm, sources: sources.length };
}

/** Exact point reading on the wall, for a cursor probe. Null over the slope cut-out. */
export function createWallLuxProbe(layout) {
  const subject = isRecord(layout) ? layout : {};
  const wall = wallEnvelope(subject);
  const sources = luminousSources(subject.items);
  const ambientLux = computeEnvironmentalPhysics(subject).reflectedLux;
  return (xCm, yCm) => {
    if (!Number.isFinite(xCm) || !Number.isFinite(yCm)) return null;
    if (xCm < 0 || yCm < 0 || xCm > wall.widthCm || yCm > wall.heightCm || !onWall(wall, xCm, yCm)) return null;
    return Math.round(wallPointLux(sources, xCm, yCm) + ambientLux);
  };
}

/* Iso-lux contours by marching squares over the cell centres. */

// Edge pairs per case; edges 0 bottom, 1 right, 2 top, 3 left.
const MARCHING = [[], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], null, [[0, 2]], [[3, 2]], [[2, 3]], [[0, 2]], null, [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], []];

/**
 * Contour segments for each level, as [x1, y1, x2, y2] in cm on the field's
 * own axes. Saddles resolve by the square's centre value.
 */
export function isoLuxContours(field, levels = ISO_LUX_LEVELS) {
  const { cols, rows, values, spanXCm, spanYCm } = field;
  const cw = spanXCm / cols;
  const ch = spanYCm / rows;
  const at = (i, j) => values[j * cols + i];

  return levels.map((level) => {
    const segments = [];
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
        if (code === 0 || code === 15) continue;

        const x0 = (i + 0.5) * cw;
        const y0 = (j + 0.5) * ch;
        const lerp = (p, q) => (q === p ? 0.5 : (level - p) / (q - p));
        const edge = (e) => {
          if (e === 0) return [x0 + lerp(a, b) * cw, y0];
          if (e === 1) return [x0 + cw, y0 + lerp(b, c) * ch];
          if (e === 2) return [x0 + lerp(d, c) * cw, y0 + ch];
          return [x0, y0 + lerp(a, d) * ch];
        };

        let pairs = MARCHING[code];
        if (pairs === null) {
          const high = (a + b + c + d) / 4 >= level;
          if (code === 5) pairs = high ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]];
          else pairs = high ? [[3, 0], [1, 2]] : [[0, 1], [3, 2]];
        }
        for (const [e1, e2] of pairs) {
          const p = edge(e1);
          const q = edge(e2);
          segments.push([round(p[0], 2), round(p[1], 2), round(q[0], 2), round(q[1], 2)]);
        }
      }
    }
    return { lux: level, segments };
  });
}

/* False-colour ramp */

/** Position on the ramp for a lux value, log scaled from 5 to 2000 lx. */
export function luxToRamp(lux) {
  if (!(lux > LUX_SCALE.min)) return 0;
  const t = Math.log(lux / LUX_SCALE.min) / Math.log(LUX_SCALE.max / LUX_SCALE.min);
  return Math.min(1, t);
}

export function rampColor(t) {
  const v = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  for (let i = 1; i < LUX_RAMP.length; i += 1) {
    const hi = LUX_RAMP[i];
    if (v > hi.t) continue;
    const lo = LUX_RAMP[i - 1];
    const f = (v - lo.t) / (hi.t - lo.t);
    return lo.rgb.map((c, k) => Math.round(c + (hi.rgb[k] - c) * f));
  }
  return [...LUX_RAMP.at(-1).rgb];
}

export function luxColor(lux) {
  return rampColor(luxToRamp(lux));
}

/**
 * RGBA pixels for the field, bilinearly upsampled between cell centres.
 * Image row 0 is the field's last row: the top of the wall for a canvas, the
 * far side of the floor for a texture laid flat with flipY off.
 */
export function fieldImage(field, scale = 8) {
  const { cols, rows, values } = field;
  const s = Math.max(1, Math.min(16, Math.round(scale)));
  const width = cols * s;
  const height = rows * s;
  const data = new Uint8ClampedArray(width * height * 4);
  const at = (i, j) => values[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];

  for (let py = 0; py < height; py += 1) {
    const fy = rows - (py + 0.5) / s - 0.5;
    const j = Math.floor(fy);
    const ty = fy - j;
    for (let px = 0; px < width; px += 1) {
      const fx = (px + 0.5) / s - 0.5;
      const i = Math.floor(fx);
      const tx = fx - i;
      const lux =
        at(i, j) * (1 - tx) * (1 - ty) + at(i + 1, j) * tx * (1 - ty) + at(i, j + 1) * (1 - tx) * ty + at(i + 1, j + 1) * tx * ty;
      const [r, g, b] = luxColor(lux);
      const o = (py * width + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}
