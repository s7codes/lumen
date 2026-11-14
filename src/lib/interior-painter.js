import {
  fillPolygon,
  grain,
  hyperbolicWash,
  lerp,
  linear,
  mottle,
  pool,
  rgba,
  seededRandom,
  valueNoise,
  vignette,
} from './paint-kit.js';

/*
 * Explore the Lumen home: three portrait (3:4) interiors painted once into a
 * Canvas 2D context. One-point perspective rooms in limewashed plaster over
 * oak boards, lit by a daylight aperture and a warm 2700K Lumen luminaire.
 * Pure functions over a context; textures come from `createInteriorAssets`.
 *
 * Room coordinates: X 0-1 from the left wall to the right wall, Y 0-1 from
 * floor to ceiling, z 0-1 from the back wall to the picture plane. The
 * picture plane is wider than the frame, so the portrait crops a real room
 * rather than a tall narrow box.
 */

export const INTERIOR_SCENES = Object.freeze({
  dining: Object.freeze({ id: 'dining', label: 'Dining & Living' }),
  bedroom: Object.freeze({ id: 'bedroom', label: 'Bedroom Sanctuary' }),
  studio: Object.freeze({ id: 'studio', label: 'Studio Wall' }),
});

export const INTERIOR_SCENE_IDS = Object.freeze(Object.keys(INTERIOR_SCENES));

const WARM = [255, 198, 132];
const HOT = [255, 240, 218];
const DAY = [255, 249, 238];

export function createInteriorAssets(makeCanvas) {
  const noise = valueNoise(makeCanvas, 360, 360, 71, { cells: 5, octaves: 5 });
  return {
    limewash: mottle(makeCanvas, noise, { light: [255, 252, 244], dark: [120, 102, 82], strength: 0.3, contrast: 2.6 }),
    grain: grain(makeCanvas, 128, 83, 0.35),
  };
}

/** Perspective for one portrait: eye at `horizon` of the room height. */
export function createRoom(width, height, { vpx = 0.48, horizon = 0.46, depth = 0.5, spread = 0.36 } = {}) {
  const front = { x0: -spread * width, x1: width * (1 + spread), y0: -0.04 * height, y1: height };
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

function face(ctx, room, corners, style) {
  fillPolygon(
    ctx,
    corners.map(([X, Y, z]) => room.project(X, Y, z)),
    style,
  );
}

/** A box seen from the eye: the faces that turn toward it, back to front. */
function box(ctx, room, { x0, x1, y0, y1, z0, z1 }, tones) {
  if (y1 < room.eyeY && tones.top) face(ctx, room, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], tones.top);
  if (y0 > room.eyeY && tones.bottom) face(ctx, room, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tones.bottom);
  if (x0 > room.eyeX && tones.side) face(ctx, room, [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], tones.side);
  if (x1 < room.eyeX && tones.side) face(ctx, room, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], tones.side);
  face(ctx, room, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tones.front);
}

function wallTexture(ctx, assets, corners, alpha) {
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = alpha;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  ctx.drawImage(assets.limewash, left, top, Math.max(...xs) - left, Math.max(...ys) - top);
  ctx.restore();
}

/** The shell: ceiling, three limewashed walls and an oak floor with its boards. */
function paintShell(ctx, room, assets, tones, seed) {
  const P = room.project;
  const { width, height } = room;
  const back = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)];
  const left = [P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1)];
  const right = [P(1, 0, 0), P(1, 0, 1), P(1, 1, 1), P(1, 1, 0)];
  const ceiling = [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)];
  const floor = [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)];

  ctx.fillStyle = tones.wall[1];
  ctx.fillRect(0, 0, width, height);
  fillPolygon(ctx, ceiling, linear(ctx, 0, 0, 0, back[3][1], [[0, tones.ceiling[1]], [1, tones.ceiling[0]]]));
  fillPolygon(ctx, back, linear(ctx, 0, back[3][1], 0, back[0][1], [[0, tones.wall[0]], [1, tones.wall[1]]]));
  fillPolygon(ctx, left, linear(ctx, left[3][0], 0, left[0][0], 0, [[0, tones.side[1]], [1, tones.side[0]]]));
  fillPolygon(ctx, right, linear(ctx, right[1][0], 0, right[0][0], 0, [[0, tones.side[1]], [1, tones.side[0]]]));
  for (const plane of [back, left, right]) wallTexture(ctx, assets, plane, 0.9);
  wallTexture(ctx, assets, ceiling, 0.5);

  // Oak boards converging on the eye, butt joints staggered along each board.
  fillPolygon(ctx, floor, linear(ctx, 0, floor[0][1], 0, height, [[0, tones.floor[0]], [1, tones.floor[1]]]));
  const random = seededRandom(seed);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(floor[0][0], floor[0][1]);
  for (const p of floor.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.clip();
  const boards = 15;
  for (let i = 0; i < boards; i += 1) {
    const x0 = i / boards;
    const x1 = (i + 1) / boards;
    // Each board carries its own tone, as sawn oak does.
    const shade = random();
    face(ctx, room, [[x0, 0, 0], [x1, 0, 0], [x1, 0, 1], [x0, 0, 1]], shade > 0.5 ? `rgba(255, 236, 206, ${(shade - 0.5) * 0.14})` : `rgba(60, 38, 20, ${(0.5 - shade) * 0.16})`);
    const a = P(x0, 0, 0);
    const b = P(x0, 0, 1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = 'rgba(58, 38, 22, 0.32)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
    let z = random() * 0.3;
    while (z < 1) {
      const p = P(x0, 0, z);
      const q = P(x1, 0, z);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.strokeStyle = 'rgba(58, 38, 22, 0.24)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      z += 0.28 + random() * 0.4;
    }
  }
  ctx.restore();

  // Ambient occlusion where the planes meet.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const seam = (a, b, spread) => {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = 'rgba(120, 100, 80, 0.5)';
    ctx.lineWidth = spread;
    ctx.stroke();
  };
  seam(back[0], back[1], 3);
  seam(back[0], back[3], 2.4);
  seam(back[1], back[2], 2.4);
  seam(back[3], back[2], 1.6);
  ctx.restore();
  return { back, left, right, floor, ceiling };
}

/** A daylight window in a side wall (X = 0 or 1), with its reveal, mullions and the sun patch on the boards. */
function paintWindow(ctx, room, { side, z0, z1, y0, y1, sun = [0.5, -0.12], strength = 1, tint = DAY }) {
  const P = room.project;
  const X = side === 'left' ? 0 : 1;
  const into = side === 'left' ? 1 : -1;
  const pane = [P(X, y0, z0), P(X, y0, z1), P(X, y1, z1), P(X, y1, z0)];
  fillPolygon(ctx, pane, linear(ctx, 0, pane[3][1], 0, pane[0][1], [
    [0, rgba(tint, 1)],
    [0.55, 'rgba(236, 238, 236, 1)'],
    [1, 'rgba(226, 228, 224, 1)'],
  ]));
  // Reveal: the wall thickness, in shade on the far jamb.
  const depth = 0.035 * into;
  face(ctx, room, [[X, y0, z0], [X + depth, y0, z0], [X + depth, y1, z0], [X, y1, z0]], 'rgba(150, 132, 112, 0.55)');
  // Mullions.
  ctx.strokeStyle = 'rgba(92, 82, 70, 0.75)';
  ctx.lineWidth = 1.4;
  const zm = (z0 + z1) / 2;
  const ym = lerp(y0, y1, 0.66);
  for (const [a, b] of [
    [P(X, y0, zm), P(X, y1, zm)],
    [P(X, ym, z0), P(X, ym, z1)],
  ]) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  // The sun patch: each corner of the opening carried down the sun's direction onto the floor.
  const [dx, dz] = sun;
  const hit = (Y, z) => [X + into * Y * dx, 0, z + Y * dz];
  const patch = [hit(y0, z0), hit(y0, z1), hit(y1, z1), hit(y1, z0)].map(([hx, hy, hz]) => P(Math.min(1, Math.max(0, hx)), hy, Math.min(1, Math.max(0, hz))));
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  fillPolygon(ctx, patch, rgba(tint, 0.2 * strength));
  ctx.globalAlpha = 0.5;
  ctx.translate(into * 3, 2);
  fillPolygon(ctx, patch, rgba(tint, 0.1 * strength));
  ctx.restore();
  // Daylight spilling into the room near the opening.
  const centre = P(X, (y0 + y1) / 2, zm);
  pool(ctx, centre[0] + into * room.width * 0.12, centre[1], room.width * 0.75, tint, 0.16 * strength, 'screen');
}

function walnut(ctx, room, b) {
  box(ctx, room, b, { top: '#7d5a3e', front: '#5a3e2a', side: '#4a3322', bottom: '#3a291c' });
}

function oak(ctx, room, b) {
  box(ctx, room, b, { top: '#c79d6d', front: '#a57c51', side: '#8f6a44', bottom: '#6f5235' });
}

function finish(ctx, room, assets) {
  const { width, height } = room;
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255, 196, 140, 0.16)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  vignette(ctx, width, height, 0.42, [24, 18, 12]);
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = ctx.createPattern(assets.grain, 'repeat');
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* ---------- Dining & Living: the Room Planner ---------- */

function paintDining(ctx, room, assets) {
  paintShell(ctx, room, assets, {
    wall: ['#ebe4d8', '#d9cfbf'],
    side: ['#e0d7c8', '#c9bda9'],
    ceiling: ['#efe9df', '#ddd4c6'],
    floor: ['#c39a6c', '#94704a'],
  }, 5);
  const P = room.project;
  paintWindow(ctx, room, { side: 'left', z0: 0.16, z1: 0.62, y0: 0.12, y1: 0.88, sun: [0.55, -0.1] });

  // A lit floating shelf on the back wall.
  const shelfL = P(0.38, 0.47, 0);
  const shelfR = P(0.7, 0.47, 0);
  hyperbolicWash(ctx, (shelfL[0] + shelfR[0]) / 2, shelfL[1] + 2, 1, {
    reach: (shelfR[0] - shelfL[0]) * 0.7,
    width: (shelfR[0] - shelfL[0]) * 0.42,
    knee: room.width * 0.05,
    glow: 0.7,
  });
  walnut(ctx, room, { x0: 0.38, x1: 0.7, y0: 0.47, y1: 0.49, z0: 0, z1: 0.06 });
  // Two stoneware vessels on the shelf.
  for (const [x, h, tone] of [
    [0.45, 0.07, '#cfc2ae'],
    [0.6, 0.05, '#6f6253'],
  ]) {
    const base = P(x, 0.49, 0.03);
    const topP = P(x, 0.49 + h, 0.03);
    ctx.beginPath();
    ctx.ellipse(base[0], (base[1] + topP[1]) / 2, room.width * 0.022, (base[1] - topP[1]) / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = tone;
    ctx.fill();
  }

  // Two oak chairs beyond the table: their backs rise over the walnut top.
  for (const x of [0.38, 0.62]) {
    for (const leg of [-0.04, 0.04]) {
      oak(ctx, room, { x0: x + leg - 0.004, x1: x + leg + 0.004, y0: 0, y1: 0.4, z0: 0.29, z1: 0.298 });
    }
    oak(ctx, room, { x0: x - 0.045, x1: x + 0.045, y0: 0.31, y1: 0.39, z0: 0.29, z1: 0.3 });
    oak(ctx, room, { x0: x - 0.045, x1: x + 0.045, y0: 0.17, y1: 0.19, z0: 0.29, z1: 0.36 });
  }
  // The walnut table: four legs, then the top.
  const legs = [
    [0.29, 0.38],
    [0.71, 0.38],
    [0.29, 0.6],
    [0.71, 0.6],
  ];
  for (const [x, z] of legs) walnut(ctx, room, { x0: x - 0.01, x1: x + 0.01, y0: 0, y1: 0.27, z0: z - 0.012, z1: z + 0.012 });
  walnut(ctx, room, { x0: 0.26, x1: 0.74, y0: 0.27, y1: 0.29, z0: 0.35, z1: 0.63 });

  // Linear suspension pendant, 2700K, over the table.
  for (const x of [0.38, 0.62]) {
    const a = P(x, 1, 0.48);
    const b = P(x, 0.66, 0.48);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = 'rgba(70, 64, 58, 0.7)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  const lampL = P(0.33, 0.64, 0.49);
  const lampR = P(0.67, 0.64, 0.49);
  const tableL = P(0.3, 0.29, 0.49);
  const tableR = P(0.7, 0.29, 0.49);
  // Light volume and the pool it lays on the walnut.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  fillPolygon(ctx, [lampL, lampR, tableR, tableL], linear(ctx, 0, lampL[1], 0, tableL[1], [
    [0, rgba(WARM, 0.2)],
    [1, rgba(WARM, 0.02)],
  ]));
  ctx.restore();
  const tableMid = P(0.5, 0.29, 0.49);
  ctx.save();
  ctx.translate(tableMid[0], tableMid[1]);
  ctx.scale(1, 0.32);
  pool(ctx, 0, 0, room.width * 0.34, WARM, 0.5, 'screen');
  ctx.restore();
  box(ctx, room, { x0: 0.33, x1: 0.67, y0: 0.64, y1: 0.66, z0: 0.475, z1: 0.505 }, { bottom: rgba(HOT, 1), front: '#2a2724', side: '#1f1d1b', top: '#3a3632' });
  const lamp = P(0.5, 0.64, 0.49);
  pool(ctx, lamp[0], lamp[1], room.width * 0.48, WARM, 0.42, 'screen');
  pool(ctx, lamp[0], lamp[1], room.width * 0.14, HOT, 0.56, 'screen');
  // A soft uplight on the ceiling above the bar.
  const ceilingSpot = P(0.5, 1, 0.48);
  ctx.save();
  ctx.translate(ceilingSpot[0], ceilingSpot[1]);
  ctx.scale(1, 0.3);
  pool(ctx, 0, 0, room.width * 0.4, WARM, 0.22, 'screen');
  ctx.restore();
  finish(ctx, room, assets);
  return { x: lamp[0] / room.width, y: lamp[1] / room.height };
}

/* ---------- Bedroom Sanctuary: the Catalog ---------- */

function paintBedroom(ctx, room, assets) {
  paintShell(ctx, room, assets, {
    wall: ['#ded2bf', '#c8baa4'],
    side: ['#d3c6b2', '#b9aa93'],
    ceiling: ['#e6dece', '#d1c6b4'],
    floor: ['#b48c62', '#86643f'],
  }, 9);
  const P = room.project;
  paintWindow(ctx, room, { side: 'right', z0: 0.2, z1: 0.6, y0: 0.1, y1: 0.86, sun: [0.42, -0.08], strength: 0.75, tint: [255, 238, 214] });

  // Felt headboard with vertical grooves.
  box(ctx, room, { x0: 0.22, x1: 0.78, y0: 0.12, y1: 0.46, z0: 0, z1: 0.03 }, { front: '#7c6d5c', top: '#8a7a68', side: '#625546' });
  ctx.strokeStyle = 'rgba(40, 32, 24, 0.28)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 18; i += 1) {
    const x = lerp(0.22, 0.78, i / 18);
    const a = P(x, 0.13, 0.03);
    const b = P(x, 0.45, 0.03);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Sconces flank the bed and wash the plaster up and down.
  const sconces = [0.15, 0.85].map((x) => P(x, 0.54, 0));
  const span = P(0.85, 0.54, 0)[0] - P(0.15, 0.54, 0)[0];
  for (const [sx, sy] of sconces) {
    hyperbolicWash(ctx, sx, sy - span * 0.05, -1, { reach: span * 0.36, width: span * 0.03, knee: span * 0.045, glow: 0.85 });
    hyperbolicWash(ctx, sx, sy + span * 0.05, 1, { reach: span * 0.3, width: span * 0.03, knee: span * 0.045, glow: 0.75 });
    ctx.beginPath();
    ctx.ellipse(sx, sy, span * 0.03, span * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = linear(ctx, sx - span * 0.03, 0, sx + span * 0.03, 0, [
      [0, '#b3a795'],
      [0.35, '#f3ece0'],
      [1, '#958977'],
    ]);
    ctx.fill();
  }

  // Side tables.
  for (const x of [0.17, 0.83]) oak(ctx, room, { x0: x - 0.05, x1: x + 0.05, y0: 0, y1: 0.16, z0: 0.02, z1: 0.12 });

  // Oak platform, linen and a throw at the foot.
  oak(ctx, room, { x0: 0.25, x1: 0.75, y0: 0, y1: 0.11, z0: 0.03, z1: 0.64 });
  box(ctx, room, { x0: 0.26, x1: 0.74, y0: 0.11, y1: 0.19, z0: 0.035, z1: 0.62 }, { top: '#efe9df', front: '#ddd5c8', side: '#cfc6b8' });
  box(ctx, room, { x0: 0.255, x1: 0.745, y0: 0.13, y1: 0.195, z0: 0.46, z1: 0.63 }, { top: '#8c7862', front: '#75634f', side: '#6a5946' });
  for (const [x0, x1] of [
    [0.29, 0.48],
    [0.52, 0.71],
  ]) {
    box(ctx, room, { x0, x1, y0: 0.19, y1: 0.245, z0: 0.05, z1: 0.13 }, { top: '#f6f1e8', front: '#e6dfd3', side: '#d8d0c3' });
  }
  // The warm room light settles on the linen.
  const bed = P(0.5, 0.19, 0.3);
  ctx.save();
  ctx.translate(bed[0], bed[1]);
  ctx.scale(1, 0.4);
  pool(ctx, 0, 0, room.width * 0.38, WARM, 0.24, 'screen');
  ctx.restore();
  finish(ctx, room, assets);
  const glow = sconces[0];
  return { x: 0.5, y: glow[1] / room.height };
}

/* ---------- Studio Wall: the Wall Studio ---------- */

function paintStudio(ctx, room, assets) {
  paintShell(ctx, room, assets, {
    wall: ['#e6dfd2', '#d3c8b6'],
    side: ['#d9cfbf', '#c2b5a0'],
    ceiling: ['#ece6db', '#d8cfc0'],
    floor: ['#bd9466', '#8b6843'],
  }, 13);
  const P = room.project;

  // Skylight aperture: a shaft of daylight raking across the wall.
  const shaft = [P(0.04, 1, 0), P(0.3, 1, 0), P(0.62, 0.2, 0), P(0.38, 0.2, 0)];
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  fillPolygon(ctx, shaft, linear(ctx, shaft[0][0], shaft[0][1], shaft[2][0], shaft[2][1], [
    [0, rgba(DAY, 0.26)],
    [1, rgba(DAY, 0)],
  ]));
  ctx.restore();

  // Track rail with three spots near the ceiling.
  box(ctx, room, { x0: 0.12, x1: 0.88, y0: 0.9, y1: 0.915, z0: 0, z1: 0.02 }, { front: '#b4b8bb', bottom: '#8e9295', side: '#9a9ea1' });
  for (const x of [0.24, 0.5, 0.76]) {
    const head = P(x, 0.86, 0.04);
    ctx.fillStyle = '#2a2826';
    ctx.fillRect(head[0] - 3, head[1] - 7, 6, 9);
    pool(ctx, head[0], head[1] + 2, room.width * 0.05, HOT, 0.6, 'screen');
  }

  // Floating walnut shelves with integrated LED, each throwing its scallop down the wall.
  const shelves = [0.36, 0.53, 0.7];
  for (const y of shelves) {
    const l = P(0.12, y, 0);
    const r = P(0.52, y, 0);
    const w = r[0] - l[0];
    hyperbolicWash(ctx, l[0] + w / 2, l[1] + 2, 1, { reach: w * 0.5, width: w * 0.4, knee: w * 0.1, glow: 0.72 });
  }
  for (const y of shelves) walnut(ctx, room, { x0: 0.12, x1: 0.52, y0: y, y1: y + 0.018, z0: 0, z1: 0.07 });
  // Books and a vessel on the shelves.
  const random = seededRandom(17);
  for (const y of shelves) {
    let x = 0.15 + random() * 0.04;
    while (x < 0.4) {
      const w = 0.012 + random() * 0.014;
      const h = 0.06 + random() * 0.05;
      const tone = ['#3d3a35', '#8a7a64', '#c8bca9', '#6b4c35', '#2f3a3a'][Math.floor(random() * 5)];
      box(ctx, room, { x0: x, x1: x + w, y0: y + 0.018, y1: y + 0.018 + h, z0: 0.01, z1: 0.05 }, { front: tone, top: tone, side: tone });
      x += w + 0.002;
    }
  }

  // Acoustic frame: felt with vertical grooves in a walnut edge.
  box(ctx, room, { x0: 0.6, x1: 0.86, y0: 0.24, y1: 0.68, z0: 0, z1: 0.025 }, { front: '#5a3e2a', side: '#4a3322', top: '#6b4a33' });
  const felt = [P(0.615, 0.255, 0.025), P(0.845, 0.255, 0.025), P(0.845, 0.665, 0.025), P(0.615, 0.665, 0.025)];
  fillPolygon(ctx, felt, '#6e6253');
  ctx.strokeStyle = 'rgba(30, 24, 18, 0.34)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 14; i += 1) {
    const x = lerp(0.615, 0.845, i / 14);
    const a = P(x, 0.255, 0.025);
    const b = P(x, 0.665, 0.025);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Corner floor column: a lit diffuser with its halo on the plaster.
  const colTop = P(0.93, 0.62, 0.06);
  const colBase = P(0.93, 0, 0.06);
  pool(ctx, colTop[0], (colTop[1] + colBase[1]) / 2, room.width * 0.22, WARM, 0.36, 'screen');
  oak(ctx, room, { x0: 0.915, x1: 0.945, y0: 0, y1: 0.62, z0: 0.045, z1: 0.075 });
  const diffuser = [P(0.922, 0.05, 0.075), P(0.938, 0.05, 0.075), P(0.938, 0.6, 0.075), P(0.922, 0.6, 0.075)];
  fillPolygon(ctx, diffuser, rgba(HOT, 0.95));

  // Low bench along the floor.
  oak(ctx, room, { x0: 0.08, x1: 0.62, y0: 0, y1: 0.13, z0: 0.02, z1: 0.16 });
  finish(ctx, room, assets);
  const glow = P(0.32, 0.53, 0);
  return { x: glow[0] / room.width, y: glow[1] / room.height };
}

const PAINTERS = Object.freeze({ dining: paintDining, bedroom: paintBedroom, studio: paintStudio });
const VIEWS = Object.freeze({
  dining: { vpx: 0.5, horizon: 0.44 },
  bedroom: { vpx: 0.5, horizon: 0.42, depth: 0.52 },
  studio: { vpx: 0.44, horizon: 0.46, depth: 0.62, spread: 0.24 },
});

/**
 * Paints one interior into `ctx` at width x height CSS pixels (the caller
 * sets the backing-store transform). Returns the luminaire's position as a
 * fraction of the frame, where the hover light breathes.
 */
export function paintInterior(ctx, { scene, width, height, assets }) {
  const painter = PAINTERS[scene] ?? PAINTERS.dining;
  const room = createRoom(width, height, VIEWS[scene] ?? VIEWS.dining);
  ctx.save();
  const glow = painter(ctx, room, assets);
  ctx.restore();
  return glow;
}

