/*
 * Scene, photometry and choreography for the overview showcase theatre.
 * Pure data and math, no DOM: the painter and the rAF loop live elsewhere.
 *
 * Room frame in cm, as in the planner: x along the north wall, y up, z from
 * the north wall toward the south wall. Yaw 0 puts the eye south of the room
 * looking north; yaw 90 puts it east looking west.
 */

export const STAGE_ROOM = Object.freeze({ label: 'Gallery', widthCm: 640, depthCm: 520, heightCm: 300 });
const W = STAGE_ROOM.widthCm;
const D = STAGE_ROOM.depthCm;
const H = STAGE_ROOM.heightCm;

/*
 * Choreography pace. The stage is an architectural turntable, not a spin
 * test: a long act, a slow yaw, a shallow pitch swell and bus pulses that
 * drift rather than race.
 */
export const ACT_SECONDS = 7;
export const ACT_DURATION_MS = ACT_SECONDS * 1000;
export const ORBIT_DEG_PER_S = 20;
export const ORBIT_PITCH = Object.freeze({ min: 27, max: 35 });
export const PULSE_SPEED_CM_S = 64;
export const PULSE_SPACING_CM = 96;
export const SNAP_CM = 5;
export const EYE_HEIGHT_CM = 165;
export const EYE_FOV_DEG = 78;
export const ISO_LEVELS = Object.freeze([100, 250, 500]);

export const ACTS = Object.freeze([
  Object.freeze({ id: 'orbit', index: '01', label: '360-Degree Orbit', caption: 'Four-wall orbit, 2700K wash and a live 24V daisy chain.' }),
  Object.freeze({ id: 'inside', index: '02', label: '165 cm Eye Level', caption: 'A 78 deg lens at 165 cm sweeps the north, east and west walls.' }),
  Object.freeze({ id: 'gizmo', index: '03', label: 'Raycast & Gizmo', caption: 'A ray takes the shelf; the gizmo slides it on 5 cm ticks.' }),
  Object.freeze({ id: 'isolux', index: '04', label: 'Iso-Lux Field', caption: 'Floor and wall illuminance with 100, 250 and 500 lx iso-lines.' }),
]);
export const ACT_IDS = Object.freeze(ACTS.map((act) => act.id));

export function isActId(value) {
  return typeof value === 'string' && ACT_IDS.includes(value);
}

export function nextAct(id) {
  const i = ACT_IDS.indexOf(id);
  return ACT_IDS[(i + 1) % ACT_IDS.length];
}

/* ---------- vectors ---------- */

export const DEG = Math.PI / 180;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function easeInOut(t) {
  const c = clamp01(t);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** Signed shortest angle from `from` to `to`, in degrees. */
export function angleDelta(from, to) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

export function wrap360(deg) {
  return ((deg % 360) + 360) % 360;
}

/* ---------- camera and projection ---------- */

export const NEAR_CM = 12;

// The choreography is framed for a 3:2 stage; a taller stage keeps that
// horizontal framing and gains headroom instead of zooming in.
export const STAGE_ASPECT = 1.5;

/**
 * A view for one frame: eye on an orbit round `target`, a right-handed basis
 * and a pinhole focal length in CSS px for the stage, fitted to 3:2.
 */
export function createView(cam, width, height) {
  const yaw = cam.yaw * DEG;
  const pitch = cam.pitch * DEG;
  const cp = Math.cos(pitch);
  const eye = [cam.tx + cam.dist * cp * Math.sin(yaw), cam.ty + cam.dist * Math.sin(pitch), cam.tz + cam.dist * cp * Math.cos(yaw)];
  const f = norm([cam.tx - eye[0], cam.ty - eye[1], cam.tz - eye[2]]);
  const r = norm([-f[2], 0, f[0]]);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return {
    eye,
    f,
    r,
    u,
    cx: width / 2,
    cy: height / 2,
    width,
    height,
    focal: Math.min(height, width / STAGE_ASPECT) / 2 / Math.tan((cam.fov * DEG) / 2),
  };
}

/** Camera-space coordinates: x right, y up, z depth along the view axis. */
export function toCamera(view, p) {
  const dx = p[0] - view.eye[0];
  const dy = p[1] - view.eye[1];
  const dz = p[2] - view.eye[2];
  const { r, u, f } = view;
  return [dx * r[0] + dy * r[1] + dz * r[2], dx * u[0] + dy * u[1] + dz * u[2], dx * f[0] + dy * f[1] + dz * f[2]];
}

export function cameraToScreen(view, c) {
  const s = view.focal / c[2];
  return [view.cx + c[0] * s, view.cy - c[1] * s];
}

/** Screen point of a world point, or null behind the near plane. */
export function project(view, p) {
  const c = toCamera(view, p);
  return c[2] < NEAR_CM ? null : cameraToScreen(view, c);
}

/** Sutherland-Hodgman against the near plane, in camera space. */
export function clipNear(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ina = a[2] >= NEAR_CM;
    const inb = b[2] >= NEAR_CM;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (NEAR_CM - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR_CM]);
    }
  }
  return out;
}

/** Screen polygon of a world polygon, clipped at the near plane; empty when fully behind. */
export function projectPolygon(view, points) {
  const clipped = clipNear(points.map((p) => toCamera(view, p)));
  return clipped.map((c) => cameraToScreen(view, c));
}

/** Screen segment of a world segment, clipped at the near plane, or null. */
export function projectSegment(view, a, b) {
  let ca = toCamera(view, a);
  let cb = toCamera(view, b);
  if (ca[2] < NEAR_CM && cb[2] < NEAR_CM) return null;
  if (ca[2] < NEAR_CM || cb[2] < NEAR_CM) {
    const t = (NEAR_CM - ca[2]) / (cb[2] - ca[2]);
    const cut = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR_CM];
    if (ca[2] < NEAR_CM) ca = cut;
    else cb = cut;
  }
  return [cameraToScreen(view, ca), cameraToScreen(view, cb)];
}

/** World point on the floor under a screen point, or null off the floor. */
export function floorUnder(view, sx, sy) {
  const x = (sx - view.cx) / view.focal;
  const y = (view.cy - sy) / view.focal;
  const { f, r, u, eye } = view;
  const dir = [f[0] + r[0] * x + u[0] * y, f[1] + r[1] * x + u[1] * y, f[2] + r[2] * x + u[2] * y];
  if (dir[1] >= -1e-6) return null;
  const t = -eye[1] / dir[1];
  const p = [eye[0] + dir[0] * t, 0, eye[2] + dir[2] * t];
  return p[0] >= 0 && p[0] <= W && p[2] >= 0 && p[2] <= D ? p : null;
}

/** Monotone-chain convex hull of screen points. */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/* ---------- room ---------- */

/** Walls with corners (counter-clockwise from inside) and the normal facing into the room. */
export const WALLS = Object.freeze([
  { id: 'north', inward: [0, 0, 1], corners: [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], center: [W / 2, H / 2, 0] },
  { id: 'east', inward: [-1, 0, 0], corners: [[W, 0, 0], [W, 0, D], [W, H, D], [W, H, 0]], center: [W, H / 2, D / 2] },
  { id: 'south', inward: [0, 0, -1], corners: [[W, 0, D], [0, 0, D], [0, H, D], [W, H, D]], center: [W / 2, H / 2, D] },
  { id: 'west', inward: [1, 0, 0], corners: [[0, 0, D], [0, 0, 0], [0, H, 0], [0, H, D]], center: [0, H / 2, D / 2] },
]);

export const FLOOR = Object.freeze([[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]]);

/**
 * 1 for a wall seen from inside the room, 0 for a wall between the eye and
 * the room: that one is section-cut to a dashed outline. The band crossfades
 * as the orbit swings past the wall plane.
 */
export function wallPresence(view, wall) {
  const toEye = norm(sub(view.eye, wall.center));
  return smoothstep(-0.16, 0.1, dot(toEye, wall.inward));
}

/* ---------- furniture and modules ---------- */

export const SHELF = Object.freeze({ widthCm: 110, depthCm: 25, thickCm: 5, home: Object.freeze({ x: 140, y: 145 }) });
export const SHELF_TRAVEL = Object.freeze({ x: [60, 420], y: [100, 210] });

export const OBSERVER = Object.freeze([W / 2, EYE_HEIGHT_CM, 325]);

/** Linear Suspension Pendant 150: body underside height and the line it hangs on. */
export const PENDANT = Object.freeze({ x0: 245, x1: 395, y: 206, z: 190 });
const PENDANT_Y = PENDANT.y;
const PENDANT_Z = PENDANT.z;

function box(min, max, palette) {
  return { min, max, palette };
}

/** Static objects as boxes; the shelf is added per frame because it moves. */
export const OBJECTS = Object.freeze([
  {
    id: 'platform',
    boxes: [
      box([180, 0, 392], [460, 26, 500], 'platform'),
      box([186, 26, 398], [454, 40, 484], 'cushion'),
      box([180, 26, 484], [460, 74, 504], 'platform'),
    ],
  },
  { id: 'column', boxes: [box([606, 0, 8], [632, 188, 34], 'alu'), box([609, 188, 11], [629, 192, 31], 'emitter')] },
  { id: 'frame', boxes: [box([0, 96, 250], [5, 196, 370], 'felt'), box([5, 104, 258], [7, 188, 362], 'feltInset')] },
  { id: 'pendant', boxes: [box([245, PENDANT_Y, PENDANT_Z - 3], [395, PENDANT_Y + 6, PENDANT_Z + 3], 'pendant')] },
]);

export const PENDANT_CABLES = Object.freeze([
  [[262, PENDANT_Y + 6, PENDANT_Z], [262, H, PENDANT_Z]],
  [[378, PENDANT_Y + 6, PENDANT_Z], [378, H, PENDANT_Z]],
]);

export function shelfBoxes(shelf) {
  const { widthCm, depthCm, thickCm } = SHELF;
  return [box([shelf.x, shelf.y, 0], [shelf.x + widthCm, shelf.y + thickCm, depthCm], 'walnut')];
}

/** Laser dimensions from the shelf to both corners, the floor and the ceiling. */
export function shelfDimensions(shelf) {
  return {
    x: Math.round(shelf.x),
    r: Math.round(W - shelf.x - SHELF.widthCm),
    y: Math.round(shelf.y),
    c: Math.round(H - shelf.y - SHELF.thickCm),
  };
}

export function snapCm(value) {
  return Math.round(value / SNAP_CM) * SNAP_CM;
}

/**
 * Gizmo choreography over one act: the ray locks on, X slides the shelf
 * east, Y lifts it, then both axes bring it home. Positions land on 5 cm
 * ticks; `axis` names the handle in use.
 */
export const GIZMO_PHASES = Object.freeze({ lock: 0.1, x: 0.43, y: 0.73, home: 0.965 });

export function gizmoPose(t) {
  const { home } = SHELF;
  const dx = 150;
  const dy = 45;
  const at = (fraction) => fraction * ACT_SECONDS;
  const lockEnd = at(GIZMO_PHASES.lock);
  const xEnd = at(GIZMO_PHASES.x);
  const yEnd = at(GIZMO_PHASES.y);
  const homeEnd = at(GIZMO_PHASES.home);
  let x = home.x;
  let y = home.y;
  let axis = null;
  let lock = clamp01(t / lockEnd);
  if (t >= lockEnd && t < xEnd) {
    x = home.x + dx * easeInOut((t - lockEnd) / (xEnd - lockEnd));
    axis = 'x';
  } else if (t >= xEnd && t < yEnd) {
    x = home.x + dx;
    y = home.y + dy * easeInOut((t - xEnd) / (yEnd - xEnd));
    axis = 'y';
  } else if (t >= yEnd) {
    const k = easeInOut((t - yEnd) / (homeEnd - yEnd));
    x = home.x + dx * (1 - k);
    y = home.y + dy * (1 - k);
    axis = 'xy';
    lock = 1 - smoothstep(0.82, 1, (t - yEnd) / (ACT_SECONDS - yEnd));
  }
  return { x: snapCm(x), y: snapCm(y), axis, lock };
}

/* ---------- photometry ---------- */

/**
 * Point sources in cd with a cos^m distribution round their axis. The
 * linear pendant is three points along its 150 cm body; the shelf carries a
 * grazing downlight that follows it; the corner column throws an uplight.
 */
function sources(shelf) {
  const shelfX = shelf.x + SHELF.widthCm / 2;
  const down = [0, -1, 0];
  return [
    { p: [270, PENDANT_Y - 1, PENDANT_Z], i: 1100, m: 1.2, axis: down },
    { p: [320, PENDANT_Y - 1, PENDANT_Z], i: 1100, m: 1.2, axis: down },
    { p: [370, PENDANT_Y - 1, PENDANT_Z], i: 1100, m: 1.2, axis: down },
    { p: [shelfX, shelf.y - 1, 16], i: 240, m: 2.4, axis: down },
    { p: [619, 192, 21], i: 380, m: 3, axis: [0, 1, 0] },
  ];
}

const AMBIENT_LX = 14;
// Each source is a luminaire, not a point: its size keeps a surface a
// hand's width away from blowing out (r^2 + r0^2, r0 = 0.25 m).
const SOURCE_SIZE_M2 = 0.0625;

/** Illuminance in lx on a surface at `p` (cm) with unit normal `n`. */
export function illuminance(p, n, shelf = SHELF.home) {
  let e = AMBIENT_LX;
  for (const s of sources(shelf)) {
    const v = [(p[0] - s.p[0]) / 100, (p[1] - s.p[1]) / 100, (p[2] - s.p[2]) / 100];
    const r2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (r2 < 1e-4) continue;
    const r = Math.sqrt(r2);
    const cosAxis = (v[0] * s.axis[0] + v[1] * s.axis[1] + v[2] * s.axis[2]) / r;
    if (cosAxis <= 0) continue;
    const cosIn = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]) / r;
    if (cosIn <= 0) continue;
    e += (s.i * cosAxis ** s.m * cosIn) / (r2 + SOURCE_SIZE_M2);
  }
  return e;
}

/** Vertical illuminance at the 165 cm eye, facing `headingDeg` (0 north, 90 east). */
export function eyeIlluminance(headingDeg) {
  const h = headingDeg * DEG;
  return illuminance(OBSERVER, [Math.sin(h), 0, -Math.cos(h)]);
}

const GRID_CM = 20;

/**
 * A lit surface sampled on a 20 cm lattice: `values[j][i]` at
 * origin + i * step along u + j * step along v.
 */
function sampleSurface(id, origin, u, v, cols, rows, normal) {
  const values = [];
  let peak = 0;
  for (let j = 0; j <= rows; j += 1) {
    const row = [];
    for (let i = 0; i <= cols; i += 1) {
      const p = [
        origin[0] + (u[0] * i + v[0] * j) * GRID_CM,
        origin[1] + (u[1] * i + v[1] * j) * GRID_CM,
        origin[2] + (u[2] * i + v[2] * j) * GRID_CM,
      ];
      const e = illuminance(p, normal);
      row.push(e);
      if (e > peak) peak = e;
    }
    values.push(row);
  }
  const point = (i, j, lift = 0.6) => [
    origin[0] + (u[0] * i + v[0] * j) * GRID_CM + normal[0] * lift,
    origin[1] + (u[1] * i + v[1] * j) * GRID_CM + normal[1] * lift,
    origin[2] + (u[2] * i + v[2] * j) * GRID_CM + normal[2] * lift,
  ];
  return { id, cols, rows, values, peak, point, normal };
}

/**
 * Marching squares on a sampled surface. Returns segments in lattice
 * coordinates [[i0, j0], [i1, j1]]; saddles split on the cell centre value.
 */
export function isoSegments(values, level) {
  const segments = [];
  const rows = values.length - 1;
  const cols = values[0].length - 1;
  const lerp = (a, b) => (level - a) / (b - a);
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const a = values[j][i];
      const b = values[j][i + 1];
      const c = values[j + 1][i + 1];
      const d = values[j + 1][i];
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = [i + lerp(a, b), j];
      const right = [i + 1, j + lerp(b, c)];
      const bottom = [i + lerp(d, c), j + 1];
      const left = [i, j + lerp(a, d)];
      const centreHigh = (a + b + c + d) / 4 >= level;
      switch (code) {
        case 1:
        case 14:
          segments.push([left, bottom]);
          break;
        case 2:
        case 13:
          segments.push([bottom, right]);
          break;
        case 3:
        case 12:
          segments.push([left, right]);
          break;
        case 4:
        case 11:
          segments.push([top, right]);
          break;
        case 6:
        case 9:
          segments.push([top, bottom]);
          break;
        case 7:
        case 8:
          segments.push([left, top]);
          break;
        case 5:
          if (centreHigh) segments.push([left, top], [bottom, right]);
          else segments.push([left, bottom], [top, right]);
          break;
        case 10:
          if (centreHigh) segments.push([left, bottom], [top, right]);
          else segments.push([left, top], [bottom, right]);
          break;
        default:
          break;
      }
    }
  }
  return segments;
}

/**
 * Where a floor ring is labelled: on its innermost crossing of a bearing
 * west-south-west of the pendant, clear of the platform, so the three
 * labels step out along one diagonal.
 */
const LABEL_BEARING = 150 * DEG;
function labelAnchor(segments) {
  let best = null;
  let bestRadius = Infinity;
  for (const [a, b] of segments) {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const dx = mid[0] - (PENDANT.x0 + PENDANT.x1) / 2;
    const dz = mid[2] - PENDANT.z;
    const off = Math.abs(angleDelta(Math.atan2(dz, dx) / DEG, LABEL_BEARING / DEG));
    const radius = Math.hypot(dx, dz);
    if (off < 14 && radius < bestRadius) {
      best = mid;
      bestRadius = radius;
    }
  }
  return best;
}

/**
 * The photometric field the Iso-Lux act paints: floor and four walls,
 * computed once, with iso-line segments per level already lifted to 3D.
 */
export function buildLuxField() {
  const cols = W / GRID_CM;
  const deep = D / GRID_CM;
  const tall = H / GRID_CM;
  const surfaces = [
    sampleSurface('floor', [0, 0, 0], [1, 0, 0], [0, 0, 1], cols, deep, [0, 1, 0]),
    sampleSurface('north', [0, 0, 0], [1, 0, 0], [0, 1, 0], cols, tall, [0, 0, 1]),
    sampleSurface('east', [W, 0, 0], [0, 0, 1], [0, 1, 0], deep, tall, [-1, 0, 0]),
    sampleSurface('south', [0, 0, D], [1, 0, 0], [0, 1, 0], cols, tall, [0, 0, -1]),
    sampleSurface('west', [0, 0, 0], [0, 0, 1], [0, 1, 0], deep, tall, [1, 0, 0]),
  ];
  let peak = 0;
  for (const surface of surfaces) {
    peak = Math.max(peak, surface.peak);
    surface.contours = ISO_LEVELS.map((level) => ({
      level,
      segments: isoSegments(surface.values, level).map(([a, b]) => [surface.point(a[0], a[1], 1.2), surface.point(b[0], b[1], 1.2)]),
    }));
    surface.labels = surface.contours.map(({ level, segments }) => ({ level, anchor: labelAnchor(segments) }));
  }
  return { surfaces, peak, gridCm: GRID_CM };
}

/* ---------- 24V daisy chain ---------- */

/** Bus runs as polylines, each with the distance from the driver to its start. */
function busRun(points, offset) {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) lengths.push(lengths[i - 1] + Math.hypot(...sub(points[i], points[i - 1])));
  return { points, lengths, total: lengths[lengths.length - 1], offset };
}

export function busRuns(shelf) {
  const feedX = shelf.x + SHELF.widthCm / 2;
  const track = busRun([[18, H - 2, 14], [W - 18, H - 2, 14]], 0);
  return [
    track,
    busRun([[feedX, H - 2, 14], [feedX, H - 2, 3], [feedX, shelf.y + SHELF.thickCm, 3]], feedX - 18),
    busRun([[320, H - 2, 14], [320, H - 2, PENDANT_Z], [320, PENDANT_Y + 6, PENDANT_Z]], 302),
    busRun([[W - 18, H - 2, 14], [619, H - 2, 21], [619, 192, 21]], W - 36),
  ];
}

export const TRACK = Object.freeze([[18, H - 1, 14], [W - 18, H - 1, 14]]);

export function pointOnRun(run, s) {
  const { points, lengths } = run;
  for (let i = 1; i < points.length; i += 1) {
    if (s <= lengths[i]) {
      const k = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
      const a = points[i - 1];
      const b = points[i];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return points[points.length - 1];
}

/* ---------- eye-level frustum ---------- */

/** Distance along `dir` from a point inside the room to the first wall, floor or ceiling. */
export function rayToRoom(p, dir) {
  let t = Infinity;
  const bounds = [W, H, D];
  for (let k = 0; k < 3; k += 1) {
    if (dir[k] > 1e-9) t = Math.min(t, (bounds[k] - p[k]) / dir[k]);
    else if (dir[k] < -1e-9) t = Math.min(t, -p[k] / dir[k]);
  }
  return t;
}

/**
 * The 78 deg eye-level lens as a ring of rays round the image rectangle,
 * each landed on the room shell, plus the centre ray.
 */
export function eyeFrustum(headingDeg, fovDeg = EYE_FOV_DEG, aspect = 1.5, perEdge = 6) {
  const h = headingDeg * DEG;
  const fwd = [Math.sin(h), 0, -Math.cos(h)];
  const right = [Math.cos(h), 0, Math.sin(h)];
  const tx = Math.tan((fovDeg * DEG) / 2);
  const ty = tx / aspect;
  const land = (x, y) => {
    const dir = norm([fwd[0] + right[0] * x, y, fwd[2] + right[2] * x]);
    const t = rayToRoom(OBSERVER, dir);
    return [OBSERVER[0] + dir[0] * t, OBSERVER[1] + dir[1] * t, OBSERVER[2] + dir[2] * t];
  };
  const ring = [];
  for (let k = 0; k < perEdge; k += 1) ring.push(land(-tx + (2 * tx * k) / perEdge, ty));
  for (let k = 0; k < perEdge; k += 1) ring.push(land(tx, ty - (2 * ty * k) / perEdge));
  for (let k = 0; k < perEdge; k += 1) ring.push(land(tx - (2 * tx * k) / perEdge, -ty));
  for (let k = 0; k < perEdge; k += 1) ring.push(land(-tx, -ty + (2 * ty * k) / perEdge));
  return { ring, centre: land(0, 0), corners: [ring[0], ring[perEdge], ring[2 * perEdge], ring[3 * perEdge]] };
}

/** Lens heading over one act: north, a swing east, back through north and out west. */
export function eyeHeading(t) {
  return 82 * Math.sin((2 * Math.PI * t) / ACT_SECONDS);
}

/* ---------- choreography ---------- */

/**
 * Camera target for an act at act time `t` (seconds, looping) and act age
 * `age` (seconds since the act took the stage). `spin` is the accumulated
 * orbit yaw, so the orbit keeps turning through a held act.
 */
export function actCamera(act, t, age, spin) {
  const wave = (period) => Math.sin((2 * Math.PI * t) / period);
  switch (act) {
    case 'inside':
      return {
        yaw: -16 + 10 * wave(ACT_SECONDS),
        pitch: 32 - 6 * easeInOut(age / 3),
        dist: 720 + 240 * (1 - easeInOut(age / 3)),
        tx: OBSERVER[0],
        ty: 135,
        tz: OBSERVER[2] - 70,
        fov: 48,
      };
    case 'gizmo':
      return { yaw: -12 + 6 * wave(ACT_SECONDS * 2), pitch: 15, dist: 620, tx: 230, ty: 150, tz: 40, fov: 44 };
    case 'isolux':
      return { yaw: spin, pitch: 57, dist: 1160, tx: W / 2, ty: 20, tz: D / 2, fov: 40 };
    default:
      return {
        yaw: spin,
        pitch: orbitPitch(t),
        dist: 1220,
        tx: W / 2,
        ty: 70,
        tz: D / 2,
        fov: 40,
      };
  }
}

/** The orbit's pitch swell over one act: ORBIT_PITCH.min, up to max at mid-act, and back. */
export function orbitPitch(t) {
  const mid = (ORBIT_PITCH.min + ORBIT_PITCH.max) / 2;
  const swing = (ORBIT_PITCH.max - ORBIT_PITCH.min) / 2;
  return mid - swing * Math.cos((2 * Math.PI * t) / ACT_SECONDS);
}

/** Yaw rate each act feeds into the shared spin accumulator. */
export function actSpinRate(act) {
  if (act === 'orbit') return ORBIT_DEG_PER_S;
  if (act === 'isolux') return 9;
  return 0;
}
