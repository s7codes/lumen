import { HERO_FRAME } from './hero-scenes.js';
import { XRAY_ACOUSTICS, XRAY_BUS, XRAY_EYE, XRAY_ROOM, XRAY_VIEWBOX } from './xray-figures.js';

export { XRAY_ACOUSTICS, XRAY_BUS, XRAY_EYE, XRAY_FRAME, XRAY_LAYOUT, XRAY_ROOM, XRAY_VIEWBOX } from './xray-figures.js';

/*
 * 03 / 3D Spatial Studio X-ray: the warm hero photograph and its 1:20 CAD
 * elevation, drawn in one registration.
 *
 * The photograph (public/media/hero/warm-2560.webp) is a path-traced render
 * of scripts/media/studio/src/scenes/hero.js, taken from an architectural
 * stand: level, 4.75 m off the north wall at x 3.95 m, eye 1.38 m, a 41 deg
 * vertical field on a 16:9 frame and a rising front that centres 1.50 m
 * (pt.js archCamera). Every line of the blueprint is a point of that scene
 * pushed through the same camera into the same 2560 x 1440 frame, so each
 * fixture's CAD outline lands on its own photographed edges, at any size and
 * any crop that treats both layers alike.
 *
 * Units: metres in the room frame (x along the north wall from the west
 * corner, y up from the finished floor, z out of the wall toward the camera,
 * the planner's own wall frame), frame pixels in the drawing. The parts are
 * the planner's parametric records (room-scene.js), the furniture and the
 * track are the render's; tests/spatial-studio-editorial.spec.js reads every
 * figure back against both sources and against the photograph itself.
 *
 * Pure and framework-free, and no planner engine is imported: the stage
 * loads this module as its own chunk once it comes near the viewport. The
 * electrical, acoustic and walkthrough figures (src/lib/xray-figures.js,
 * re-exported here) are the engines' own results for this room.
 */

const W = HERO_FRAME.width;
const H = HERO_FRAME.height;

/** The stand the hero stills were rendered from. */
export const XRAY_CAMERA = Object.freeze({
  position: Object.freeze([3.95, 1.38, 4.75]),
  look: Object.freeze([3.95, 1.5, 0]),
  fovV: 41,
  aspect: 16 / 9,
});

const [EYE_X, EYE_Y, EYE_Z] = XRAY_CAMERA.position;
const P11 = 1 / Math.tan((XRAY_CAMERA.fovV * Math.PI) / 360);
const P00 = P11 / XRAY_CAMERA.aspect;
// The rising front: the lens shift that centres the look point without tilting the verticals.
const SHIFT = ((XRAY_CAMERA.look[1] - EYE_Y) / Math.hypot(XRAY_CAMERA.look[0] - EYE_X, XRAY_CAMERA.look[2] - EYE_Z)) * P11;

/**
 * A room point to frame pixels (origin top left). The stand looks straight
 * down -z with no yaw, so a plane parallel to the wall maps at one scale.
 */
export function projectPoint([x, y, z]) {
  const depth = EYE_Z - z;
  const nx = (P00 * (x - EYE_X)) / depth;
  const ny = (P11 * (y - EYE_Y)) / depth - SHIFT;
  return [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
}

/** Frame pixels per metre on a plane `z` metres out from the wall. */
export function planeScale(z) {
  return (P00 * W) / 2 / (EYE_Z - z);
}

/* ---------- the room as rendered ---------- */

const ROOM_W = XRAY_ROOM.widthCm / 100;
const ROOM_H = XRAY_ROOM.heightCm / 100;

/** Honed limestone on the north wall: a 4 mm backing and 30 mm slabs, 1200 x 600 in running bond. */
export const XRAY_ASHLAR = Object.freeze({ faceZ: 0.034, slabW: 1.2, slabH: 0.6 });
const FACE_Z = XRAY_ASHLAR.faceZ;

const box = (x0, x1, y0, y1, z0, z1) => Object.freeze({ x0, x1, y0, y1, z0, z1 });
const rod = (x, z, r, y0, y1) => Object.freeze({ x, z, r, y0, y1 });

/**
 * Every part in the photograph. The pendant, shelf and column are the
 * planner's sub-parts for linear-pendant-150 at x 385 / y 122 (re-hung 27 cm
 * off the wall), floating-shelf-110 at 548 / 152 and corner-floor-column-140
 * at 660 / 0 in this room; the console, the vessels and the track are the
 * render's own (hero.js, kit.js).
 */
export const XRAY_SCENE = Object.freeze({
  track: Object.freeze({
    x0: 0.25,
    x1: 6.6,
    z: 0.62,
    heads: Object.freeze([
      Object.freeze({ x: 3.75, aim: Object.freeze([3.75, 1.45, 0.03]) }),
      Object.freeze({ x: 4.6, aim: Object.freeze([4.6, 1.3, 0.03]) }),
      Object.freeze({ x: 5.45, aim: Object.freeze([5.6, 1.7, 0.03]) }),
    ]),
  }),
  pendant: Object.freeze({
    beam: box(3.85, 5.35, 1.232, 1.295, 0.24, 0.3),
    recess: box(3.86, 5.34, 1.224, 1.232, 0.248, 0.292),
    louverX: Object.freeze([3.9273, 4.0618, 4.1964, 4.3309, 4.4655, 4.6, 4.7345, 4.8691, 5.0036, 5.1382, 5.2727]),
    louver: Object.freeze({ w: 0.0036, y0: 1.216, y1: 1.23, z0: 0.249, z1: 0.291 }),
    cables: Object.freeze([rod(4, 0.27, 0.0012, 1.295, 2.95), rod(5.2, 0.27, 0.0012, 1.295, 2.95)]),
    feed: rod(4.6, 0.27, 0.002, 1.295, 2.95),
    grippers: Object.freeze([rod(4, 0.27, 0.007, 2.938, 2.95), rod(5.2, 0.27, 0.007, 2.938, 2.95)]),
    canopy: box(4.54, 4.66, 2.926, 2.95, 0.24, 0.32),
  }),
  shelf: Object.freeze({
    slab: box(5.48, 6.58, 1.52, 1.6, 0.008, 0.25),
    cleat: box(5.54, 6.52, 1.535, 1.585, 0, 0.036),
    channel: box(5.5, 6.56, 1.51, 1.52, 0.214, 0.246),
    books: Object.freeze([
      box(5.6, 5.84, 1.6, 1.632, 0.05, 0.22),
      box(5.615, 5.82, 1.632, 1.656, 0.065, 0.205),
      box(5.92, 5.946, 1.6, 1.83, 0.04, 0.21),
      box(5.9475, 5.9795, 1.6, 1.845, 0.04, 0.21),
      box(5.981, 6.003, 1.6, 1.82, 0.04, 0.21),
      box(6.0045, 6.0325, 1.6, 1.84, 0.04, 0.21),
    ]),
    vessel: Object.freeze({
      x: 6.36,
      y: 1.69,
      z: 0.13,
      profile: Object.freeze([
        [0.03, -0.09],
        [0.034, -0.0828],
        [0.048, -0.054],
        [0.054, -0.018],
        [0.05, 0.018],
        [0.034, 0.0504],
        [0.022, 0.0684],
        [0.025, 0.0828],
        [0.028, 0.09],
      ]),
    }),
  }),
  column: Object.freeze({
    base: rod(6.69, 0.09, 0.09, 0, 0.03),
    core: rod(6.69, 0.09, 0.065, 0.03, 1.37),
    cap: rod(6.69, 0.09, 0.07, 1.37, 1.4),
    slot: box(6.66, 6.72, 0.04, 1.34, 0.13, 0.168),
    ribs: Object.freeze([box(6.66, 6.675, 0.04, 1.34, 0.166, 0.184), box(6.705, 6.72, 0.04, 1.34, 0.166, 0.184)]),
  }),
  console: box(3.55, 6.15, 0.38, 0.46, 0.02, 0.48),
  plinth: box(3.8, 5.9, 0, 0.372, 0.07, 0.4),
  vessel: Object.freeze({ x: 5.62, y: 0.46, z: 0.26, h: 0.42, r: 0.13 }),
  bowl: Object.freeze({ x: 4.72, y: 0.46, z: 0.27, r: 0.17, h: 0.06 }),
  // The render's fixture anchors (hero.js), the points behind the hero hotspots.
  anchors: Object.freeze({
    track: Object.freeze([4.6, 2.86, 0.62]),
    pendant: Object.freeze([4.6, 1.27, 0.27]),
    shelf: Object.freeze([6.2, 1.55, 0.2]),
    column: Object.freeze([6.69, 1.2, 0.15]),
  }),
});

/** kit.js turned vessel and bowl profiles, [radius, height] as fractions of r and h. */
const VESSEL_PROFILE = Object.freeze([
  [0.55, 0],
  [0.62, 0.01 / 0.42],
  [0.95, 0.32],
  [1, 0.5],
  [0.82, 0.78],
  [0.42, 0.94],
  [0.46, 1],
]);
const BOWL_PROFILE = Object.freeze([
  [0.45, 0],
  [0.8, 0.35],
  [1, 1],
]);

/* ---------- photometry: the render's own light rig ---------- */

/**
 * The light the photograph was rendered with: three 520 lm monopoint heads
 * with a 24 deg cut-off and a 0.35 penumbra (kit.js ceilingTrack), the
 * pendant's 2450 lm and the shelf's 1150 lm downward LED channels, both
 * Lambertian (parts.js). The iso-lux field is the maintained direct light on
 * the limestone (maintenance factor 0.8, as illuminance-field.js) plus the
 * room's inter-reflected component from room-physics.js.
 */
export const XRAY_PHOTOMETRY = Object.freeze({
  grazer: Object.freeze({ lumens: 520, halfDeg: 12, penumbra: 0.35, mouth: 0.157 }),
  pendant: Object.freeze({ lumens: 2450, x0: 3.86, x1: 5.34, y: 1.2162, z: 0.27, beamDeg: 90 }),
  shelf: Object.freeze({ lumens: 1150, x0: 5.5, x1: 6.56, y: 1.5092, z: 0.23 }),
  maintenance: 0.8,
  reflectedLux: 27.1,
  levels: Object.freeze([100, 250, 500]),
});

/* ---------- path helpers ---------- */

const r1 = (n) => Math.round(n * 10) / 10;
const xy = ([u, v]) => `${r1(u)} ${r1(v)}`;

/** Closed or open path through projected 2D points. */
function path2d(points, close = false) {
  if (points.length === 0) return '';
  return `M${points.map(xy).join('L')}${close ? 'Z' : ''}`;
}

const path3d = (points, close = false) => path2d(points.map(projectPoint), close);
const line3d = (a, b) => path3d([a, b]);

/** Signed area of a 2D ring; positive is clockwise on the y-down frame. */
function ringArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/** A ring wound clockwise, so overlapping mask shapes add up under the nonzero rule. */
function clockwise(points) {
  return ringArea(points) < 0 ? [...points].reverse() : points;
}

/** Convex hull (monotone chain) of 2D points. */
function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const FACE_CORNERS = {
  front: (b) => [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]],
  top: (b) => [[b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]],
  bottom: (b) => [[b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y0, b.z0], [b.x0, b.y0, b.z0]],
  left: (b) => [[b.x0, b.y0, b.z1], [b.x0, b.y1, b.z1], [b.x0, b.y1, b.z0], [b.x0, b.y0, b.z0]],
  right: (b) => [[b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y1, b.z0], [b.x1, b.y0, b.z0]],
};

/** The faces of an axis-aligned box the stand can see. */
function visibleFaces(b) {
  const faces = ['front'];
  if (EYE_Y > b.y1) faces.push('top');
  if (EYE_Y < b.y0) faces.push('bottom');
  if (EYE_X > b.x1) faces.push('right');
  if (EYE_X < b.x0) faces.push('left');
  return faces;
}

/** Edges of a box's visible faces; `faces` overrides where another part hides one. */
function boxPath(b, faces = visibleFaces(b)) {
  return faces.map((face) => path3d(FACE_CORNERS[face](b), true)).join('');
}

function boxSilhouette(b) {
  const corners = [];
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [b.z0, b.z1]) corners.push(projectPoint([x, y, z]));
  return clockwise(hull(corners));
}

/** A horizontal circle of radius r at height y about the vertical axis (x, z), projected. */
function ring(x, y, z, r, n = 64) {
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    points.push(projectPoint([x + r * Math.cos(t), y, z + r * Math.sin(t)]));
  }
  return points;
}

/** Index of the leftmost and rightmost point of a projected ring: the silhouette tangents. */
function tangents(points) {
  let lo = 0;
  let hi = 0;
  points.forEach(([u], i) => {
    if (u < points[lo][0]) lo = i;
    if (u > points[hi][0]) hi = i;
  });
  return [lo, hi];
}

/** The near half of a projected ring, between its two tangents, through the point nearest the stand. */
function nearArc(points) {
  const [lo, hi] = tangents(points);
  const n = points.length;
  const near = Math.round(n / 4);
  const walk = (from, to, step) => {
    const out = [];
    for (let i = from; ; i = (i + step + n) % n) {
      out.push(points[i]);
      if (i === to) break;
    }
    return out;
  };
  const forward = walk(lo, hi, 1);
  const containsNear = forward.includes(points[near]);
  return containsNear ? forward : walk(lo, hi, -1);
}

/**
 * A turned solid on a vertical axis: its two silhouette chains, the near
 * arc of its foot and, below the eye, the whole rim it is seen into.
 * `profile` holds [radius, height] pairs from the foot up, in metres.
 */
function lathe(x, z, profile) {
  const rings = profile.map(([r, y]) => ring(x, y, z, Math.max(r, 1e-4)));
  const left = [];
  const right = [];
  for (const points of rings) {
    const [lo, hi] = tangents(points);
    left.push(points[lo]);
    right.push(points[hi]);
  }
  const foot = nearArc(rings[0]);
  const rimY = profile.at(-1)[1];
  const rim = rings.at(-1);
  const outline = path2d([...left, ...[...right].reverse()]);
  const d = `${outline}${path2d(foot)}${rimY < EYE_Y ? path2d(rim, true) : path2d(nearArc(rim))}`;
  return { d, silhouette: clockwise([...left, ...[...right].reverse()]) };
}

/** A vertical cylinder as a lathe with straight sides. */
function cylinder({ x, z, r, y0, y1 }) {
  return lathe(x, z, [
    [r, y0],
    [r, y1],
  ]);
}

const unit = (v) => {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
};
const add = (a, b, s = 1) => a.map((c, i) => c + b[i] * s);

/** A cylinder on an arbitrary axis from a to b: the projected quad of its silhouette. */
function tiltedCylinder(a, b, r) {
  const pa = projectPoint(a);
  const pb = projectPoint(b);
  const [dx, dy] = unit([pb[0] - pa[0], pb[1] - pa[1]]);
  const ra = r * planeScale(a[2]);
  const rb = r * planeScale(b[2]);
  const quad = [
    [pa[0] - dy * ra, pa[1] + dx * ra],
    [pb[0] - dy * rb, pb[1] + dx * rb],
    [pb[0] + dy * rb, pb[1] - dx * rb],
    [pa[0] + dy * ra, pa[1] - dx * ra],
  ];
  return { d: path2d(quad, true), silhouette: clockwise(quad) };
}

/* ---------- the track heads and their beams ---------- */

/** Each head as kit.js builds it: adapter in the slot, stem, 110 mm body, mouth and the light 2 mm past it. */
function headGeometry(head) {
  const { z } = XRAY_SCENE.track;
  const at = [head.x, ROOM_H - 0.03, z];
  const dir = unit(head.aim.map((c, i) => c - at[i]));
  return {
    at,
    dir,
    adapter: box(head.x - 0.025, head.x + 0.025, ROOM_H - 0.026, ROOM_H, z - 0.016, z + 0.016),
    stem: [add(at, dir, -0.01), add(at, dir, 0.05)],
    body: [add(at, dir, 0.045), add(at, dir, 0.155)],
    light: add(at, dir, XRAY_PHOTOMETRY.grazer.mouth),
  };
}

/** Orthonormal pair perpendicular to a unit axis. */
function basis(dir) {
  const helper = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = unit([dir[1] * helper[2] - dir[2] * helper[1], dir[2] * helper[0] - dir[0] * helper[2], dir[0] * helper[1] - dir[1] * helper[0]]);
  const e2 = [dir[1] * e1[2] - dir[2] * e1[1], dir[2] * e1[0] - dir[0] * e1[2], dir[0] * e1[1] - dir[1] * e1[0]];
  return [e1, e2];
}

/**
 * Where a head's 24 deg cut-off cone meets the limestone: the conic traced
 * by its edge rays on the wall plane, broken where a ray reaches the floor
 * first. Returns the drawn runs and the apex-to-footprint edge lines.
 */
function beamFootprint(geo) {
  const half = (XRAY_PHOTOMETRY.grazer.halfDeg * Math.PI) / 180;
  const [e1, e2] = basis(geo.dir);
  const runs = [];
  let run = [];
  const steps = 180;
  for (let i = 0; i <= steps; i += 1) {
    const phi = (i / steps) * Math.PI * 2;
    const ray = geo.dir.map((c, k) => Math.cos(half) * c + Math.sin(half) * (Math.cos(phi) * e1[k] + Math.sin(phi) * e2[k]));
    const t = ray[2] < -1e-6 ? (FACE_Z - geo.light[2]) / ray[2] : -1;
    const hit = t > 0 ? add(geo.light, ray, t) : null;
    if (hit && hit[1] >= 0 && hit[1] <= ROOM_H && hit[0] <= ROOM_W) {
      run.push(projectPoint(hit));
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  // A run that wraps past phi = 0 joins its tail to its head.
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs.at(-1);
    if (first.length && last.length && Math.hypot(first[0][0] - last.at(-1)[0], first[0][1] - last.at(-1)[1]) < 1e-6) {
      runs[0] = [...last, ...first.slice(1)];
      runs.pop();
    }
  }
  const apex = projectPoint(geo.light);
  const points = runs.flat();
  // The cone's silhouette in the frame: the footprint points at the extreme bearings from the apex.
  let lo = points[0];
  let hi = points[0];
  let loA = Infinity;
  let hiA = -Infinity;
  for (const p of points) {
    const a = Math.atan2(p[0] - apex[0], p[1] - apex[1]);
    if (a < loA) [loA, lo] = [a, p];
    if (a > hiA) [hiA, hi] = [a, p];
  }
  return { runs, apex, edges: [lo, hi], bearings: [loA, hiA] };
}

/** A short arc about `c` from bearing a0 to a1 (radians from straight down, clockwise toward +u). */
function arcPath(c, radius, a0, a1, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([c[0] + radius * Math.sin(a), c[1] + radius * Math.cos(a)]);
  }
  return path2d(pts);
}

/* ---------- illuminance on the limestone ---------- */

const smoothstep = (lo, hi, x) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

let rig = null;

/** Point sources of the rig: the heads with their spot law, the two LED channels split into Lambertian segments. */
export function xrayLuxSources() {
  rig ??= luxSources();
  return rig;
}

function luxSources() {
  const { grazer, pendant, shelf, maintenance } = XRAY_PHOTOMETRY;
  const half = (grazer.halfDeg * Math.PI) / 180;
  const coneCos = Math.cos(half);
  const penumbraCos = Math.cos(half * (1 - grazer.penumbra));
  const peak = grazer.lumens / (2 * Math.PI * (1 - coneCos));
  const spots = XRAY_SCENE.track.heads.map((head) => {
    const geo = headGeometry(head);
    return { p: geo.light, dir: geo.dir, cd: peak * maintenance, coneCos, penumbraCos };
  });
  const channel = ({ lumens, x0, x1, y, z }, n) =>
    Array.from({ length: n }, (_, i) => ({ p: [x0 + ((x1 - x0) * (i + 0.5)) / n, y, z], cd: (lumens / n / Math.PI) * maintenance }));
  return { spots, segments: [...channel(pendant, 16), ...channel(shelf, 12)] };
}

/** Maintained illuminance (lx) at a point on the limestone face. */
export function wallLux(sources, x, y) {
  let total = XRAY_PHOTOMETRY.reflectedLux;
  for (const s of sources.spots) {
    const dx = x - s.p[0];
    const dy = y - s.p[1];
    const dz = FACE_Z - s.p[2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cosTheta = (dx * s.dir[0] + dy * s.dir[1] + dz * s.dir[2]) / r;
    if (cosTheta <= s.coneCos) continue;
    total += (s.cd * smoothstep(s.coneCos, s.penumbraCos, cosTheta) * (-dz / r)) / (r * r);
  }
  for (const s of sources.segments) {
    // A downward emitter lights nothing above its own plane.
    const dy = y - s.p[1];
    if (dy >= 0) continue;
    const dx = x - s.p[0];
    const dz = FACE_Z - s.p[2];
    const r = Math.max(0.02, Math.sqrt(dx * dx + dy * dy + dz * dz));
    total += (s.cd * (-dy / r) * (-dz / r)) / (r * r);
  }
  return total;
}

const LUX_GRID = Object.freeze({ x0: 2.6, x1: ROOM_W, y0: 0, y1: ROOM_H, step: 0.03 });

/** Marching squares on a lux grid, chained into polylines (wall metres) per level. */
function isoLux(sources) {
  const { x0, x1, y0, y1, step } = LUX_GRID;
  const cols = Math.round((x1 - x0) / step) + 1;
  const rows = Math.round((y1 - y0) / step) + 1;
  const values = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) values[j * cols + i] = wallLux(sources, x0 + i * step, y0 + j * step);
  const at = (i, j) => values[j * cols + i];
  const X = (i) => x0 + i * step;
  const Y = (j) => y0 + j * step;

  return XRAY_PHOTOMETRY.levels.map((level) => {
    const segments = [];
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const lerp = (p, q) => (q === p ? 0.5 : (level - p) / (q - p));
        const edge = (e) => {
          if (e === 0) return [X(i) + lerp(a, b) * step, Y(j)];
          if (e === 1) return [X(i + 1), Y(j) + lerp(b, c) * step];
          if (e === 2) return [X(i) + lerp(d, c) * step, Y(j + 1)];
          return [X(i), Y(j) + lerp(a, d) * step];
        };
        const centreHigh = (a + b + c + d) / 4 >= level;
        for (const [e1, e2] of marching(code, centreHigh)) segments.push([edge(e1), edge(e2)]);
      }
    }
    return { level, lines: chain(segments) };
  });
}

// Edge pairs per corner code: edge 0 bottom (a-b), 1 right (b-c), 2 top (d-c), 3 left (a-d).
const MARCHING = [null, [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], 'saddle', [[0, 2]], [[3, 2]], [[2, 3]], [[0, 2]], 'saddle', [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], null];

function marching(code, centreHigh) {
  const pairs = MARCHING[code];
  if (pairs !== 'saddle') return pairs;
  if (code === 5) return centreHigh ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]];
  return centreHigh ? [[3, 0], [1, 2]] : [[0, 1], [3, 2]];
}

/** Joins marching-square segments that share an end into polylines. */
function chain(segments) {
  const key = ([x, y]) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`;
  const ends = new Map();
  segments.forEach(([p, q], i) => {
    for (const k of [key(p), key(q)]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(segments.length);
  const lines = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue;
    used[start] = 1;
    const line = [...segments[start]];
    for (const forward of [true, false]) {
      for (;;) {
        const tip = forward ? line.at(-1) : line[0];
        const next = (ends.get(key(tip)) ?? []).find((i) => !used[i]);
        if (next === undefined) break;
        used[next] = 1;
        const [p, q] = segments[next];
        const other = key(p) === key(tip) ? q : p;
        if (forward) line.push(other);
        else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ---------- annotation helpers ---------- */

const TICK = 14;

/** An architectural tick: a 45 deg slash through a station on a dimension line. */
const tick = ([u, v]) =>
  path2d([
    [u - TICK / 2, v + TICK / 2],
    [u + TICK / 2, v - TICK / 2],
  ]);

const wallPoint = (x, y) => projectPoint([x, y, FACE_Z]);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * Where the field on the plumb line x falls through `level` lx below its
 * brightest point between `from` and `to` (from above `to`), by bisection.
 */
function luxDrop(sources, x, from, to, level) {
  let hi = from;
  let best = wallLux(sources, x, from);
  for (let y = from; y >= to; y -= 0.01) {
    const lux = wallLux(sources, x, y);
    if (lux > best) [hi, best] = [y, lux];
  }
  let lo = to;
  if (best < level || wallLux(sources, x, lo) > level) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (hi + lo) / 2;
    if (wallLux(sources, x, mid) >= level) hi = mid;
    else lo = mid;
  }
  return (hi + lo) / 2;
}

/**
 * The 24V run in the room: each planner leg keeps its wall cm (x, y) and
 * takes the depth of what carries it. Ceiling legs ride in the track, the
 * pendant's riser drops down its feed wire, every other leg is concealed in
 * the wall plane; where a leg changes carrier a short connector joins them.
 */
function busRuns() {
  const ceiling = XRAY_ROOM.heightCm;
  const { feed } = XRAY_SCENE.pendant;
  const feedXCm = Math.round(feed.x * 100);
  const depthOf = ([x1, y1, x2, y2]) => {
    if (y1 === ceiling && y2 === ceiling) return XRAY_SCENE.track.z;
    if (x1 === x2 && x1 === feedXCm && Math.max(y1, y2) === ceiling) return feed.z;
    return 0;
  };
  const runs = [];
  let previous = null;
  for (const segment of XRAY_BUS.segments) {
    const [x1, y1, x2, y2] = segment;
    const z = depthOf(segment);
    if (previous && previous.z !== z) runs.push([[x1 / 100, y1 / 100, previous.z], [x1 / 100, y1 / 100, z]]);
    runs.push([[x1 / 100, y1 / 100, z], [x2 / 100, y2 / 100, z]]);
    previous = { z };
  }
  const nodeDepth = new Map(XRAY_BUS.nodes.map((node) => [node.uid, node.uid.startsWith('spot') ? XRAY_SCENE.track.z : node.uid === 'pendant' ? feed.z : 0]));
  const nodes = XRAY_BUS.nodes.map((node) => projectPoint([node.xCm / 100, node.yCm / 100, nodeDepth.get(node.uid)]));
  return { runs, nodes };
}

/* ---------- the drawing ---------- */

let cached = null;

/**
 * The whole blueprint as SVG path data in frame pixels, by layer, plus the
 * labels the stage sets in type over it. Memoised: one pass per page.
 *
 * Layer kinds: band, joint, heavy, part, fine, hidden, lux, beam, aim,
 * datum, tick, bus, node, hub, dim, level. Groups tie each layer and label
 * to a capability of the studio grid: envelope, eye-level, bus, exports;
 * the fixtures belong to no group and stay drawn whichever is in focus.
 * Labels carry a tier: tier 2 notes step back on narrow stages.
 */
export function buildXrayBlueprint() {
  if (cached) return cached;
  const S = XRAY_SCENE;
  const layers = [];
  const labels = [];
  const masks = [];
  const layer = (id, group, kind, d, extra = {}) => layers.push(Object.freeze({ id, group, kind, d, ...extra }));
  const label = (id, group, at, text, options = {}) =>
    labels.push(
      Object.freeze({
        id,
        group,
        x: Math.round((at[0] / W) * 10000) / 100,
        y: Math.round((at[1] / H) * 10000) / 100,
        text,
        anchor: options.anchor ?? 'start',
        baseline: options.baseline ?? 'above',
        rotate: options.rotate ?? 0,
        tier: options.tier ?? 1,
        phone: options.phone === true,
      }),
    );

  /* Envelope: the ceiling and floor planes, the limestone field and the east return. */
  const top = [wallPoint(0, ROOM_H), wallPoint(ROOM_W, ROOM_H)];
  const foot = [wallPoint(0, 0), wallPoint(ROOM_W, 0)];
  const corner = top[1][0];
  const ceilingEdge = [top[1], projectPoint([ROOM_W, ROOM_H, 2.4])];
  const floorEdge = [foot[1], projectPoint([ROOM_W, 0, 2.4])];
  layer('ceiling', 'envelope', 'band', path2d([[-W, -H], [W * 2, -H], ceilingEdge[1], ceilingEdge[0], top[0]], true));
  layer('floor', 'envelope', 'band', path2d([foot[0], foot[1], floorEdge[1], [W * 2, H * 2], [-W, H * 2]], true));
  layer('return', 'envelope', 'band', path2d([ceilingEdge[0], ceilingEdge[1], floorEdge[1], floorEdge[0]], true), { tone: 'return' });

  let joints = '';
  const { slabW, slabH } = XRAY_ASHLAR;
  for (let k = 1; k * slabH < ROOM_H - 1e-6; k += 1) joints += path2d([wallPoint(0, k * slabH), wallPoint(ROOM_W, k * slabH)]);
  for (let row = 0; row * slabH < ROOM_H - 1e-6; row += 1) {
    const y0 = row * slabH;
    const y1 = Math.min(ROOM_H, y0 + slabH);
    const offset = row % 2 ? slabW / 2 : 0;
    for (let x = slabW - offset; x < ROOM_W - 1e-6; x += slabW) joints += path2d([wallPoint(x, y0), wallPoint(x, y1)]);
  }
  layer('ashlar', 'envelope', 'joint', joints, { masked: true });
  layer('envelope', 'envelope', 'heavy', `${path2d(top)}${path2d(foot)}${path2d([top[1], foot[1]])}${path2d(ceilingEdge)}${path2d(floorEdge)}`);

  /* Track: the slot under the ceiling and three heads. */
  const { track } = S;
  const slot = box(track.x0, track.x1, ROOM_H - 0.004, ROOM_H, track.z - 0.02, track.z + 0.02);
  let parts = boxPath(slot, ['bottom']);
  let fine = '';
  const heads = track.heads.map(headGeometry);
  for (const geo of heads) {
    parts += boxPath(geo.adapter, ['front', 'bottom']);
    parts += tiltedCylinder(geo.stem[0], geo.stem[1], 0.006).d + tiltedCylinder(geo.body[0], geo.body[1], 0.031).d;
  }

  /* Pendant: beam, louvres, wires, feed and canopy. */
  const { pendant } = S;
  parts += boxPath(pendant.beam) + boxPath(pendant.recess, ['front']) + boxPath(pendant.canopy, ['front', 'bottom']);
  for (const x of pendant.louverX) {
    const { w, y0, y1, z0, z1 } = pendant.louver;
    fine += boxPath(box(x - w / 2, x + w / 2, y0, y1, z0, z1), ['front']);
  }
  for (const wire of [...pendant.cables, pendant.feed]) fine += line3d([wire.x, wire.y0, wire.z], [wire.x, wire.y1, wire.z]);
  for (const grip of pendant.grippers) parts += cylinder(grip).d;
  masks.push(boxSilhouette(pendant.beam), boxSilhouette(pendant.recess));

  /* Shelf: slab, the cleat it hangs on (hidden), the LED channel, books and a vessel. */
  const { shelf } = S;
  parts += boxPath(shelf.slab) + boxPath(shelf.channel, ['front']);
  for (const book of shelf.books) parts += boxPath(book, ['front', 'left']);
  const shelfVessel = lathe(
    shelf.vessel.x,
    shelf.vessel.z,
    shelf.vessel.profile.map(([r, dy]) => [r, shelf.vessel.y + dy]),
  );
  parts += shelfVessel.d;
  masks.push(boxSilhouette(shelf.slab), ...shelf.books.map(boxSilhouette), shelfVessel.silhouette);

  /* Column: base, core and cap with the opal slot between two ribs. */
  const { column } = S;
  for (const part of [column.base, column.core, column.cap]) {
    const c = cylinder(part);
    parts += c.d;
    masks.push(c.silhouette);
  }
  parts += boxPath(column.slot, ['front', 'left']);
  for (const rib of column.ribs) fine += boxPath(rib, ['front']);

  /* Console: travertine top on a walnut plinth, a bowl and a vessel. */
  parts += boxPath(S.console) + boxPath(S.plinth, ['front']);
  masks.push(boxSilhouette(S.console), boxSilhouette(S.plinth));
  const { vessel, bowl } = S;
  const vesselShape = lathe(
    vessel.x,
    vessel.z,
    VESSEL_PROFILE.map(([r, y]) => [r * vessel.r, vessel.y + y * vessel.h]),
  );
  const bowlShape = lathe(
    bowl.x,
    bowl.z,
    BOWL_PROFILE.map(([r, y]) => [r * bowl.r, bowl.y + y * bowl.h]),
  );
  parts += vesselShape.d + bowlShape.d;
  masks.push(vesselShape.silhouette, bowlShape.silhouette);

  layer('fixtures', null, 'part', parts);
  layer('fixtures-fine', null, 'fine', fine);
  layer('hidden', 'exports', 'hidden', boxPath(shelf.cleat, ['front']));

  /* Photometry: the iso-lux field, each head's 24 deg cone and aiming line, the pendant's beam. */
  const sources = xrayLuxSources();
  for (const { level, lines } of isoLux(sources)) {
    layer(`lux-${level}`, 'eye-level', 'lux', lines.map((points) => path2d(points.map(([x, y]) => wallPoint(x, y)))).join(''), { level, masked: true });
  }
  let beams = '';
  let aims = '';
  const CONE = 150;
  heads.forEach((geo, i) => {
    const fp = beamFootprint(geo);
    const [a0, a1] = fp.bearings;
    const ray = (a) => [fp.apex[0] + CONE * Math.sin(a), fp.apex[1] + CONE * Math.cos(a)];
    beams += path2d([ray(a0), fp.apex, ray(a1)]) + arcPath(fp.apex, CONE * 0.62, a0, a1);
    const t = (FACE_Z - geo.light[2]) / geo.dir[2];
    const aimPoint = projectPoint(add(geo.light, geo.dir, t));
    aims += path2d([ray((a0 + a1) / 2), aimPoint]);
    aims += path2d([[aimPoint[0] - 10, aimPoint[1] - 10], [aimPoint[0] + 10, aimPoint[1] + 10]]) + path2d([[aimPoint[0] - 10, aimPoint[1] + 10], [aimPoint[0] + 10, aimPoint[1] - 10]]);
    const grazer = `${2 * XRAY_PHOTOMETRY.grazer.halfDeg} DEG GRAZER`;
    if (i === 1) label('grazer', 'eye-level', [ray(a0)[0] - 12, ray(a0)[1] + 6], grazer);
    // On a phone the title block steps away, so the note moves to the open wall right of the third head.
    if (i === 2) label('grazer-phone', 'eye-level', [ray(a1)[0] + 12, ray(a1)[1] + 6], grazer, { baseline: 'center', tier: 'phone', phone: true });
  });
  const { pendant: wash } = XRAY_PHOTOMETRY;
  const washX = (wash.x0 + wash.x1) / 2;
  const centre = projectPoint([washX, wash.y, wash.z]);
  const halfBeam = (wash.beamDeg / 2) * (Math.PI / 180);
  const reach = wash.y - S.console.y1;
  const washEnds = [-1, 1].map((s) => projectPoint([washX + s * reach * Math.tan(halfBeam), S.console.y1, wash.z]));
  beams += path2d([washEnds[0], centre, washEnds[1]]) + arcPath(centre, 110, -halfBeam, halfBeam);
  layer('beams', 'eye-level', 'beam', beams);
  layer('aims', 'eye-level', 'aim', aims, { masked: true });
  label('wash', 'eye-level', [centre[0], centre[1] + 150], `${wash.beamDeg} DEG LINEAR WASH`, { anchor: 'middle', baseline: 'center', phone: true });

  // One label per iso-lux level, where the shelf's downlight falls through it on a plumb line.
  const probeX = 6.24;
  for (const level of [...XRAY_PHOTOMETRY.levels].reverse()) {
    const y = luxDrop(sources, probeX, shelf.channel.y0 - 0.02, S.console.y1 + 0.02, level);
    if (y !== null) label(`lux-${level}`, 'eye-level', wallPoint(probeX, y), `${level} LX`, { anchor: 'middle', baseline: 'center', phone: level === 500 });
  }

  /* Eye-level datum: the walkthrough horizon at 165 cm and its sightline ticks. */
  const eyeY = XRAY_EYE.eyeCm / 100;
  layer('datum', 'eye-level', 'datum', path2d([wallPoint(0, eyeY), wallPoint(ROOM_W, eyeY)]));
  const reachM = (XRAY_EYE.zCm - FACE_Z * 100) / 100;
  let ticks = '';
  let sight = null;
  for (let k = -4; k <= 4; k += 1) {
    const bearing = k * XRAY_EYE.stepDeg;
    if (Math.abs(bearing) > XRAY_EYE.fovDeg / 2) continue;
    const x = XRAY_EYE.xCm / 100 + reachM * Math.tan((bearing * Math.PI) / 180);
    if (x < 0 || x > ROOM_W) continue;
    const [u, v] = wallPoint(x, eyeY);
    const len = k === 0 ? 34 : 16;
    ticks += path2d([
      [u, v - len],
      [u, v + len],
    ]);
    if (k === 0) sight = [u, v];
    else if (Math.abs(k) <= 2) label(`sight-${bearing}`, 'eye-level', [u, v + 24], String(Math.abs(bearing)), { anchor: 'middle', baseline: 'below', tier: 2 });
  }
  layer('sightlines', 'eye-level', 'tick', ticks);
  label('datum', 'eye-level', [sight[0] - 14, sight[1] - 12], `EYE LEVEL +${XRAY_EYE.eyeCm} / FOV ${XRAY_EYE.fovDeg} DEG`, { anchor: 'end', baseline: 'above' });

  /* 24V SELV bus: the hub, the planner's run and its nodes. */
  const { hub } = XRAY_BUS;
  const hubPoint = (xCm, yCm) => projectPoint([xCm / 100, yCm / 100, 0]);
  layer('hub', 'bus', 'hub', path2d([hubPoint(hub.xCm, hub.yCm), hubPoint(hub.xCm + hub.wCm, hub.yCm), hubPoint(hub.xCm + hub.wCm, hub.yCm + hub.hCm), hubPoint(hub.xCm, hub.yCm + hub.hCm)], true));
  const bus = busRuns();
  layer('bus', 'bus', 'bus', bus.runs.map(path3d).join(''));
  const NODE = 9;
  layer('bus-nodes', 'bus', 'node', bus.nodes.map(([u, v]) => path2d([[u - NODE, v - NODE], [u + NODE, v - NODE], [u + NODE, v + NODE], [u - NODE, v + NODE]], true)).join(''));
  const hubAt = hubPoint(hub.xCm + hub.wCm / 2, hub.yCm);
  label('hub', 'bus', [hubAt[0], hubAt[1] + 16], `DRIVER NODE ${XRAY_BUS.driverW} W DALI-2`, { anchor: 'middle', baseline: 'below' });
  label('drop', 'bus', [hubAt[0], hubAt[1] + 52], `24V SELV / VOLTAGE DROP ${XRAY_BUS.dropPct.toFixed(2)}%`, { anchor: 'middle', baseline: 'below' });

  /* Envelope dimensions: the width chain on the floor, the height up the open field. */
  const chainV = foot[1][1] + 66;
  let dimsEnvelope = '';
  const stations = [0, 1.2, 2.4, 3.6, 4.8, 6.0, ROOM_W];
  const station = (x) => [wallPoint(x, 0)[0], chainV];
  dimsEnvelope += path2d([station(0), station(ROOM_W)]);
  for (const x of stations) dimsEnvelope += tick(station(x));
  dimsEnvelope += path2d([[corner, foot[1][1] + 10], [corner, chainV + 18]]);
  stations.slice(0, -1).forEach((x, i) => {
    const mid = station((x + stations[i + 1]) / 2);
    label(`w-${i}`, 'envelope', [mid[0], mid[1] - 8], String(Math.round((stations[i + 1] - x) * 100)), { anchor: 'middle', tier: 2 });
  });
  const widthAt = station(ROOM_W / 2);
  label('width', 'envelope', [widthAt[0], widthAt[1] + 12], `W ${XRAY_ROOM.widthCm} CM`, { anchor: 'middle', baseline: 'below' });
  const heightU = wallPoint(1.5, 0)[0];
  const hTop = [heightU, top[0][1]];
  const hFoot = [heightU, foot[0][1]];
  dimsEnvelope += path2d([hTop, hFoot]) + tick(hTop) + tick(hFoot);
  layer('dims-envelope', 'envelope', 'dim', dimsEnvelope);
  label('height', 'envelope', [heightU - 14, (hTop[1] + hFoot[1]) / 2], `H ${XRAY_ROOM.heightCm} CM`, { anchor: 'middle', baseline: 'above', rotate: -90 });
  label('stone', 'envelope', wallPoint(2.4, 2.1), `HONED LIMESTONE ${Math.round(slabW * 1000)} x ${Math.round(slabH * 1000)}`, { anchor: 'middle', baseline: 'center', tier: 2 });

  /* Export dimensions: the level staff on the return, the pendant drop and the column height. */
  let dimsExports = '';
  let levelMarks = '';
  const staffU = corner + 40;
  dimsExports += path2d([[staffU, top[1][1]], [staffU, foot[1][1]]]);
  // Ceiling, eye level, the shelf cleat's centre line, the column, the pendant underside, the console and the floor.
  const levels = [
    ['ceiling', ROOM_H],
    ['eye', eyeY],
    ['cleat', (shelf.cleat.y0 + shelf.cleat.y1) / 2],
    ['column', column.cap.y1],
    ['pendant', 1.22],
    ['console', S.console.y1],
    ['floor', 0],
  ];
  for (const [id, y] of levels) {
    const [, v] = wallPoint(ROOM_W, y);
    dimsExports += path2d([[corner + 6, v], [staffU + 12, v]]);
    levelMarks += path2d([[staffU - 8, v - 13], [staffU + 8, v - 13], [staffU, v]], true);
    label(`level-${id}`, 'exports', [staffU + 14, v - 3], `+${fmt(Math.round(y * 1000) / 10)}`, { baseline: 'above' });
  }

  const dropX = 5.27;
  const dropU = projectPoint([dropX, ROOM_H, pendant.beam.z1])[0];
  const dropTop = [dropU, projectPoint([dropX, ROOM_H, pendant.canopy.z1])[1]];
  const dropFoot = [dropU, projectPoint([dropX, pendant.beam.y1, pendant.beam.z1])[1]];
  dimsExports += path2d([dropTop, dropFoot]) + tick(dropTop) + tick(dropFoot);
  const dropCm = Math.round((ROOM_H - pendant.beam.y1) * 1000) / 10;
  label('pendant-drop', 'exports', [dropU + 14, (dropTop[1] + dropFoot[1]) / 2], `DROP ${fmt(dropCm)}`, { anchor: 'middle', baseline: 'below', rotate: -90 });

  const colX = column.cap.x - column.base.r - 0.05;
  const colTop = projectPoint([colX, column.cap.y1, column.cap.z]);
  const colFoot = projectPoint([colX, 0, column.cap.z]);
  dimsExports += path2d([colTop, colFoot]) + tick(colTop) + tick(colFoot);
  label('column-height', 'exports', [colTop[0] - 14, (colTop[1] + colFoot[1]) / 2], `H ${fmt(column.cap.y1 * 100)}`, { anchor: 'middle', baseline: 'above', rotate: -90 });

  /* Scale bar: 0 / 25 / 50 cm at the wall plane, in the floor band. */
  const metre = planeScale(FACE_Z);
  const barStart = [wallPoint(5.55, 0)[0], H - 20];
  const at = (k) => barStart[0] + metre * k;
  dimsExports += path2d([barStart, [at(0.5), barStart[1]]]) + path2d([[barStart[0], barStart[1] - 6], [at(0.25), barStart[1] - 6]]);
  for (const k of [0, 0.25, 0.5]) dimsExports += path2d([[at(k), barStart[1] - 10], [at(k), barStart[1] + 6]]);
  layer('dims-exports', 'exports', 'dim', dimsExports);
  layer('levels', 'exports', 'level', levelMarks);
  label('scale', 'exports', [at(0.5) + 12, barStart[1] - 2], '50 CM AT WALL PLANE', { baseline: 'center', tier: 2 });

  const mask = masks.map((points) => path2d(points, true)).join('');
  cached = Object.freeze({ viewBox: XRAY_VIEWBOX, layers: Object.freeze(layers), labels: Object.freeze(labels), mask });
  return cached;
}
