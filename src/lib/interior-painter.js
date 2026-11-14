import { conePath } from './hero-scenes.js';

/*
 * Explore the Lumen home: three portrait (3:4) interiors drawn as smooth
 * architectural vectors. One-point perspective rooms in warm plaster over
 * oak boards, lit by daylight and warm 2700K Lumen luminaires. Pure: room
 * numbers in, SVG path data and gradient stops out. No canvas, no noise,
 * no grain and no filters: every surface is a crisp polygon under a smooth
 * gradient, and the light itself is the texture.
 *
 * Room coordinates: X 0-1 from the left wall to the right wall, Y 0-1 from
 * floor to ceiling, z 0-1 from the back wall to the picture plane. The
 * picture plane is wider than the frame, so the portrait crops a real room
 * rather than a tall narrow box.
 */

export const INTERIOR_VIEW = Object.freeze({ width: 600, height: 800 });

export const INTERIOR_SCENES = Object.freeze({
  dining: Object.freeze({ id: 'dining', label: 'Dining & Living' }),
  bedroom: Object.freeze({ id: 'bedroom', label: 'Bedroom Sanctuary' }),
  studio: Object.freeze({ id: 'studio', label: 'Studio Wall' }),
});

export const INTERIOR_SCENE_IDS = Object.freeze(Object.keys(INTERIOR_SCENES));

/**
 * Perspective for one portrait: eye at `horizon` of the room height. `shift`
 * slides the picture plane sideways (a fraction of the frame width), so a
 * composition can favour one side wall without moving the eye off centre.
 */
export function createRoom(width, height, { vpx = 0.48, horizon = 0.46, depth = 0.5, spread = 0.36, shift = 0 } = {}) {
  const front = { x0: (shift - spread) * width, x1: width * (1 + spread + shift), y0: -0.04 * height, y1: height };
  const fw = front.x1 - front.x0;
  const fh = front.y1 - front.y0;
  const vp = [width * vpx, front.y1 - horizon * fh];
  const c = depth / (1 - depth);
  const project = (X, Y, z) => {
    const k = c / (1 + c - z);
    return [vp[0] + (front.x0 + X * fw - vp[0]) * k, vp[1] + (front.y1 - Y * fh - vp[1]) * k];
  };
  return { width, height, vp, project, eyeX: (vp[0] - front.x0) / fw, eyeY: horizon, depth };
}

/* ---------- vector kit ---------- */

const r1 = (v) => Math.round(v * 10) / 10;

export function polygonPath(points) {
  return `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;
}

function polylinePath(points) {
  return `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}`;
}

function ellipsePath(cx, cy, rx, ry) {
  const a = `A${r1(rx)} ${r1(ry)} 0 1 0`;
  return `M${r1(cx - rx)} ${r1(cy)}${a} ${r1(cx + rx)} ${r1(cy)}${a} ${r1(cx - rx)} ${r1(cy)}Z`;
}

/** A turned vessel standing on (x, foot), its mouth at `mouth`: a full shoulder on a narrow foot. */
function vesselPath(x, foot, mouth, half) {
  const h = foot - mouth;
  const pts = [
    `M${r1(x - half * 0.62)} ${r1(foot)}`,
    `C${r1(x - half * 1.3)} ${r1(foot - h * 0.42)} ${r1(x - half * 1.05)} ${r1(mouth + h * 0.16)} ${r1(x - half * 0.4)} ${r1(mouth)}`,
    `L${r1(x + half * 0.4)} ${r1(mouth)}`,
    `C${r1(x + half * 1.05)} ${r1(mouth + h * 0.16)} ${r1(x + half * 1.3)} ${r1(foot - h * 0.42)} ${r1(x + half * 0.62)} ${r1(foot)}Z`,
  ];
  return pts.join('');
}

/**
 * One drawing: gradients, clip paths and shapes in painter's order. A paint
 * is a hex colour or the id of a gradient in the same drawing. 'box'
 * gradients span each shape's own bounds, so one material serves every face
 * that wears it; 'user' gradients sit in frame coordinates, where the light is.
 */
function drawing(room) {
  const defs = [];
  const shapes = [];
  const seen = new Set();
  const define = (def) => {
    if (!seen.has(def.id)) {
      seen.add(def.id);
      defs.push(Object.freeze(def));
    }
    return def.id;
  };
  const P = room.project;
  const face = (corners) => polygonPath(corners.map(([X, Y, z]) => P(X, Y, z)));
  return {
    room,
    P,
    face,
    material: (id, [x1, y1, x2, y2], stops) => define({ type: 'linear', id, units: 'box', x1, y1, x2, y2, stops }),
    linear: (id, [x1, y1], [x2, y2], stops) => define({ type: 'linear', id, units: 'user', x1, y1, x2, y2, stops }),
    radial: (id, [cx, cy], r, stops, squash = 1) => define({ type: 'radial', id, units: 'user', cx, cy, r, squash, stops }),
    clip: (id, d) => define({ type: 'clip', id, d }),
    fill(d, paint, extra) {
      shapes.push(Object.freeze({ d, paint, ...extra }));
    },
    stroke(d, color, width, opacity = 1, extra) {
      shapes.push(Object.freeze({ d, paint: 'none', stroke: color, width, strokeOpacity: opacity, ...extra }));
    },
    finish(glow) {
      return Object.freeze({ defs: Object.freeze(defs), shapes: Object.freeze(shapes), glow: Object.freeze(glow) });
    },
  };
}

/** A box seen from the eye: the faces that turn toward it, back to front. */
function box(dr, { x0, x1, y0, y1, z0, z1 }, tones) {
  const { room, face, fill } = dr;
  if (y1 < room.eyeY && tones.top) fill(face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]), tones.top);
  if (y0 > room.eyeY && tones.bottom) fill(face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]), tones.bottom);
  if (x0 > room.eyeX && tones.side) fill(face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]]), tones.side);
  if (x1 < room.eyeX && tones.side) fill(face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]), tones.side);
  fill(face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]), tones.front);
}

/* ---------- materials and light ---------- */

// 2700K: a white-hot source falling into amber. Daylight stays a warm white.
const HOT = '#fff6e8';
const WARM = '#ffe2b4';
const AMBER = '#f7c27e';
const DAY = '#fbf8f2';

function materials(dr) {
  return {
    walnut: {
      top: dr.material('walnut-top', [0, 0, 1, 0], [[0, '#7b5638'], [0.5, '#8a6343'], [1, '#76523a']]),
      front: dr.material('walnut-front', [0, 0, 1, 0], [[0, '#5d3e29'], [0.45, '#6d4a31'], [1, '#583a27']]),
      side: dr.material('walnut-side', [0, 0, 1, 0], [[0, '#4a3121'], [1, '#3f2a1c']]),
      bottom: '#352419',
    },
    oak: {
      top: dr.material('oak-top', [0, 0, 1, 0], [[0, '#d4ae80'], [0.5, '#dbb88b'], [1, '#cfa878']]),
      front: dr.material('oak-front', [0, 0, 1, 0], [[0, '#b48b5e'], [0.5, '#bf966a'], [1, '#ad8459']]),
      side: dr.material('oak-side', [0, 0, 1, 0], [[0, '#9b754c'], [1, '#8c6943']]),
      bottom: '#7a5b3b',
    },
    anodized: {
      top: '#4a4743',
      front: dr.material('anodized', [0, 0, 0, 1], [[0, '#3b3935'], [0.5, '#262422'], [1, '#171614']]),
      side: '#1c1b19',
      bottom: '#121110',
    },
  };
}

/** A soft pool of light inside a polygon: the shape clips the falloff, so its edge stays crisp. */
function glowIn(dr, id, d, [cx, cy], r, stops, squash = 1) {
  dr.fill(d, dr.radial(id, [cx, cy], r, stops, squash));
}

const POOL = (alpha) => [
  [0, HOT, alpha],
  [0.32, WARM, alpha * 0.62],
  [0.7, AMBER, alpha * 0.18],
  [1, AMBER, 0],
];

/**
 * The scallop a wall light throws along flat plaster (a hyperbola: a cone
 * cut parallel to its axis), drawn as a crisp outer halo, the cone and its
 * hot core, each under a gradient that falls off along the reach.
 */
function wallWash(dr, id, { x, y0, dir, reach, halfWidth, knee, strength = 1 }) {
  const y1 = y0 + dir * reach;
  const layers = [
    ['halo', 1.5, [[0, WARM, 0.3 * strength], [0.5, AMBER, 0.12 * strength], [1, AMBER, 0]]],
    ['cone', 1, [[0, HOT, 0.92 * strength], [0.2, WARM, 0.62 * strength], [0.62, AMBER, 0.22 * strength], [1, AMBER, 0]]],
    ['core', 0.5, [[0, '#ffffff', 0.85 * strength], [0.35, HOT, 0.4 * strength], [1, HOT, 0]]],
  ];
  for (const [name, spread, stops] of layers) {
    const paint = dr.linear(`${id}-${name}`, [x, y0], [x, y1], stops);
    dr.fill(conePath({ x, y0, dir, reach, halfWidth: halfWidth * spread, knee: knee * spread }), paint);
  }
}

/**
 * The band an LED strip under a shelf lays on the plaster: a crisp trapezoid
 * a little wider than the shelf, hot at the strip and gone a hand below.
 */
function shelfWash(dr, id, { x0, x1, y, depth = 0.12, flare = 0.03, strength = 1 }) {
  const { P, fill, linear } = dr;
  const band = [P(x0 + 0.012, y, 0), P(x1 - 0.012, y, 0), P(x1 + flare, y - depth, 0), P(x0 - flare, y - depth, 0)];
  fill(polygonPath(band), linear(id, [0, band[0][1]], [0, band[3][1]], [[0, HOT, 0.88 * strength], [0.18, WARM, 0.58 * strength], [0.6, AMBER, 0.18 * strength], [1, AMBER, 0]]));
}

/** A contact shadow on the oak round a footprint: dark where the piece meets the floor, gone at the edge. */
function contactShadow(dr, id, { x0, x1, z0, z1 }, strength = 0.3) {
  const { P, face, radial } = dr;
  const pad = 0.025;
  const mx = (x0 + x1) / 2;
  const mz = (z0 + z1) / 2;
  const [cx, cy] = P(mx, 0, mz);
  const half = (P(x1 + pad, 0, mz)[0] - P(x0 - pad, 0, mz)[0]) / 2;
  const deep = (P(mx, 0, z1 + pad)[1] - P(mx, 0, z0 - pad)[1]) / 2;
  dr.fill(
    face([[x0 - pad, 0, z0 - pad], [x1 + pad, 0, z0 - pad], [x1 + pad, 0, z1 + pad], [x0 - pad, 0, z1 + pad]]),
    radial(id, [cx, cy], half, [[0, '#3a2716', strength], [0.72, '#3a2716', strength * 0.55], [1, '#3a2716', 0]], Math.max(0.05, deep / half)),
  );
}

/* ---------- the shell ---------- */

// Plank tones: a fixed, gentle rhythm, so sawn oak reads as boards and never as grain.
const PLANK_TONES = [0.05, -0.03, 0.02, -0.05, 0.035, -0.015, 0.045, -0.04, 0.01, -0.025];
const PLANK_JOINTS = [0.18, 0.62, 0.34, 0.86, 0.08, 0.5, 0.74, 0.27, 0.95, 0.42];

/** Ceiling, three plaster walls, an oak floor with its boards, skirting and corner shade. */
function shell(dr, tones, { boards = 14 } = {}) {
  const { P, face, fill, stroke, linear } = dr;
  const { width, height } = dr.room;
  const backTop = P(0, 1, 0)[1];
  const backFoot = P(0, 0, 0)[1];
  const leftX = P(0, 0, 0)[0];
  const rightX = P(1, 0, 0)[0];

  fill(face([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]), linear('ceiling', [0, backTop], [0, 0], [[0, tones.ceiling[0]], [1, tones.ceiling[1]]]));
  fill(face([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]), linear('back', [0, backTop], [0, backFoot], [[0, tones.wall[0]], [0.55, tones.wall[1]], [1, tones.wall[2] ?? tones.wall[1]]]));
  fill(face([[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]), linear('left', [leftX, 0], [Math.min(0, leftX - width * 0.4), 0], [[0, tones.side[0]], [1, tones.side[1]]]));
  fill(face([[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]), linear('right', [rightX, 0], [Math.max(width, rightX + width * 0.4), 0], [[0, tones.side[0]], [1, tones.side[1]]]));

  // Oak boards converging on the eye, each with its own quiet tone, butt joints staggered.
  const floor = face([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]);
  fill(floor, linear('floor', [0, backFoot], [0, height], [[0, tones.floor[0]], [1, tones.floor[1]]]));
  for (let i = 0; i < boards; i += 1) {
    const x0 = i / boards;
    const x1 = (i + 1) / boards;
    const tone = PLANK_TONES[i % PLANK_TONES.length];
    fill(face([[x0, 0, 0], [x1, 0, 0], [x1, 0, 1], [x0, 0, 1]]), tone > 0 ? '#fff4e2' : '#4a2f18', { opacity: Math.abs(tone) * 1.6 });
    if (i > 0) stroke(polylinePath([P(x0, 0, 0), P(x0, 0, 1)]), '#5a3b20', 0.7, 0.3);
    for (let z = PLANK_JOINTS[i % PLANK_JOINTS.length] * 0.5; z < 1; z += 0.46) {
      stroke(polylinePath([P(x0, 0, z), P(x1, 0, z)]), '#5a3b20', 0.6, 0.22);
    }
  }
  // A long soft sheen down the boards, where the room's light glances off the oil.
  glowIn(dr, 'floor-sheen', floor, [P(0.5, 0, 0.35)[0], P(0.5, 0, 0.35)[1]], height * 0.42, [[0, '#fff3dc', 0.22], [1, '#fff3dc', 0]], 0.42);

  // Skirting along the back wall: a pale reveal with a crisp lit top edge.
  fill(face([[0, 0, 0], [1, 0, 0], [1, 0.028, 0], [0, 0.028, 0]]), tones.skirting ?? '#efe8dc');
  stroke(polylinePath([P(0, 0.028, 0), P(1, 0.028, 0)]), '#ffffff', 0.8, 0.7);

  // Shade where the planes meet: crisp strips under smooth falloffs, never a blur.
  const shade = '#4b3826';
  fill(face([[0, 0.028, 0], [1, 0.028, 0], [1, 0.07, 0], [0, 0.07, 0]]), linear('ao-back', [0, P(0, 0.028, 0)[1]], [0, P(0, 0.07, 0)[1]], [[0, shade, 0.1], [1, shade, 0]]));
  fill(face([[0, 0, 0], [1, 0, 0], [1, 0, 0.07], [0, 0, 0.07]]), linear('ao-floor', [0, backFoot], [0, P(0, 0, 0.07)[1]], [[0, shade, 0.2], [1, shade, 0]]));
  fill(face([[0, 0, 0], [0.04, 0, 0], [0.04, 1, 0], [0, 1, 0]]), linear('ao-left', [leftX, 0], [P(0.04, 0, 0)[0], 0], [[0, shade, 0.12], [1, shade, 0]]));
  fill(face([[0.96, 0, 0], [1, 0, 0], [1, 1, 0], [0.96, 1, 0]]), linear('ao-right', [rightX, 0], [P(0.96, 0, 0)[0], 0], [[0, shade, 0.12], [1, shade, 0]]));
  fill(face([[0, 0.95, 0], [1, 0.95, 0], [1, 1, 0], [0, 1, 0]]), linear('ao-ceiling', [0, backTop], [0, P(0, 0.95, 0)[1]], [[0, shade, 0.08], [1, shade, 0]]));
  for (const seam of [
    [P(0, 0, 0), P(0, 1, 0)],
    [P(1, 0, 0), P(1, 1, 0)],
    [P(0, 1, 0), P(1, 1, 0)],
  ]) {
    stroke(polylinePath(seam), '#6f5c47', 0.8, 0.35);
  }
}

/**
 * A daylight window in a side wall, seen through its opening: the glass,
 * the lit far jamb, the soffit in shade, the sill, the frame, and the sun
 * patch it lays on the boards with the mullions' shadows in it.
 */
function windowOpening(dr, { side, z0, z1, y0, y1, sun, reveal = 0.035, strength = 1 }) {
  const { P, face, fill, stroke, linear } = dr;
  const X = side === 'left' ? 0 : 1;
  const out = side === 'left' ? -reveal : reveal;
  const into = side === 'left' ? 1 : -1;
  const hole = face([[X, y0, z0], [X, y0, z1], [X, y1, z1], [X, y1, z0]]);
  const id = `window-${side}`;
  const zm = (z0 + z1) / 2;
  const ym = y0 + (y1 - y0) * 0.68;
  // Daylight on the plaster round the opening, under the window itself.
  const mid = P(X, (y0 + y1) / 2, zm);
  glowIn(dr, `${id}-spill`, face([[X, 0, 0], [X, 1, 0], [X, 1, 1], [X, 0, 1]]), mid, dr.room.width * 0.55, [[0, '#fffaf0', 0.36 * strength], [1, '#fffaf0', 0]], 1.3);
  dr.clip(`${id}-clip`, hole);
  fill(hole, linear(`${id}-glass`, P(X + out, y1, z0), P(X + out, y0, z0), [[0, '#ffffff'], [0.55, DAY], [1, '#efe8dc']]));
  const inside = { clip: `${id}-clip` };
  fill(face([[X, y0, z0], [X + out, y0, z0], [X + out, y1, z0], [X, y1, z0]]), '#f6efe3', inside);
  fill(face([[X, y1, z0], [X + out, y1, z0], [X + out, y1, z1], [X, y1, z1]]), '#cdbfa9', inside);
  fill(face([[X, y0, z0], [X + out, y0, z0], [X + out, y0, z1], [X, y0, z1]]), '#efe6d8', inside);
  // The frame: a slim bronze mullion and transom on the glass line.
  stroke(polylinePath([P(X + out, y0, zm), P(X + out, y1, zm)]), '#6a5a48', 2.2, 0.85, inside);
  stroke(polylinePath([P(X + out, ym, z0), P(X + out, ym, z1)]), '#6a5a48', 1.8, 0.85, inside);
  stroke(hole, '#9a8a75', 1, 0.5);

  // The sun patch on the oak, the mullions' shadows crossing it.
  const [dx, dz] = sun;
  const hit = (Y, z) => P(Math.min(1, Math.max(0, X + into * Y * dx)), 0, Math.min(1, Math.max(0, z + Y * dz)));
  const patch = [hit(y0, z0), hit(y0, z1), hit(y1, z1), hit(y1, z0)];
  fill(polygonPath(patch), linear(`${id}-sun`, hit(y0, zm), hit(y1, zm), [[0, '#fffbf2', 0.42 * strength], [1, '#fffbf2', 0.16 * strength]]));
  stroke(polylinePath([hit(y0, zm), hit(y1, zm)]), '#8a6a48', 3, 0.16);
  stroke(polylinePath([hit(ym, z0), hit(ym, z1)]), '#8a6a48', 2.4, 0.14);
}

/* ---------- Dining & Living: the Room Planner ---------- */

function paintDining(dr) {
  const { P, face, fill, stroke, linear, radial } = dr;
  const m = materials(dr);
  shell(dr, {
    wall: ['#f3ece1', '#e6ddcf', '#ddd2c1'],
    side: ['#ebe2d4', '#cdbfaa'],
    ceiling: ['#f5efe6', '#e2d9ca'],
    floor: ['#cfa877', '#a37b50'],
  });
  windowOpening(dr, { side: 'left', z0: 0.16, z1: 0.66, y0: 0.1, y1: 0.86, sun: [0.52, -0.08] });

  // The pendant warms the plaster behind it before anything else is placed.
  const backWall = face([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  const [wx, wy] = P(0.5, 0.5, 0);
  glowIn(dr, 'back-glow', backWall, [wx, wy], dr.room.width * 0.46, [[0, WARM, 0.34], [0.5, AMBER, 0.12], [1, AMBER, 0]], 0.8);

  // A large framed print centred on the back wall: warm nested fields in a
  // slim walnut frame and a paper mount, framed by the pendant and the chairs.
  const print = { x0: 0.34, x1: 0.66, y0: 0.42, y1: 0.7 };
  const flat = (x0, x1, y0, y1, z) => face([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]);
  box(dr, { ...print, z0: 0, z1: 0.012 }, m.walnut);
  fill(flat(print.x0 + 0.008, print.x1 - 0.008, print.y0 + 0.01, print.y1 - 0.01, 0.012), '#f7f2e9');
  const fields = [
    [0.04, 0.05, dr.material('print-ochre', [0, 0, 0, 1], [[0, '#e3b47f'], [1, '#d39c66']])],
    [0.075, 0.085, dr.material('print-clay', [0, 0, 0, 1], [[0, '#c98a62'], [1, '#b8744d']])],
    [0.11, 0.12, dr.material('print-sand', [0, 0, 0, 1], [[0, '#f0d9b5'], [1, '#e6c899']])],
  ];
  for (const [inX, inY, paint] of fields) fill(flat(print.x0 + inX, print.x1 - inX, print.y0 + inY, print.y1 - inY * 0.8, 0.012), paint);

  // Two oak chairs beyond the table: their backs rise over the walnut top.
  for (const x of [0.38, 0.62]) {
    for (const leg of [-0.042, 0.042]) box(dr, { x0: x + leg - 0.005, x1: x + leg + 0.005, y0: 0, y1: 0.4, z0: 0.3, z1: 0.31 }, m.oak);
    box(dr, { x0: x - 0.048, x1: x + 0.048, y0: 0.3, y1: 0.4, z0: 0.3, z1: 0.312 }, m.oak);
    box(dr, { x0: x - 0.048, x1: x + 0.048, y0: 0.17, y1: 0.19, z0: 0.3, z1: 0.37 }, m.oak);
  }

  // The walnut table: four legs, then the top, lit from above.
  const top = { x0: 0.24, x1: 0.76, y0: 0.26, y1: 0.285, z0: 0.36, z1: 0.66 };
  for (const [x, z] of [
    [0.27, 0.39],
    [0.73, 0.39],
    [0.27, 0.63],
    [0.73, 0.63],
  ]) {
    box(dr, { x0: x - 0.011, x1: x + 0.011, y0: 0, y1: top.y0, z0: z - 0.014, z1: z + 0.014 }, m.walnut);
  }
  contactShadow(dr, 'table-shadow', top, 0.3);
  box(dr, top, m.walnut);
  const topFace = face([[top.x0, top.y1, top.z0], [top.x1, top.y1, top.z0], [top.x1, top.y1, top.z1], [top.x0, top.y1, top.z1]]);
  const [tcx, tcy] = P(0.5, top.y1, 0.5);
  glowIn(dr, 'table-pool', topFace, [tcx, tcy], dr.room.width * 0.32, POOL(0.85), 0.24);
  stroke(polylinePath([P(top.x0, top.y1, top.z1), P(top.x1, top.y1, top.z1)]), '#d9a877', 1.1, 0.7);

  // The linear pendant, 2700K, over the table: cables, an anodized body and
  // a lit diffuser whose beam lands on the walnut as the pool beneath it.
  const pz = 0.5;
  const lamp = { x0: 0.32, x1: 0.68, y0: 0.64, y1: 0.66, z0: pz - 0.018, z1: pz + 0.018 };
  const ceilingHalo = face([[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]);
  const [hx, hy] = P(0.5, 1, pz);
  glowIn(dr, 'ceiling-halo', ceilingHalo, [hx, hy], dr.room.width * 0.42, [[0, HOT, 0.55], [0.4, WARM, 0.22], [1, WARM, 0]], 0.3);
  for (const x of [0.38, 0.62]) stroke(polylinePath([P(x, 1, pz), P(x, lamp.y1, pz)]), '#3d3833', 0.9, 0.75);
  const beam = [P(lamp.x0 + 0.004, lamp.y0, lamp.z1), P(lamp.x1 - 0.004, lamp.y0, lamp.z1), P(top.x1 - 0.015, top.y1, pz + 0.06), P(top.x0 + 0.015, top.y1, pz + 0.06)];
  fill(polygonPath(beam), linear('pendant-beam', [0, beam[0][1]], [0, beam[3][1]], [[0, HOT, 0.62], [0.3, WARM, 0.34], [1, AMBER, 0.1]]));
  box(dr, lamp, m.anodized);
  // The diffuser: a white-hot slot along the underside, on the near edge of the body.
  stroke(polylinePath([P(lamp.x0 + 0.006, lamp.y0, lamp.z1), P(lamp.x1 - 0.006, lamp.y0, lamp.z1)]), '#ffffff', 2.4, 1);
  const [lx, ly] = P(0.5, lamp.y0, lamp.z1);
  fill(ellipsePath(lx, ly + 3, dr.room.width * 0.22, dr.room.width * 0.05), radial('diffuser-bloom', [lx, ly + 3], dr.room.width * 0.22, [[0, '#ffffff', 0.6], [0.3, HOT, 0.28], [1, HOT, 0]], 0.23));

  return { x: lx / dr.room.width, y: ly / dr.room.height };
}

/* ---------- Bedroom Sanctuary: the Catalog ---------- */

function paintBedroom(dr) {
  const { P, face, fill, stroke, linear } = dr;
  const m = materials(dr);
  shell(dr, {
    wall: ['#e9dfcf', '#dcd0bd', '#d0c2ac'],
    side: ['#e0d4c1', '#c2b39b'],
    ceiling: ['#ede5d8', '#d8cbb6'],
    floor: ['#bf966a', '#8e6a44'],
  });
  windowOpening(dr, { side: 'right', z0: 0.2, z1: 0.62, y0: 0.1, y1: 0.86, sun: [0.4, -0.06], strength: 0.7 });
  // A linen curtain drawn to the near side of the window: soft vertical folds.
  const curtain = [
    dr.material('curtain-lit', [0, 0, 1, 0], [[0, '#efe7da'], [0.5, '#f7f1e7'], [1, '#e3d9c9']]),
    dr.material('curtain-shade', [0, 0, 1, 0], [[0, '#d9cdbb'], [0.5, '#e6dccd'], [1, '#d2c5b1']]),
  ];
  const folds = 6;
  for (let i = 0; i < folds; i += 1) {
    const za = 0.6 + (i / folds) * 0.1;
    const zb = 0.6 + ((i + 1) / folds) * 0.1;
    fill(face([[0.995, 0.03, za], [0.995, 0.03, zb], [0.995, 0.92, zb], [0.995, 0.92, za]]), curtain[i % 2]);
  }

  // A warm oat wool rug under the bed, its border a single crisp line.
  const rug = face([[0.15, 0, 0.12], [0.85, 0, 0.12], [0.85, 0, 0.94], [0.15, 0, 0.94]]);
  fill(rug, linear('rug', P(0.5, 0, 0.12), P(0.5, 0, 0.94), [[0, '#e1d6c3'], [1, '#cdbfa8']]));
  stroke(face([[0.165, 0, 0.14], [0.835, 0, 0.14], [0.835, 0, 0.92], [0.165, 0, 0.92]]), '#b2a48d', 1, 0.55);

  // The sconces warm the plaster round the bed before the furniture lands.
  const backWall = face([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  const [gx, gy] = P(0.5, 0.56, 0);
  glowIn(dr, 'back-glow', backWall, [gx, gy], dr.room.width * 0.5, [[0, WARM, 0.26], [0.55, AMBER, 0.1], [1, AMBER, 0]], 0.7);

  // An upholstered headboard wall in a walnut frame, its channels crisp.
  box(dr, { x0: 0.2, x1: 0.8, y0: 0.1, y1: 0.5, z0: 0, z1: 0.022 }, m.walnut);
  const felt = face([[0.212, 0.112, 0.022], [0.788, 0.112, 0.022], [0.788, 0.488, 0.022], [0.212, 0.488, 0.022]]);
  fill(felt, linear('felt', P(0.5, 0.488, 0.022), P(0.5, 0.112, 0.022), [[0, '#8d7d6a'], [1, '#76675a']]));
  for (let i = 1; i < 16; i += 1) {
    const x = 0.212 + (i / 16) * 0.576;
    stroke(polylinePath([P(x, 0.116, 0.022), P(x, 0.484, 0.022)]), '#4e4136', 1, 0.34);
    stroke(polylinePath([P(x + 0.004, 0.116, 0.022), P(x + 0.004, 0.484, 0.022)]), '#b3a28d', 0.7, 0.28);
  }

  // Sconces flank the bed and wash the plaster up and down in crisp 2700K cones.
  const sconces = [0.13, 0.87].map((x) => P(x, 0.6, 0));
  const span = P(0.87, 0.6, 0)[0] - P(0.13, 0.6, 0)[0];
  for (const [i, [sx, sy]] of sconces.entries()) {
    const h = span * 0.05;
    wallWash(dr, `sconce-up-${i}`, { x: sx, y0: sy - h, dir: -1, reach: sy - h - P(0, 1, 0)[1], halfWidth: span * 0.028, knee: span * 0.05, strength: 0.9 });
    wallWash(dr, `sconce-down-${i}`, { x: sx, y0: sy + h, dir: 1, reach: span * 0.32, halfWidth: span * 0.028, knee: span * 0.055, strength: 0.75 });
    const w = span * 0.026;
    fill(`M${r1(sx - w)} ${r1(sy - h)}L${r1(sx + w)} ${r1(sy - h)}L${r1(sx + w * 0.82)} ${r1(sy + h)}L${r1(sx - w * 0.82)} ${r1(sy + h)}Z`, dr.material('sconce', [0, 0, 1, 0], [[0, '#a99d8b'], [0.35, '#f4eee3'], [0.7, '#c8bdac'], [1, '#9b8f7d']]));
    fill(ellipsePath(sx, sy - h, w, w * 0.22), '#fff7e8');
    fill(ellipsePath(sx, sy + h, w * 0.82, w * 0.18), '#fff7e8');
  }

  // Oak side tables with a few objects.
  for (const [i, x] of [0.13, 0.87].entries()) {
    const table = { x0: x - 0.055, x1: x + 0.055, y0: 0, y1: 0.17, z0: 0.02, z1: 0.13 };
    contactShadow(dr, `side-shadow-${i}`, table, 0.24);
    box(dr, table, m.oak);
    stroke(polylinePath([P(x - 0.05, 0.1, 0.13), P(x + 0.05, 0.1, 0.13)]), '#7d5d3b', 0.8, 0.5);
  }
  box(dr, { x0: 0.1, x1: 0.155, y0: 0.17, y1: 0.185, z0: 0.05, z1: 0.1 }, { top: '#e6ddcf', front: '#d1c5b2', side: '#bcae98' });
  const [vx, vy] = P(0.87, 0.17, 0.07);
  const [, vt] = P(0.87, 0.24, 0.07);
  fill(vesselPath(vx, vy, vt, 7), dr.material('vessel-clay', [0, 0, 1, 0], [[0, '#9a5f3c'], [0.42, '#c98a60'], [1, '#8a5333']]));

  // The bed floats: an oak platform on a recessed plinth in shadow, then
  // linen, pillows and a clay throw draped over the foot.
  const platform = { x0: 0.24, x1: 0.76, y0: 0.045, y1: 0.1, z0: 0.022, z1: 0.66 };
  contactShadow(dr, 'bed-shadow', platform, 0.34);
  box(dr, { x0: 0.29, x1: 0.71, y0: 0, y1: 0.045, z0: 0.06, z1: 0.6 }, { front: '#3b2a1c', side: '#30231a', top: '#3b2a1c' });
  box(dr, platform, m.oak);
  stroke(polylinePath([P(platform.x0, platform.y1, platform.z1), P(platform.x1, platform.y1, platform.z1)]), '#f1d9b6', 0.9, 0.55);
  box(dr, { x0: 0.25, x1: 0.75, y0: 0.1, y1: 0.18, z0: 0.03, z1: 0.64 }, {
    top: dr.material('linen-top', [0, 0, 0, 1], [[0, '#f4efe6'], [1, '#ebe3d6']]),
    front: dr.material('linen-front', [0, 0, 0, 1], [[0, '#e6ddcf'], [1, '#d6cbb9']]),
    side: '#cfc4b3',
  });
  for (const [x0, x1] of [
    [0.285, 0.485],
    [0.515, 0.715],
  ]) {
    box(dr, { x0, x1, y0: 0.18, y1: 0.235, z0: 0.05, z1: 0.14 }, { top: '#fbf8f2', front: '#ede6da', side: '#ddd4c6' });
  }
  box(dr, { x0: 0.245, x1: 0.755, y0: 0.104, y1: 0.188, z0: 0.46, z1: 0.652 }, {
    top: dr.material('throw-top', [0, 0, 1, 0], [[0, '#b07a58'], [0.5, '#bf8a67'], [1, '#a9724f']]),
    front: dr.material('throw-front', [0, 0, 0, 1], [[0, '#a56d4c'], [1, '#8d5a3d']]),
    side: '#8a5a3e',
  });
  stroke(polylinePath([P(0.245, 0.188, 0.49), P(0.755, 0.188, 0.49)]), '#8a5a3e', 1, 0.45);
  // The warm room light settles on the linen.
  const [bx, by] = P(0.5, 0.18, 0.3);
  glowIn(dr, 'bed-pool', face([[0.25, 0.18, 0.03], [0.75, 0.18, 0.03], [0.75, 0.18, 0.64], [0.25, 0.18, 0.64]]), [bx, by], dr.room.width * 0.34, POOL(0.4), 0.42);

  return { x: 0.5, y: sconces[0][1] / dr.room.height };
}

/* ---------- Studio Wall: the Lighting Studio ---------- */

const SHELF_BOOKS = [
  [0.012, 0.072, '#3d3a35'],
  [0.016, 0.09, '#8a7a64'],
  [0.011, 0.064, '#c8bca9'],
  [0.018, 0.1, '#6b4c35'],
  [0.013, 0.08, '#2f3a3a'],
  [0.015, 0.068, '#b9ab94'],
  [0.012, 0.094, '#4d453c'],
];

function paintStudio(dr) {
  const { P, face, fill, stroke, linear } = dr;
  const m = materials(dr);
  shell(dr, {
    wall: ['#f0e9de', '#e4dacb', '#d9cebd'],
    side: ['#e6dccd', '#c7baa5'],
    ceiling: ['#f2ece3', '#ded4c5'],
    floor: ['#c79d6d', '#9a7449'],
  });

  // A skylight shaft rakes daylight across the plaster.
  const shaft = [P(0.06, 1, 0), P(0.34, 1, 0), P(0.66, 0.16, 0), P(0.4, 0.16, 0)];
  fill(polygonPath(shaft), linear('skylight', shaft[0], shaft[2], [[0, '#fffdf8', 0.5], [0.6, '#fffdf8', 0.16], [1, '#fffdf8', 0]]));

  // A 24V track on the wall near the ceiling; three spots, each cone leaving its own aperture.
  const rail = { x0: 0.1, x1: 0.9, y0: 0.905, y1: 0.92, z0: 0, z1: 0.016 };
  box(dr, rail, { front: dr.material('rail', [0, 0, 0, 1], [[0, '#c8cbcd'], [1, '#8f9396']]), bottom: '#7d8184', side: '#9a9ea1' });
  const ceilingY = P(0, 1, 0)[1];
  const floorY = P(0, 0, 0)[1];
  for (const [i, x] of [0.22, 0.5, 0.78].entries()) {
    const [hx, hy] = P(x, rail.y0, 0.03);
    const s = (P(x + 0.01, rail.y0, 0.03)[0] - hx);
    const body = { w: s * 1.5, h: s * 2.3 };
    const aperture = hy + body.h;
    wallWash(dr, `spot-${i}`, { x: hx, y0: aperture, dir: 1, reach: (floorY - ceilingY) * 0.5, halfWidth: s * 0.95, knee: s * 2.6, strength: 0.82 });
    fill(polygonPath([[hx - body.w / 2, hy], [hx + body.w / 2, hy], [hx + body.w / 2, aperture], [hx - body.w / 2, aperture]]), 'anodized');
    fill(ellipsePath(hx, aperture, body.w * 0.4, body.w * 0.12), '#fff6e6');
  }

  // Floating walnut shelves with integrated LED, each laying its scallop on the plaster.
  const shelves = [0.34, 0.51, 0.68];
  const vessels = [
    dr.material('vessel-ink', [0, 0, 1, 0], [[0, '#3c3733'], [0.45, '#625a54'], [1, '#34302c']]),
    dr.material('vessel-stone', [0, 0, 1, 0], [[0, '#c3b6a2'], [0.4, '#ece5d9'], [1, '#aa9c86']]),
  ];
  for (const [i, y] of shelves.entries()) shelfWash(dr, `shelf-${i}`, { x0: 0.12, x1: 0.5, y, depth: 0.11, flare: 0.025, strength: 0.78 });
  for (const [i, y] of shelves.entries()) {
    box(dr, { x0: 0.12, x1: 0.5, y0: y, y1: y + 0.018, z0: 0, z1: 0.07 }, m.walnut);
    stroke(polylinePath([P(0.13, y, 0.062), P(0.49, y, 0.062)]), HOT, 1.4, 0.9);
    let x = 0.15 + (i % 2) * 0.03;
    for (let b = 0; x < 0.4; b += 1) {
      const [bw, bh, tone] = SHELF_BOOKS[(b + i * 3) % SHELF_BOOKS.length];
      box(dr, { x0: x, x1: x + bw, y0: y + 0.018, y1: y + 0.018 + bh, z0: 0.012, z1: 0.054 }, { front: tone, top: tone, side: tone });
      x += bw + 0.003;
    }
    const [vx, vy] = P(0.45, y + 0.018, 0.035);
    const [, vt] = P(0.45, y + 0.018 + 0.075, 0.035);
    fill(vesselPath(vx, vy, vt, 6), vessels[i % 2]);
  }

  // An acoustic frame: felt with crisp grooves in a walnut edge.
  box(dr, { x0: 0.6, x1: 0.86, y0: 0.24, y1: 0.68, z0: 0, z1: 0.024 }, m.walnut);
  const felt = face([[0.614, 0.254, 0.024], [0.846, 0.254, 0.024], [0.846, 0.666, 0.024], [0.614, 0.666, 0.024]]);
  fill(felt, linear('studio-felt', P(0.73, 0.666, 0.024), P(0.73, 0.254, 0.024), [[0, '#7a6d5e'], [1, '#655949']]));
  for (let i = 1; i < 14; i += 1) {
    const x = 0.614 + (i / 14) * 0.232;
    stroke(polylinePath([P(x, 0.26, 0.024), P(x, 0.66, 0.024)]), '#3f352b', 1, 0.36);
    stroke(polylinePath([P(x + 0.003, 0.26, 0.024), P(x + 0.003, 0.66, 0.024)]), '#a39380', 0.7, 0.26);
  }

  // A corner floor column: a lit diffuser and its halo on the plaster.
  const [cx, cyTop] = P(0.93, 0.62, 0.06);
  const [, cyBase] = P(0.93, 0, 0.06);
  const backWall = face([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  glowIn(dr, 'column-halo', backWall, [cx, (cyTop + cyBase) / 2], dr.room.width * 0.24, POOL(0.42), 1.6);
  box(dr, { x0: 0.915, x1: 0.945, y0: 0, y1: 0.62, z0: 0.045, z1: 0.075 }, m.oak);
  fill(face([[0.921, 0.05, 0.075], [0.939, 0.05, 0.075], [0.939, 0.6, 0.075], [0.921, 0.6, 0.075]]), linear('column-diffuser', P(0.93, 0.6, 0.075), P(0.93, 0.05, 0.075), [[0, '#ffffff'], [0.5, HOT], [1, WARM]]));

  // A low oak bench along the wall: a slab on two recessed legs, its shadow on the boards.
  const bench = { x0: 0.08, x1: 0.62, y0: 0.105, y1: 0.135, z0: 0.03, z1: 0.17 };
  contactShadow(dr, 'bench-shadow', bench, 0.28);
  for (const x of [0.13, 0.57]) box(dr, { x0: x - 0.012, x1: x + 0.012, y0: 0, y1: bench.y0, z0: 0.05, z1: 0.15 }, m.walnut);
  box(dr, bench, m.oak);
  stroke(polylinePath([P(bench.x0, bench.y1, bench.z1), P(bench.x1, bench.y1, bench.z1)]), '#f0d5b0', 0.9, 0.6);

  const [gx, gy] = P(0.31, 0.51, 0);
  return { x: gx / dr.room.width, y: gy / dr.room.height };
}

/* ---------- scenes ---------- */

const PAINTERS = Object.freeze({ dining: paintDining, bedroom: paintBedroom, studio: paintStudio });
const VIEWS = Object.freeze({
  dining: { vpx: 0.56, horizon: 0.44, depth: 0.42, spread: 0.26, shift: 0.06 },
  bedroom: { vpx: 0.5, horizon: 0.42, depth: 0.5, spread: 0.24 },
  studio: { vpx: 0.44, horizon: 0.46, depth: 0.6, spread: 0.2 },
});

// A soft frame round every room: the edges settle a little, never a dark lens.
function frame(dr) {
  const { width, height } = dr.room;
  const veil = dr.radial('vignette', [width / 2, height * 0.46], Math.hypot(width, height) * 0.6, [[0, '#2a1d12', 0], [0.62, '#2a1d12', 0.04], [1, '#2a1d12', 0.2]]);
  dr.fill(`M0 0H${width}V${height}H0Z`, veil);
}

const cache = new Map();

/**
 * One interior as smooth vectors, built once per scene: `defs` (gradients and
 * clip paths, ids local to the scene), `shapes` in painter's order and `glow`,
 * the luminaire's position as a fraction of the frame, where the hover light
 * breathes. An unknown scene falls back to the dining room.
 */
export function interiorScene(scene) {
  const id = Object.hasOwn(PAINTERS, scene) ? scene : 'dining';
  if (!cache.has(id)) {
    const room = createRoom(INTERIOR_VIEW.width, INTERIOR_VIEW.height, VIEWS[id]);
    const dr = drawing(room);
    const glow = PAINTERS[id](dr);
    frame(dr);
    cache.set(id, Object.freeze({ id, ...dr.finish(glow) }));
  }
  return cache.get(id);
}
