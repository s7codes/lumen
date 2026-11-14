/*
 * Lifelike product interiors for the catalog plinths. Every module is
 * modelled in centimetres in the corner of a daylight gallery room (back wall
 * on z = 0, side wall on x = 0, oak floor on y = 0) and projected through a
 * look-at pinhole camera into a 400 x 300 picture. The result is plain data:
 * gradients and ordered shapes (polygons, paths, lines, ellipses) that
 * ProductVisual renders as SVG. Pure and deterministic, so it is testable in
 * Node and identical on every load.
 *
 * Fills are colours or gradient references written '@<id>'; the component
 * resolves them to per-instance ids.
 */

export const SCENE_VIEW = Object.freeze({ width: 400, height: 300 });

const VIEW_W = SCENE_VIEW.width;
const VIEW_H = SCENE_VIEW.height;
const CEILING = 270;
const NEAR = 12;

const LIGHT = Object.freeze({ core: '#fff8ea', warm: '#ffdba0', glow: '#f5bf74' });
const ROOM_TONES = Object.freeze({
  wallTop: '#e4ddd1',
  wallBottom: '#d1c7b7',
  sideTop: '#d3cabc',
  sideBottom: '#c1b7a7',
  ceiling: '#ece7de',
  oakFar: '#c9a87e',
  oakNear: '#b08a5f',
});

/* ---------- vectors and camera ---------- */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * A pinhole camera at `eye` looking at `target`, y up. `toCamera` gives a
 * point in camera space (x right, y up, z forward), `project` the picture
 * coordinates and depth.
 */
export function lookAt({ eye, target, focal = 440 }) {
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const toCamera = (p) => {
    const d = sub(p, eye);
    return [dot(d, right), dot(d, up), dot(d, forward)];
  };
  const screen = ([x, y, z]) => [VIEW_W / 2 + (focal * x) / z, VIEW_H / 2 - (focal * y) / z];
  return Object.freeze({
    eye,
    focal,
    toCamera,
    screen,
    project(p) {
      const c = toCamera(p);
      return [...screen([c[0], c[1], Math.max(c[2], NEAR)]), c[2]];
    },
    scaleAt(p) {
      return focal / Math.max(toCamera(p)[2], NEAR);
    },
  });
}

/** Clips a polygon (camera space) to z >= NEAR, Sutherland-Hodgman. */
function clipNear(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const ina = a[2] >= NEAR;
    const inb = b[2] >= NEAR;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return out;
}

/* ---------- scene builder ---------- */

function builder(cam) {
  const shapes = [];
  const gradients = [];
  let next = 0;
  const project2 = (points) =>
    clipNear(points.map((p) => cam.toCamera(p))).map((c) => {
      const [x, y] = cam.screen(c);
      return [r1(x), r1(y)];
    });
  return {
    cam,
    shapes,
    gradients,
    /** Registers a gradient and returns its fill reference. */
    gradient(spec) {
      const id = `g${next}`;
      next += 1;
      gradients.push({ id, ...spec });
      return `@${id}`;
    },
    poly(points3d, fill, extra = {}) {
      const points = project2(points3d);
      if (points.length >= 3) shapes.push({ type: 'poly', points, fill, ...extra });
      return points;
    },
    /** A polygon already in picture coordinates. */
    flat(points, fill, extra = {}) {
      shapes.push({ type: 'poly', points: points.map(([x, y]) => [r1(x), r1(y)]), fill, ...extra });
    },
    path(d, extra) {
      shapes.push({ type: 'path', d, ...extra });
    },
    line(a, b, stroke, width = 1, extra = {}) {
      const points = project2([a, b, b]);
      if (points.length >= 2) shapes.push({ type: 'line', from: points[0], to: points[1], stroke, width, ...extra });
    },
    polyline(points3d, stroke, width = 1, extra = {}) {
      const points = points3d.map((p) => {
        const [x, y] = cam.project(p);
        return [r1(x), r1(y)];
      });
      shapes.push({ type: 'polyline', points, stroke, width, ...extra });
    },
    ellipse(cx, cy, rx, ry, fill, extra = {}) {
      shapes.push({ type: 'ellipse', cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, ...extra });
    },
    at(p) {
      const [x, y] = cam.project(p);
      return [x, y, cam.scaleAt(p)];
    },
  };
}

/** Bounding box in picture coordinates of a list of points. */
function bounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/* ---------- materials ---------- */

function mix(a, b, t) {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

/** Face tones of a finish: the top catches the daylight, the sides turn from it. */
export function finishTones(finish) {
  return {
    top: mix(finish.highlight, finish.hex, 0.35),
    front: finish.hex,
    side: mix(finish.hex, finish.shade, 0.55),
    bottom: mix(finish.hex, finish.shade, 0.75),
    grain: finish.texture === 'grain' ? mix(finish.shade, finish.hex, 0.25) : null,
    brushed: finish.texture === 'brushed',
    hi: finish.highlight,
    lo: finish.shade,
  };
}

/**
 * Draws the visible faces of an axis-aligned box. `box` is
 * { x0, x1, y0, y1, z0, z1 } in cm; `tones` gives top, front, side, bottom.
 */
function drawBox(b, box, tones, { grain = null, frontFill = null } = {}) {
  const { x0, x1, y0, y1, z0, z1 } = box;
  const e = b.cam.eye;
  const faces = {};
  if (e[0] < x0) faces.left = b.poly([[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]], tones.side);
  if (e[0] > x1) faces.right = b.poly([[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]], tones.side);
  if (e[1] < y0) faces.bottom = b.poly([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], tones.bottom);
  if (e[1] > y1) faces.top = b.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], tones.top);
  if (e[2] > z1) faces.front = b.poly([[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]], frontFill ?? tones.front);
  if (grain && faces.front) {
    // Grain runs along the longest edge of the front face, drawn in perspective.
    const along = x1 - x0 >= y1 - y0;
    const count = Math.max(3, Math.min(9, Math.round((along ? y1 - y0 : x1 - x0) / 1.4)));
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      const points = [];
      for (let k = 0; k <= 8; k += 1) {
        const s = k / 8;
        const wobble = Math.sin(s * 6.2 + i * 1.7) * 0.18;
        points.push(along ? [x0 + s * (x1 - x0), y0 + (t + wobble / (y1 - y0)) * (y1 - y0), z1] : [x0 + (t + wobble / (x1 - x0)) * (x1 - x0), y0 + s * (y1 - y0), z1]);
      }
      b.polyline(points, grain, 0.5, { opacity: 0.3 + 0.25 * ((i * 7) % 3) / 2 });
    }
  }
  return faces;
}

/** A vertical cylinder: a shaded silhouette, plus its top cap when seen from above. */
function drawCylinder(b, { cx, cz, r, y0, y1 }, fill, capFill) {
  const ring = (y) => Array.from({ length: 28 }, (_, i) => {
    const a = (i / 28) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  });
  const projected = [...ring(y0), ...ring(y1)].map((p) => b.cam.project(p));
  const hull = convexHull(projected.map(([x, y]) => [x, y]));
  b.flat(hull, fill);
  if (b.cam.eye[1] > y1 && capFill) b.poly(ring(y1), capFill);
  return bounds(hull);
}

function convexHull(points) {
  const p = [...points].sort((a, c) => a[0] - c[0] || a[1] - c[1]);
  const turn = (o, a, c) => (a[0] - o[0]) * (c[1] - o[1]) - (a[1] - o[1]) * (c[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/* ---------- the room ---------- */

/**
 * The daylight gallery corner: smooth stone walls with a crisp inside-corner
 * reveal, a ceiling when the camera looks up, oak planks running toward the
 * eye, a painted skirting with its shadow line, and a soft diagonal band of
 * window light across the back wall. No noise anywhere.
 */
function drawRoom(b, { width = 520, depth = 300, ceiling = false } = {}) {
  const wall = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, ROOM_TONES.wallTop], [1, ROOM_TONES.wallBottom]] });
  const side = b.gradient({ type: 'linear', x1: 1, y1: 0, x2: 0, y2: 1, stops: [[0, ROOM_TONES.sideTop], [1, ROOM_TONES.sideBottom]] });
  const oak = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, ROOM_TONES.oakFar], [1, ROOM_TONES.oakNear]] });
  b.poly([[0, CEILING, 0], [width, CEILING, 0], [width, 0, 0], [0, 0, 0]], wall);
  b.poly([[0, CEILING, depth], [0, CEILING, 0], [0, 0, 0], [0, 0, depth]], side);
  if (ceiling) {
    const ceil = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, '#e6e1d8'], [1, ROOM_TONES.ceiling]] });
    b.poly([[0, CEILING, depth], [width, CEILING, depth], [width, CEILING, 0], [0, CEILING, 0]], ceil);
    b.line([0, CEILING, 0], [width, CEILING, 0], '#8c7f6b', 0.7, { opacity: 0.45 });
    b.line([0, CEILING, 0], [0, CEILING, depth], '#8c7f6b', 0.7, { opacity: 0.35 });
  }
  // Window light: a soft diagonal band sliding down the back wall from the right.
  const sun = b.gradient({
    type: 'linear',
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [[0, '#fffdf8', 0], [0.3, '#fffdf8', 0.42], [0.7, '#fffdf8', 0.28], [1, '#fffdf8', 0]],
  });
  b.poly([[150, CEILING, 0], [300, CEILING, 0], [190, 0, 0], [40, 0, 0]], sun);
  b.poly([[330, CEILING, 0], [390, CEILING, 0], [280, 0, 0], [220, 0, 0]], sun, { opacity: 0.6 });
  // Oak floor with planks toward the eye and staggered end joints.
  b.poly([[0, 0, 0], [width, 0, 0], [width, 0, depth], [0, 0, depth]], oak);
  for (let x = 16; x < width; x += 16) b.line([x, 0, 0], [x, 0, depth], '#6f4f30', 0.5, { opacity: 0.26 });
  for (let x = 0, row = 0; x < width; x += 16, row += 1) {
    for (let z = 40 + ((row * 53) % 90); z < depth; z += 120) b.line([x, 0, z], [x + 16, 0, z], '#6f4f30', 0.45, { opacity: 0.2 });
  }
  const sheen = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, '#fff8ec', 0], [0.55, '#fff8ec', 0.2], [1, '#fff8ec', 0]] });
  b.poly([[100, 0, 0], [240, 0, 0], [300, 0, depth], [120, 0, depth]], sheen);
  // Skirting on both walls and the shadow line it lays on the oak.
  b.poly([[0, 8, 1.4], [width, 8, 1.4], [width, 0, 1.4], [0, 0, 1.4]], '#ece7de');
  b.line([0, 8, 1.4], [width, 8, 1.4], '#ffffff', 0.6, { opacity: 0.7 });
  b.poly([[1.4, 8, depth], [1.4, 8, 1.4], [1.4, 0, 1.4], [1.4, 0, depth]], '#ddd6ca');
  b.poly([[0, 0, 1.4], [width, 0, 1.4], [width, 0, 4.5], [0, 0, 4.5]], '#5b4631', { opacity: 0.18 });
  // The inside corner: a crisp line and a short band of occlusion either side.
  const ao = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, '#4a3c2c', 0.22], [1, '#4a3c2c', 0]] });
  b.poly([[0, CEILING, 0], [22, CEILING, 0], [22, 0, 0], [0, 0, 0]], ao);
  b.line([0, CEILING, 0], [0, 0, 0], '#6d5d49', 0.8, { opacity: 0.5 });
}

/* ---------- light ---------- */

/** A trapezoidal wash down (dir 1) or up (dir -1) a wall plane z = zWall. */
function wallWash(b, { x0, x1, y, reach, spread, z = 0.2, dir = 1, strength = 1 }) {
  const yEnd = y - dir * reach;
  const top = b.at([(x0 + x1) / 2, y, z]);
  const end = b.at([(x0 + x1) / 2, yEnd, z]);
  const fill = b.gradient({
    type: 'linear',
    units: 'user',
    x1: top[0],
    y1: top[1],
    x2: end[0],
    y2: end[1],
    stops: [[0, LIGHT.core, strength], [0.16, LIGHT.warm, 0.88 * strength], [0.58, LIGHT.glow, 0.48 * strength], [1, LIGHT.glow, 0]],
  });
  b.poly([[x0, y, z], [x1, y, z], [x1 + spread, yEnd, z], [x0 - spread, yEnd, z]], fill);
}

/** A soft halo on a wall around a rectangle, for back-lit and perimeter-lit parts. */
function wallHalo(b, { x0, x1, y0, y1, pad, z = 0.2, strength = 1 }) {
  const fill = b.gradient({ type: 'radial', stops: [[0, LIGHT.core, Math.min(1, strength)], [0.5, LIGHT.warm, 0.7 * strength], [0.78, LIGHT.glow, 0.34 * strength], [1, LIGHT.glow, 0]] });
  b.poly([[x0 - pad, y1 + pad, z], [x1 + pad, y1 + pad, z], [x1 + pad, y0 - pad, z], [x0 - pad, y0 - pad, z]], fill);
}

/** A soft shadow on the back wall, offset down and to the left of a wall-mounted part. */
function wallShadow(b, { x0, x1, y0, y1, drop = 6, z = 0.15, strength = 1 }) {
  const fill = b.gradient({ type: 'radial', stops: [[0, '#2e2318', 0.32 * strength], [0.6, '#2e2318', 0.14 * strength], [1, '#2e2318', 0]] });
  b.poly([[x0 - drop * 1.4, y1 - drop * 0.4, z], [x1 + drop * 0.2, y1 - drop * 0.4, z], [x1 + drop * 0.2, y0 - drop * 1.6, z], [x0 - drop * 1.4, y0 - drop * 1.6, z]], fill);
}

/** A soft contact shadow on the floor round a footprint. */
function floorShadow(b, { x0, x1, z0, z1, pad = 6, strength = 1 }) {
  const fill = b.gradient({ type: 'radial', stops: [[0, '#2e2318', 0.36 * strength], [0.6, '#2e2318', 0.16 * strength], [1, '#2e2318', 0]] });
  b.poly([[x0 - pad, 0.1, z0 - pad], [x1 + pad, 0.1, z0 - pad], [x1 + pad, 0.1, z1 + pad], [x0 - pad, 0.1, z1 + pad]], fill);
}

/** A glowing LED line between two points. */
function ledLine(b, a, c, width = 1.6) {
  b.line(a, c, LIGHT.glow, width * 2.6, { opacity: 0.35, cap: 'round' });
  b.line(a, c, LIGHT.core, width, { cap: 'round' });
}

/* ---------- styling objects ---------- */

function vase(b, base, heightCm, fill) {
  const [x, y, s] = b.at(base);
  const w = (cm) => cm * s;
  const h = heightCm;
  const d = `M${r1(x - w(3.6))} ${r1(y)}C${r1(x - w(8.5))} ${r1(y - w(h * 0.25))} ${r1(x - w(7.6))} ${r1(y - w(h * 0.66))} ${r1(x - w(2.6))} ${r1(y - w(h * 0.86))}L${r1(x - w(2.2))} ${r1(y - w(h))}L${r1(x + w(2.2))} ${r1(y - w(h))}L${r1(x + w(2.6))} ${r1(y - w(h * 0.86))}C${r1(x + w(7.6))} ${r1(y - w(h * 0.66))} ${r1(x + w(8.5))} ${r1(y - w(h * 0.25))} ${r1(x + w(3.6))} ${r1(y)}Z`;
  b.ellipse(x + w(2.4), y, w(8), w(1.6), '#2e2318', { opacity: 0.22 });
  const shade = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, mix(fill, '#6f6558', 0.4)], [0.38, mix(fill, '#ffffff', 0.35)], [1, mix(fill, '#5a5146', 0.5)]] });
  b.path(d, { fill: shade });
}

const BOOK_TONES = Object.freeze([
  { top: '#e7ddca', front: '#d4c8b0', side: '#bcae93' },
  { top: '#c27d53', front: '#a9673f', side: '#8c5333' },
  { top: '#4a4b4f', front: '#2c2d30', side: '#1e1f21' },
  { top: '#b8b9a6', front: '#9d9f8a', side: '#828470' },
]);

function books(b, { x, y, z0, z1, list }) {
  let cursor = x;
  for (const [i, { w, h, lying }] of list.entries()) {
    const tones = BOOK_TONES[i % BOOK_TONES.length];
    if (lying) {
      drawBox(b, { x0: cursor, x1: cursor + w, y0: y + lying.y0, y1: y + lying.y1, z0, z1 }, tones);
    } else {
      drawBox(b, { x0: cursor, x1: cursor + w, y0: y, y1: y + h, z0: z0 + 1, z1: z1 - 1 }, tones);
      cursor += w;
    }
  }
}

/* ---------- the modules ---------- */

function shelfScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 70, x1: 70 + w, y0: 118 - h, y1: 118, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 95, 172, 238], target: [cx - 6, 92, 8] }));
  drawRoom(b);
  wallWash(b, { x0: box.x0 + 6, x1: box.x1 - 6, y: box.y0, reach: box.y0 - 6, spread: 26 });
  wallShadow(b, { ...box, drop: 4, strength: 0.7 });
  drawBox(b, box, tones, { grain: tones.grain });
  ledLine(b, [box.x0 + 4, box.y0 - 0.1, d - 3], [box.x1 - 4, box.y0 - 0.1, d - 3], 1.3);
  books(b, { x: box.x0 + 12, y: box.y1, z0: 3, z1: 21, list: [{ w: 3.2, h: 26 }, { w: 2.6, h: 23 }, { w: 3.6, h: 28 }] });
  books(b, { x: box.x0 + 44, y: box.y1, z0: 4, z1: 22, list: [{ w: 28, lying: { y0: 0, y1: 3.2 } }, { w: 24, lying: { y0: 3.2, y1: 5.6 } }] });
  vase(b, [box.x1 - 18, box.y1, d * 0.5], 24, '#d9d2c6');
  return b;
}

function cubeScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const t = 1.8;
  const box = { x0: 88, x1: 88 + w, y0: 104, y1: 104 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 78, 160, 162], target: [cx - 4, box.y0 + h * 0.42, 12] }));
  drawRoom(b);
  wallShadow(b, { ...box, drop: 5, strength: 0.8 });
  // Outer shell, then the open front: rims round a lit interior.
  drawBox(b, { ...box, z1: d - 0.01 }, tones);
  const inner = { x0: box.x0 + t, x1: box.x1 - t, y0: box.y0 + t, y1: box.y1 - t };
  const interior = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, mix(tones.side, '#000000', 0.25)], [1, mix(tones.side, '#000000', 0.05)]] });
  b.poly([[inner.x0, inner.y1, t], [inner.x1, inner.y1, t], [inner.x1, inner.y0, t], [inner.x0, inner.y0, t]], interior);
  b.poly([[inner.x0, inner.y0, t], [inner.x1, inner.y0, t], [inner.x1, inner.y0, d], [inner.x0, inner.y0, d]], tones.top);
  b.poly([[inner.x0, inner.y1, d], [inner.x0, inner.y1, t], [inner.x0, inner.y0, t], [inner.x0, inner.y0, d]], mix(tones.side, '#000000', 0.15));
  b.poly([[inner.x1, inner.y1, t], [inner.x1, inner.y1, d], [inner.x1, inner.y0, d], [inner.x1, inner.y0, t]], tones.front);
  // The downlight fills the box with warm light and pools on its floor.
  const pool = b.gradient({ type: 'radial', stops: [[0, LIGHT.core, 0.9], [0.6, LIGHT.warm, 0.5], [1, LIGHT.glow, 0.1]] });
  b.poly([[inner.x0, inner.y0 + 0.05, t], [inner.x1, inner.y0 + 0.05, t], [inner.x1, inner.y0 + 0.05, d], [inner.x0, inner.y0 + 0.05, d]], pool);
  const glow = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, LIGHT.warm, 0.7], [1, LIGHT.glow, 0.05]] });
  b.poly([[inner.x0, inner.y1, t], [inner.x1, inner.y1, t], [inner.x1, inner.y0, t], [inner.x0, inner.y0, t]], glow);
  books(b, { x: inner.x0 + 4, y: inner.y0, z0: 6, z1: 24, list: [{ w: 3, h: 24 }, { w: 2.6, h: 21 }, { w: 3.4, h: 25 }] });
  vase(b, [inner.x1 - 9, inner.y0, d * 0.55], 16, '#cfc6b8');
  ledLine(b, [inner.x0 + 1.5, inner.y1 - 0.2, d - 3], [inner.x1 - 1.5, inner.y1 - 0.2, d - 3], 1.1);
  // Front rims: the panel edges in the finish.
  const rim = (pts) => b.poly(pts, tones.top);
  rim([[box.x0, box.y1, d], [box.x1, box.y1, d], [box.x1, inner.y1, d], [box.x0, inner.y1, d]]);
  rim([[box.x0, inner.y0, d], [box.x1, inner.y0, d], [box.x1, box.y0, d], [box.x0, box.y0, d]]);
  rim([[box.x0, inner.y1, d], [inner.x0, inner.y1, d], [inner.x0, inner.y0, d], [box.x0, inner.y0, d]]);
  rim([[inner.x1, inner.y1, d], [box.x1, inner.y1, d], [box.x1, inner.y0, d], [inner.x1, inner.y0, d]]);
  return b;
}

function sideboardScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 66, x1: 66 + w, y0: 34, y1: 34 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 92, 138, 236], target: [cx - 4, 58, 14] }));
  drawRoom(b);
  // Under-glow onto the floor and up the wall behind, then the cast shadow.
  wallWash(b, { x0: box.x0 + 4, x1: box.x1 - 4, y: box.y0, reach: box.y0, spread: 14, strength: 0.9 });
  const spill = b.gradient({ type: 'radial', stops: [[0, LIGHT.warm, 0.7], [0.6, LIGHT.glow, 0.3], [1, LIGHT.glow, 0]] });
  b.poly([[box.x0 - 14, 0.2, 0], [box.x1 + 14, 0.2, 0], [box.x1 + 14, 0.2, d + 20], [box.x0 - 14, 0.2, d + 20]], spill);
  wallShadow(b, { ...box, drop: 3, strength: 0.5 });
  const faces = drawBox(b, box, tones, { grain: tones.grain });
  // Two doors: a centre joint and a shadow gap under the top.
  if (faces.front) {
    b.line([(box.x0 + box.x1) / 2, box.y1 - 1.2, d + 0.05], [(box.x0 + box.x1) / 2, box.y0 + 1.2, d + 0.05], tones.lo, 0.9, { opacity: 0.7 });
    b.line([box.x0 + 1, box.y1 - 2.4, d + 0.05], [box.x1 - 1, box.y1 - 2.4, d + 0.05], tones.lo, 0.8, { opacity: 0.55 });
  }
  ledLine(b, [box.x0 + 4, box.y0 - 0.1, d - 4], [box.x1 - 4, box.y0 - 0.1, d - 4], 1.2);
  vase(b, [box.x0 + 16, box.y1, d * 0.5], 30, '#d4cbbd');
  books(b, { x: box.x1 - 36, y: box.y1, z0: 6, z1: 26, list: [{ w: 26, lying: { y0: 0, y1: 3 } }, { w: 22, lying: { y0: 3, y1: 5.4 } }] });
  return b;
}

function lightbarScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 76, x1: 76 + w, y0: 176, y1: 176 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 74, 146, 232], target: [cx - 4, 138, 0] }));
  drawRoom(b);
  // An artwork below the bar, lit by it: a calm canvas in a slim oak frame.
  const art = { x0: cx - 24, x1: cx + 24, y0: 106, y1: 164 };
  wallShadow(b, { ...art, drop: 3, strength: 0.6 });
  drawBox(b, { ...art, z0: 0, z1: 3 }, { top: '#d8c3a0', front: '#c4a57c', side: '#9c7f5a', bottom: '#8c7052' });
  const canvasFill = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, '#d9cdb8'], [0.55, '#c9b89d'], [1, '#b49d7c']] });
  b.poly([[art.x0 + 3, art.y1 - 3, 3.05], [art.x1 - 3, art.y1 - 3, 3.05], [art.x1 - 3, art.y0 + 3, 3.05], [art.x0 + 3, art.y0 + 3, 3.05]], canvasFill);
  b.poly([[art.x0 + 9, art.y1 - 14, 3.1], [art.x1 - 16, art.y1 - 14, 3.1], [art.x1 - 16, art.y0 + 20, 3.1], [art.x0 + 9, art.y0 + 20, 3.1]], '#8f6f4c', { opacity: 0.55 });
  wallWash(b, { x0: box.x0 + 1, x1: box.x1 - 1, y: box.y0, reach: 120, spread: 30 });
  wallWash(b, { x0: box.x0 + 6, x1: box.x1 - 6, y: box.y1, reach: 34, spread: 10, dir: -1, strength: 0.5 });
  wallShadow(b, { ...box, drop: 2, strength: 0.4 });
  drawBox(b, box, tones);
  ledLine(b, [box.x0 + 1.5, box.y0 - 0.1, d - 1.5], [box.x1 - 1.5, box.y0 - 0.1, d - 1.5], 1.4);
  return b;
}

function columnScene(product, tones) {
  const { w, h } = product.dimsCm;
  const r = w / 2;
  const col = { cx: r + 4, cz: r + 4, r, y0: 1.2, y1: h };
  const b = builder(lookAt({ eye: [170, 128, 252], target: [36, 74, 36] }));
  drawRoom(b);
  // The column throws light up and across both meeting walls: each wall
  // glows brightest at the corner and falls off away from it.
  const glowStops = (strength) => [[0, LIGHT.core, strength], [0.3, LIGHT.warm, 0.82 * strength], [0.62, LIGHT.glow, 0.38 * strength], [1, LIGHT.glow, 0]];
  const backGlow = b.gradient({ type: 'radial', cx: 0.12, cy: 0.5, r: 0.9, stops: glowStops(1) });
  const sideGlow = b.gradient({ type: 'radial', cx: 0.88, cy: 0.5, r: 0.9, stops: glowStops(0.85) });
  b.poly([[0, h + 90, 0.2], [col.cx + 120, h + 90, 0.2], [col.cx + 120, -10, 0.2], [0, -10, 0.2]], backGlow);
  b.poly([[0.2, h + 90, col.cz + 110], [0.2, h + 90, 0], [0.2, -10, 0], [0.2, -10, col.cz + 110]], sideGlow);
  floorShadow(b, { x0: col.cx - r, x1: col.cx + r, z0: col.cz - r, z1: col.cz + r, pad: 10 });
  // Baseplate on the oak, then the anodized cylinder and its diffuser slot.
  drawCylinder(b, { cx: col.cx, cz: col.cz, r: r + 3, y0: 0, y1: 1.2 }, tones.side, tones.top);
  const shell = drawCylinderShaded(b, col, tones);
  const slot = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, LIGHT.core], [0.5, LIGHT.warm], [1, LIGHT.core]] });
  const front = (y) => [col.cx + Math.cos(0.9) * (r + 0.1), y, col.cz + Math.sin(0.9) * (r + 0.1)];
  const front2 = (y) => [col.cx + Math.cos(1.35) * (r + 0.1), y, col.cz + Math.sin(1.35) * (r + 0.1)];
  b.poly([front(h - 6), front2(h - 6), front2(8), front(8)], slot);
  b.line(front(h - 6), front(8), LIGHT.glow, 3, { opacity: 0.3 });
  return { ...b, shell };
}

/** A metallic cylinder: silhouette filled with a cylindrical reflection ramp. */
function drawCylinderShaded(b, col, tones) {
  const silhouette = (() => {
    const ring = (y) => Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [col.cx + Math.cos(a) * col.r, y, col.cz + Math.sin(a) * col.r];
    });
    return convexHull([...ring(col.y0), ...ring(col.y1)].map((p) => b.cam.project(p).slice(0, 2)));
  })();
  const box = bounds(silhouette);
  const ramp = b.gradient({
    type: 'linear',
    units: 'user',
    x1: box.x0,
    y1: 0,
    x2: box.x1,
    y2: 0,
    stops: [[0, tones.lo], [0.18, tones.side], [0.34, tones.hi], [0.46, tones.front], [0.8, tones.lo], [0.93, tones.side], [1, tones.lo]],
  });
  b.flat(silhouette, ramp);
  if (b.cam.eye[1] > col.y1) {
    const cap = Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [col.cx + Math.cos(a) * col.r, col.y1, col.cz + Math.sin(a) * col.r];
    });
    b.poly(cap, tones.top);
  }
  return box;
}

function spotScene(product, tones) {
  const canopy = { x: 112, z: 46 };
  const b = builder(lookAt({ eye: [204, 140, 262], target: [106, 196, 18] }));
  drawRoom(b, { ceiling: true });
  // A small print on the wall that the spot picks out in a crisp oval.
  const art = { x0: 92, x1: 132, y0: 132, y1: 182 };
  wallShadow(b, { ...art, drop: 3, strength: 0.5 });
  drawBox(b, { ...art, z0: 0, z1: 2.4 }, { top: '#2d2b29', front: '#232120', side: '#141312', bottom: '#141312' });
  b.poly([[art.x0 + 2.5, art.y1 - 2.5, 2.45], [art.x1 - 2.5, art.y1 - 2.5, 2.45], [art.x1 - 2.5, art.y0 + 2.5, 2.45], [art.x0 + 2.5, art.y0 + 2.5, 2.45]], '#e9e2d4');
  b.poly([[art.x0 + 9, art.y1 - 12, 2.5], [art.x1 - 9, art.y1 - 12, 2.5], [art.x1 - 9, art.y0 + 12, 2.5], [art.x0 + 9, art.y0 + 12, 2.5]], '#b08a63', { opacity: 0.6 });
  // The beam: a sharp cone from the head to an oval on the wall.
  const head = [canopy.x, CEILING - 15, canopy.z - 3];
  const hit = [(art.x0 + art.x1) / 2, (art.y0 + art.y1) / 2, 0.3];
  const [hx, hy] = b.at(head);
  const [px, py, ps] = b.at(hit);
  const rx = 34 * ps;
  const ry = 40 * ps;
  const beam = b.gradient({ type: 'linear', units: 'user', x1: hx, y1: hy, x2: px, y2: py, stops: [[0, LIGHT.core, 0.7], [1, LIGHT.warm, 0.18]] });
  b.flat([[hx - 3, hy], [hx + 3, hy], [px + rx, py], [px - rx, py]], beam);
  const pool = b.gradient({ type: 'radial', stops: [[0, LIGHT.core, 0.95], [0.7, LIGHT.warm, 0.62], [0.94, LIGHT.glow, 0.4], [1, LIGHT.glow, 0]] });
  b.ellipse(px, py, rx, ry, pool);
  // Canopy flush on the ceiling, a slim stem and the aimed cylinder head.
  drawCylinder(b, { cx: canopy.x, cz: canopy.z, r: 5, y0: CEILING - 1.4, y1: CEILING }, tones.bottom, tones.top);
  b.line([canopy.x, CEILING - 1.4, canopy.z], [canopy.x, CEILING - 7, canopy.z], tones.lo, 1.6);
  const [ax, ay, as] = b.at([canopy.x, CEILING - 8, canopy.z]);
  const len = product.dimsCm.h * as;
  const rad = (product.dimsCm.w / 2) * as;
  const angle = Math.atan2(px - ax, py - ay);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rot = (u, v) => [ax + u * cos + v * sin, ay - u * sin + v * cos];
  const shell = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, tones.lo], [0.35, tones.hi], [0.6, tones.front], [1, tones.lo]] });
  b.flat([rot(-rad, 0), rot(rad, 0), rot(rad, len), rot(-rad, len)], shell);
  const [lx, ly] = rot(0, len);
  b.ellipse(lx, ly, rad * 0.9, rad * 0.32, LIGHT.core);
  b.ellipse(lx, ly, rad * 2.4, rad * 1.4, LIGHT.warm, { opacity: 0.35 });
  return b;
}

function frameScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 86, x1: 86 + w, y0: 96, y1: 96 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 70, 146, 196], target: [cx - 4, box.y0 + h * 0.48, 0] }));
  drawRoom(b);
  // The perimeter LED lays a warm halo on the wall round the frame.
  wallHalo(b, { ...box, pad: 26, strength: 1.2 });
  wallShadow(b, { ...box, drop: 5, strength: 0.75 });
  drawBox(b, { ...box, z1: d - 0.01 }, tones);
  // Mitred frame faces in perspective: lit top and right, shaded bottom and left.
  const t = 4.2;
  const f = d;
  const outer = { tl: [box.x0, box.y1, f], tr: [box.x1, box.y1, f], br: [box.x1, box.y0, f], bl: [box.x0, box.y0, f] };
  const inner = { tl: [box.x0 + t, box.y1 - t, f], tr: [box.x1 - t, box.y1 - t, f], br: [box.x1 - t, box.y0 + t, f], bl: [box.x0 + t, box.y0 + t, f] };
  b.poly([outer.tl, outer.tr, inner.tr, inner.tl], tones.top);
  b.poly([outer.tr, outer.br, inner.br, inner.tr], tones.front);
  b.poly([outer.br, outer.bl, inner.bl, inner.br], tones.bottom);
  b.poly([outer.bl, outer.tl, inner.tl, inner.bl], tones.side);
  for (const [a, c] of [
    [outer.tl, inner.tl],
    [outer.tr, inner.tr],
    [outer.br, inner.br],
    [outer.bl, inner.bl],
  ]) b.line(a, c, tones.lo, 0.6, { opacity: 0.6 });
  // Recessed felt with vertical slats.
  const felt = { x0: box.x0 + t, x1: box.x1 - t, y0: box.y0 + t, y1: box.y1 - t, z: f - 1.4 };
  const feltFill = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [[0, '#5a554e'], [1, '#423e39']] });
  b.poly([[felt.x0, felt.y1, felt.z], [felt.x1, felt.y1, felt.z], [felt.x1, felt.y0, felt.z], [felt.x0, felt.y0, felt.z]], feltFill);
  const slats = 9;
  for (let i = 1; i < slats; i += 1) {
    const x = felt.x0 + ((felt.x1 - felt.x0) * i) / slats;
    b.line([x, felt.y1, felt.z + 0.05], [x, felt.y0, felt.z + 0.05], '#2a2723', 1.1, { opacity: 0.85 });
    b.line([x + 0.6, felt.y1, felt.z + 0.05], [x + 0.6, felt.y0, felt.z + 0.05], '#767067', 0.5, { opacity: 0.55 });
  }
  b.poly([[felt.x0, felt.y1, felt.z], [felt.x1, felt.y1, felt.z], [felt.x1, felt.y1 - 2.5, felt.z], [felt.x0, felt.y1 - 2.5, felt.z]], '#000000', { opacity: 0.2 });
  return b;
}

function trackScene(product, tones) {
  const { w } = product.dimsCm;
  const z = 64;
  const x0 = 40;
  const x1 = x0 + w;
  const b = builder(lookAt({ eye: [x1 + 40, 150, 300], target: [x0 + w * 0.42, 236, z] }));
  drawRoom(b, { width: 640, depth: 420, ceiling: true });
  // The recessed channel: a dark slot with its anodized lips and two copper
  // 24V conductors, closed by end caps; the bus is passive, the room is lit.
  const lip = 1.6;
  b.poly([[x0 - lip, CEILING - 0.05, z - 3 - lip], [x1 + lip, CEILING - 0.05, z - 3 - lip], [x1 + lip, CEILING - 0.05, z + 3 + lip], [x0 - lip, CEILING - 0.05, z + 3 + lip]], tones.top);
  b.poly([[x0, CEILING - 0.1, z - 3], [x1, CEILING - 0.1, z - 3], [x1, CEILING - 0.1, z + 3], [x0, CEILING - 0.1, z + 3]], '#151413');
  for (const dz of [-1.2, 1.2]) b.line([x0 + 1, CEILING - 0.2, z + dz], [x1 - 1, CEILING - 0.2, z + dz], '#c98a52', 1, { opacity: 0.9 });
  b.line([x0, CEILING - 0.15, z + 3], [x1, CEILING - 0.15, z + 3], tones.hi, 0.7, { opacity: 0.7 });
  for (const x of [x0, x1]) b.poly([[x - 0.1, CEILING - 0.12, z - 3], [x + 0.1, CEILING - 0.12, z - 3], [x + 0.1, CEILING - 0.12, z + 3], [x - 0.1, CEILING - 0.12, z + 3]], tones.lo);
  // Mounting anchors along the run.
  const n = Math.max(2, product.mountingPoints);
  for (let i = 0; i < n; i += 1) {
    const ax = x0 + 6 + ((w - 12) * i) / (n - 1);
    const [px, py, s] = b.at([ax, CEILING - 0.2, z]);
    b.ellipse(px, py, 1.1 * s, 0.5 * s, '#8a8580', { opacity: 0.85 });
  }
  return b;
}

function pendantScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const z = 92;
  const box = { x0: 52, x1: 52 + w, y0: 172, y1: 172 + h * 0.4, z0: z - d / 2, z1: z + d / 2 };
  const table = { x0: box.x0 - 10, x1: box.x1 + 10, y0: 71, y1: 75, z0: z - 34, z1: z + 34 };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 96, 146, z + 252], target: [cx - 8, 122, z - 24] }));
  drawRoom(b, { ceiling: true });
  // Oak table beneath: two slab legs, then the top lit by the pendant.
  floorShadow(b, { x0: table.x0 + 10, x1: table.x1 - 10, z0: table.z0 + 4, z1: table.z1 - 4, pad: 16, strength: 0.8 });
  const oak = { top: '#d8bd97', front: '#c4a57c', side: '#a38459', bottom: '#8c7052' };
  for (const lx of [table.x0 + 10, table.x1 - 16]) drawBox(b, { x0: lx, x1: lx + 6, y0: 0, y1: table.y0, z0: table.z0 + 6, z1: table.z1 - 6 }, oak);
  drawBox(b, table, oak, { grain: '#a3845e' });
  const [tx, ty, ts] = b.at([cx, table.y1, z + 6]);
  const pool = b.gradient({ type: 'radial', stops: [[0, LIGHT.core, 1], [0.45, LIGHT.warm, 0.75], [1, LIGHT.glow, 0]] });
  b.ellipse(tx, ty, (w / 2 + 18) * ts, 26 * ts, pool);
  // The volumetric cone from the diffuser to the table.
  const beam = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, LIGHT.core, 0.7], [1, LIGHT.warm, 0.2]] });
  b.poly([[box.x0 + 2, box.y0, z], [box.x1 - 2, box.y0, z], [box.x1 + 16, table.y1 + 0.2, z + 6], [box.x0 - 16, table.y1 + 0.2, z + 6]], beam);
  // Cables to two canopies, then the anodized body with its lit diffuser.
  for (const x of [box.x0 + 16, box.x1 - 16]) {
    b.line([x, CEILING, z], [x, box.y1, z], '#2a2826', 0.7, { opacity: 0.85 });
    drawCylinder(b, { cx: x, cz: z, r: 3.2, y0: CEILING - 1, y1: CEILING }, tones.bottom, tones.top);
  }
  drawBox(b, box, { ...tones, bottom: LIGHT.core });
  return b;
}

function baffleScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 60, x1: 60 + w, y0: 116, y1: 116 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 96, 156, 236], target: [cx - 6, box.y0 + h * 0.4, 0] }));
  drawRoom(b);
  wallShadow(b, { ...box, drop: 5, strength: 0.75 });
  const felt = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, '#68625a'], [1, '#4d4842']] });
  drawBox(b, box, { top: tones.top, front: felt, side: '#3f3b36', bottom: '#3a3631' });
  const grooves = 12;
  for (let i = 1; i < grooves; i += 1) {
    const x = box.x0 + (w * i) / grooves;
    b.line([x, box.y1, d + 0.05], [x, box.y0, d + 0.05], '#2d2a26', 1.1, { opacity: 0.85 });
    b.line([x + 0.7, box.y1, d + 0.05], [x + 0.7, box.y0, d + 0.05], '#857e74', 0.5, { opacity: 0.5 });
  }
  // A slim frame in the finish closes the felt on all four sides.
  const e = 1.6;
  for (const pts of [
    [[box.x0, box.y1, d + 0.1], [box.x1, box.y1, d + 0.1], [box.x1, box.y1 - e, d + 0.1], [box.x0, box.y1 - e, d + 0.1]],
    [[box.x0, box.y0 + e, d + 0.1], [box.x1, box.y0 + e, d + 0.1], [box.x1, box.y0, d + 0.1], [box.x0, box.y0, d + 0.1]],
    [[box.x0, box.y1, d + 0.1], [box.x0 + e, box.y1, d + 0.1], [box.x0 + e, box.y0, d + 0.1], [box.x0, box.y0, d + 0.1]],
    [[box.x1 - e, box.y1, d + 0.1], [box.x1, box.y1, d + 0.1], [box.x1, box.y0, d + 0.1], [box.x1 - e, box.y0, d + 0.1]],
  ]) b.poly(pts, tones.front);
  return b;
}

function sconceScene(product, tones) {
  const { w, h, d } = product.dimsCm;
  const box = { x0: 100, x1: 100 + w, y0: 104, y1: 104 + h, z0: 0, z1: d };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 74, 150, 214], target: [cx - 6, box.y0 + h * 0.5, 0] }));
  drawRoom(b);
  wallWash(b, { x0: box.x0 + 1, x1: box.x1 - 1, y: box.y1, reach: CEILING - box.y1 - 4, spread: 30, dir: -1 });
  wallWash(b, { x0: box.x0 + 1, x1: box.x1 - 1, y: box.y0, reach: box.y0 - 10, spread: 36 });
  wallShadow(b, { ...box, drop: 3, strength: 0.6 });
  drawBox(b, box, tones);
  const slot = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 0, y2: 1, stops: [[0, LIGHT.core], [0.5, LIGHT.warm], [1, LIGHT.core]] });
  b.poly([[box.x0 + w * 0.3, box.y1 - 2, d + 0.05], [box.x1 - w * 0.3, box.y1 - 2, d + 0.05], [box.x1 - w * 0.3, box.y0 + 2, d + 0.05], [box.x0 + w * 0.3, box.y0 + 2, d + 0.05]], slot);
  ledLine(b, [box.x0 + 1.5, box.y1 + 0.1, d - 1.5], [box.x1 - 1.5, box.y1 + 0.1, d - 1.5], 1);
  ledLine(b, [box.x0 + 1.5, box.y0 - 0.1, d - 1.5], [box.x1 - 1.5, box.y0 - 0.1, d - 1.5], 1);
  return b;
}

function hubScene(product, tones) {
  const { w, h } = product.dimsCm;
  const box = { x0: 70, x1: 70 + w, y0: 100, y1: 100 + h };
  const cx = (box.x0 + box.x1) / 2;
  const b = builder(lookAt({ eye: [cx + 50, 128, 128], target: [cx - 4, box.y0 + 2, 0] }));
  drawRoom(b);
  // Flush in the plaster: a shadow gap, the anodized plate, five 24V ports
  // and the DALI-2 bus line across it.
  const gap = 0.8;
  b.poly([[box.x0 - gap, box.y1 + gap, 0.05], [box.x1 + gap, box.y1 + gap, 0.05], [box.x1 + gap, box.y0 - gap, 0.05], [box.x0 - gap, box.y0 - gap, 0.05]], '#3a322a', { opacity: 0.55 });
  const plate = b.gradient({ type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, tones.side], [0.4, tones.hi], [1, tones.front]] });
  b.poly([[box.x0, box.y1, 0.1], [box.x1, box.y1, 0.1], [box.x1, box.y0, 0.1], [box.x0, box.y0, 0.1]], plate);
  b.line([box.x0 + 2, (box.y0 + box.y1) / 2, 0.15], [box.x1 - 2, (box.y0 + box.y1) / 2, 0.15], '#c98a52', 0.7, { opacity: 0.8 });
  for (let i = 0; i < 5; i += 1) {
    const x = box.x0 + w * (0.14 + i * 0.18);
    const [px, py, s] = b.at([x, (box.y0 + box.y1) / 2, 0.2]);
    b.ellipse(px, py, 1.5 * s, 1.5 * s, '#121110');
    b.ellipse(px - 0.3 * s, py - 0.3 * s, 0.5 * s, 0.5 * s, '#5d5853');
  }
  return b;
}

const SCENES = Object.freeze({
  shelf: shelfScene,
  cube: cubeScene,
  sideboard: sideboardScene,
  lightbar: lightbarScene,
  column: columnScene,
  spot: spotScene,
  frame: frameScene,
  track: trackScene,
  pendant: pendantScene,
  baffle: baffleScene,
  sconce: sconceScene,
  hub: hubScene,
});

export const PRODUCT_SCENE_SHAPES = Object.freeze(Object.keys(SCENES));

/**
 * The interior for one product in one finish: { gradients, shapes, lit }.
 * Unknown shapes fall back to the shelf room so a new part never renders a void.
 */
export function buildProductScene(product, finish) {
  const tones = finishTones(finish);
  const scene = (SCENES[product.shape] ?? shelfScene)(product, tones);
  return { gradients: scene.gradients, shapes: scene.shapes, lit: product.watts > 0 };
}
