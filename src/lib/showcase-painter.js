import {
  convexHull,
  eyeFrustum,
  FLOOR,
  OBJECTS,
  OBSERVER,
  PENDANT,
  PENDANT_CABLES,
  pointOnRun,
  project,
  PULSE_SPACING_CM,
  PULSE_SPEED_CM_S,
  projectPolygon,
  projectSegment,
  SHELF,
  shelfBoxes,
  shelfDimensions,
  STAGE_ROOM,
  toCamera,
  TRACK,
  wallPresence,
  WALLS,
} from './showcase-scene.js';

/*
 * Canvas 2D painter for one theatre frame. Painter's order: floor, walls
 * seen from inside, light on both, iso-lux field, furniture far to near,
 * volumetric cones and the bus (additive), act overlays, then the section
 * cut of every wall between the eye and the room.
 */

const W = STAGE_ROOM.widthCm;
const H = STAGE_ROOM.heightCm;
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';

const PALETTE = {
  platform: { top: '#2e2a26', side: '#1f1c19', front: '#191714', bottom: '#0c0b0a' },
  cushion: { top: '#4b453e', side: '#36312c', front: '#2d2925', bottom: '#151311' },
  alu: { top: '#d3d6d8', side: '#8e9295', front: '#70757a', bottom: '#3a3d40' },
  emitter: { top: '#fff1dc', side: '#ffd9a8', front: '#ffd9a8', bottom: '#ffd9a8' },
  felt: { top: '#4a453e', side: '#3a3631', front: '#34302b', bottom: '#2a2723' },
  feltInset: { top: '#5a544b', side: '#4c463e', front: '#4c463e', bottom: '#4c463e' },
  pendant: { top: '#aeb2b5', side: '#7c8084', front: '#8e9295', bottom: '#fff4e2' },
  walnut: { top: '#8a6446', side: '#553a28', front: '#6b4a33', bottom: '#3c2a1d' },
};

const WALL_TONE = { north: ['#1a1815', '#2c2924'], east: ['#171512', '#25221e'], south: ['#181613', '#282520'], west: ['#151311', '#23201c'] };

const AXIS_COLOR = { x: '#ff6a3d', y: '#3ee0a8', z: '#aeb2b5' };

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function tracePolygon(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function fillWorld(ctx, view, poly, style) {
  const pts = projectPolygon(view, poly);
  if (pts.length < 3) return null;
  tracePolygon(ctx, pts);
  ctx.fillStyle = style;
  ctx.fill();
  return pts;
}

function strokeWorld(ctx, view, a, b) {
  const seg = projectSegment(view, a, b);
  if (!seg) return false;
  ctx.moveTo(seg[0][0], seg[0][1]);
  ctx.lineTo(seg[1][0], seg[1][1]);
  return true;
}

function circleOnPlane(center, u, v, radius, steps = 20) {
  const pts = [];
  for (let k = 0; k < steps; k += 1) {
    const a = (k / steps) * Math.PI * 2;
    const cu = Math.cos(a) * radius;
    const sv = Math.sin(a) * radius;
    pts.push([center[0] + u[0] * cu + v[0] * sv, center[1] + u[1] * cu + v[1] * sv, center[2] + u[2] * cu + v[2] * sv]);
  }
  return pts;
}

/**
 * A soft elliptical glow lying on a plane. The local perspective round
 * `center` is taken as affine, so one radial gradient fill draws it.
 */
function planeGlow(ctx, frame, center, axisU, axisV, stops, alpha) {
  if (alpha <= 0.004) return;
  const { view, dpr } = frame;
  const c = project(view, center);
  const pu = project(view, add(center, axisU));
  const pv = project(view, add(center, axisV));
  if (!c || !pu || !pv) return;
  const a = pu[0] - c[0];
  const b = pu[1] - c[1];
  const d = pv[0] - c[0];
  const e = pv[1] - c[1];
  if (Math.abs(a * e - b * d) < 0.5) return;
  ctx.save();
  ctx.setTransform(dpr * a, dpr * b, dpr * d, dpr * e, dpr * c[0], dpr * c[1]);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [offset, rgb, a0] of stops) g.addColorStop(offset, `rgba(${rgb}, ${(a0 * alpha).toFixed(3)})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const WARM_STOPS = [
  [0, '255, 214, 160', 1],
  [0.4, '240, 160, 90', 0.42],
  [1, '232, 146, 58', 0],
];

/* ---------- room shell ---------- */

function paintFloor(ctx, frame) {
  const { view } = frame;
  const pts = fillWorld(ctx, view, FLOOR, '#141210');
  if (!pts) return;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 40; x < W; x += 40) strokeWorld(ctx, view, [x, 0, 0], [x, 0, STAGE_ROOM.depthCm]);
  for (let z = 40; z < STAGE_ROOM.depthCm; z += 40) strokeWorld(ctx, view, [0, 0, z], [W, 0, z]);
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.045)';
  ctx.stroke();
  ctx.beginPath();
  for (let x = 160; x < W; x += 160) strokeWorld(ctx, view, [x, 0, 0], [x, 0, STAGE_ROOM.depthCm]);
  for (let z = 160; z < STAGE_ROOM.depthCm; z += 160) strokeWorld(ctx, view, [0, 0, z], [W, 0, z]);
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.075)';
  ctx.stroke();
  tracePolygon(ctx, pts);
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.2)';
  ctx.stroke();
}

function paintWall(ctx, frame, wall, k) {
  const { view } = frame;
  const pts = projectPolygon(view, wall.corners);
  if (pts.length < 3) return;
  const bottom = project(view, [wall.center[0], 0, wall.center[2]]);
  const top = project(view, [wall.center[0], H, wall.center[2]]);
  const [low, high] = WALL_TONE[wall.id];
  let fill = high;
  if (bottom && top) {
    fill = ctx.createLinearGradient(bottom[0], bottom[1], top[0], top[1]);
    fill.addColorStop(0, low);
    fill.addColorStop(1, high);
  }
  ctx.globalAlpha = k;
  tracePolygon(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.14)';
  ctx.stroke();
  ctx.beginPath();
  if (strokeWorld(ctx, view, wall.corners[2], wall.corners[3])) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(246, 239, 228, 0.34)';
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintCut(ctx, frame, wall, k) {
  const cut = 1 - k;
  if (cut <= 0.01) return;
  const { view } = frame;
  const pts = projectPolygon(view, wall.corners);
  if (pts.length < 3) return;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1;
  tracePolygon(ctx, pts);
  ctx.strokeStyle = `rgba(242, 238, 231, ${(0.3 * cut).toFixed(3)})`;
  ctx.stroke();
  ctx.restore();
}

/* ---------- light ---------- */

function paintLightOnSurfaces(ctx, frame, presenceOf) {
  const { shelf, light } = frame;
  const cx = shelf.x + SHELF.widthCm / 2;
  planeGlow(ctx, frame, [320, 0, PENDANT.z], [270, 0, 0], [0, 0, 210], WARM_STOPS, 0.34 * light);
  planeGlow(ctx, frame, [cx, 0, 34], [120, 0, 0], [0, 0, 78], WARM_STOPS, 0.3 * light);
  planeGlow(ctx, frame, [619, 0, 21], [56, 0, 0], [0, 0, 56], WARM_STOPS, 0.16 * light);
  const north = presenceOf.north;
  planeGlow(ctx, frame, [cx, shelf.y - 46, 0.6], [92, 0, 0], [0, 78, 0], WARM_STOPS, 0.5 * light * north);
  planeGlow(ctx, frame, [320, 168, 0.6], [300, 0, 0], [0, 120, 0], WARM_STOPS, 0.1 * light * north);
  planeGlow(ctx, frame, [596, 262, 0.6], [74, 0, 0], [0, 96, 0], WARM_STOPS, 0.36 * light * north);
  planeGlow(ctx, frame, [W - 0.6, 262, 44], [0, 0, 74], [0, 96, 0], WARM_STOPS, 0.36 * light * presenceOf.east);
  planeGlow(ctx, frame, [0.6, 150, 310], [0, 0, 120], [0, 90, 0], WARM_STOPS, 0.08 * light * presenceOf.west);
}

function cone(ctx, frame, top, bottom, from, to, alpha) {
  if (alpha <= 0.004) return;
  const { view } = frame;
  const pts = [];
  for (const p of top.concat(bottom)) {
    const s = project(view, p);
    if (!s) return;
    pts.push(s);
  }
  const a = project(view, from);
  const b = project(view, to);
  if (!a || !b) return;
  const hull = convexHull(pts);
  const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
  g.addColorStop(0, `rgba(255, 206, 150, ${(0.26 * alpha).toFixed(3)})`);
  g.addColorStop(0.55, `rgba(240, 160, 90, ${(0.08 * alpha).toFixed(3)})`);
  g.addColorStop(1, 'rgba(232, 146, 58, 0)');
  tracePolygon(ctx, hull);
  ctx.fillStyle = g;
  ctx.fill();
}

function paintCones(ctx, frame) {
  const { shelf, light } = frame;
  const { y, z } = PENDANT;
  const pendantTop = [
    [247, y, z - 2],
    [393, y, z - 2],
    [393, y, z + 2],
    [247, y, z + 2],
  ];
  cone(ctx, frame, pendantTop, [[170, 0, z - 116], [470, 0, z - 116], [470, 0, z + 114], [170, 0, z + 114]], [320, y, z], [320, 0, z], light);
  cone(ctx, frame, pendantTop, [[236, 0, z - 60], [404, 0, z - 60], [404, 0, z + 60], [236, 0, z + 60]], [320, y, z], [320, 0, z], 0.8 * light);
  const x0 = shelf.x;
  const x1 = shelf.x + SHELF.widthCm;
  cone(
    ctx,
    frame,
    [[x0 + 4, shelf.y, 2], [x1 - 4, shelf.y, 2], [x1 - 4, shelf.y, 22], [x0 + 4, shelf.y, 22]],
    [[x0 - 46, 0, 0], [x1 + 46, 0, 0], [x1 + 30, 0, 96], [x0 - 30, 0, 96]],
    [(x0 + x1) / 2, shelf.y, 12],
    [(x0 + x1) / 2, 0, 40],
    0.9 * light,
  );
  cone(
    ctx,
    frame,
    [[609, 192, 11], [629, 192, 11], [629, 192, 31], [609, 192, 31]],
    [[556, H, 0], [W, H, 0], [W, H, 76], [556, H, 76]],
    [619, 192, 21],
    [610, H, 30],
    0.75 * light,
  );
}

function paintBus(ctx, frame) {
  const { view, runs, time, presence } = frame;
  const energy = 0.3 + 0.7 * presence.orbit;
  ctx.lineCap = 'round';
  ctx.beginPath();
  strokeWorld(ctx, view, TRACK[0], TRACK[1]);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(232, 146, 58, 0.16)';
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.78)';
  ctx.stroke();

  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (let r = 1; r < runs.length; r += 1) {
    const pts = runs[r].points;
    for (let i = 1; i < pts.length; i += 1) strokeWorld(ctx, view, pts[i - 1], pts[i]);
  }
  for (const [a, b] of PENDANT_CABLES) strokeWorld(ctx, view, a, b);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(240, 178, 115, 0.34)';
  ctx.stroke();
  ctx.restore();

  const spacing = PULSE_SPACING_CM;
  for (const run of runs) {
    const head = (((time * PULSE_SPEED_CM_S - run.offset) % spacing) + spacing) % spacing;
    for (let s = head; s <= run.total; s += spacing) {
      const p = project(view, pointOnRun(run, s));
      if (!p) continue;
      const tail = project(view, pointOnRun(run, Math.max(0, s - 34)));
      if (tail) {
        const g = ctx.createLinearGradient(tail[0], tail[1], p[0], p[1]);
        g.addColorStop(0, 'rgba(232, 146, 58, 0)');
        g.addColorStop(1, `rgba(255, 210, 140, ${(0.85 * energy).toFixed(3)})`);
        ctx.beginPath();
        ctx.moveTo(tail[0], tail[1]);
        ctx.lineTo(p[0], p[1]);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = g;
        ctx.stroke();
      }
      const radius = 9;
      const halo = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], radius);
      halo.addColorStop(0, `rgba(255, 236, 196, ${energy.toFixed(3)})`);
      halo.addColorStop(0.3, `rgba(255, 186, 100, ${(0.55 * energy).toFixed(3)})`);
      halo.addColorStop(1, 'rgba(232, 146, 58, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(p[0] - radius, p[1] - radius, radius * 2, radius * 2);
    }
  }
}

/* ---------- furniture ---------- */

function boxFaces(b) {
  const [x0, y0, z0] = b.min;
  const [x1, y1, z1] = b.max;
  return [
    { n: [0, 1, 0], c: [(x0 + x1) / 2, y1, (z0 + z1) / 2], tone: 'top', pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, -1, 0], c: [(x0 + x1) / 2, y0, (z0 + z1) / 2], tone: 'bottom', pts: [[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]] },
    { n: [-1, 0, 0], c: [x0, (y0 + y1) / 2, (z0 + z1) / 2], tone: 'side', pts: [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] },
    { n: [1, 0, 0], c: [x1, (y0 + y1) / 2, (z0 + z1) / 2], tone: 'side', pts: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]] },
    { n: [0, 0, -1], c: [(x0 + x1) / 2, (y0 + y1) / 2, z0], tone: 'front', pts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]] },
    { n: [0, 0, 1], c: [(x0 + x1) / 2, (y0 + y1) / 2, z1], tone: 'front', pts: [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]] },
  ];
}

function paintBox(ctx, frame, b, outline) {
  const { view } = frame;
  const palette = PALETTE[b.palette];
  for (const face of boxFaces(b)) {
    const e = view.eye;
    if ((e[0] - face.c[0]) * face.n[0] + (e[1] - face.c[1]) * face.n[1] + (e[2] - face.c[2]) * face.n[2] <= 0) continue;
    const pts = fillWorld(ctx, view, face.pts, palette[face.tone]);
    if (pts && outline) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = outline;
      ctx.stroke();
    }
  }
}

function objectDepth(view, obj) {
  const b = obj.boxes[0];
  const c = toCamera(view, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
  return c[2];
}

function paintObjects(ctx, frame) {
  const { view, shelf, presence } = frame;
  const selected = presence.gizmo;
  const shelfOutline = selected > 0.05 ? `rgba(255, 255, 255, ${(0.85 * selected).toFixed(3)})` : 'rgba(232, 146, 58, 0.85)';
  const objects = [...OBJECTS, { id: 'shelf', boxes: shelfBoxes(shelf), outline: shelfOutline }];
  objects.sort((a, b) => objectDepth(view, b) - objectDepth(view, a));
  for (const obj of objects) {
    for (const b of obj.boxes) paintBox(ctx, frame, b, obj.outline ?? (b.palette === 'pendant' ? 'rgba(255, 244, 226, 0.5)' : null));
  }
}

/* ---------- act overlays ---------- */

function screenCircle(ctx, view, center, u, v, radius) {
  const pts = projectPolygon(view, circleOnPlane(center, u, v, radius));
  if (pts.length < 3) return false;
  tracePolygon(ctx, pts);
  return true;
}

function cross(ctx, p, size) {
  ctx.moveTo(p[0] - size, p[1]);
  ctx.lineTo(p[0] + size, p[1]);
  ctx.moveTo(p[0], p[1] - size);
  ctx.lineTo(p[0], p[1] + size);
}

function paintFrustum(ctx, frame) {
  const { view, presence, heading } = frame;
  const p = presence.inside;
  if (p <= 0.01) return;
  const eye = project(view, OBSERVER);
  if (!eye) return;

  ctx.save();
  ctx.globalAlpha = p;
  for (const [lag, alpha] of [
    [0.24, 0.25],
    [0.12, 0.5],
  ]) {
    const ghost = eyeFrustum(heading.at(lag));
    const ring = projectPolygon(view, ghost.ring);
    if (ring.length > 2) {
      tracePolygon(ctx, ring);
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.035 * alpha).toFixed(3)})`;
      ctx.fill();
    }
  }

  const lens = eyeFrustum(heading.now);
  const per = lens.ring.length / 4;
  ctx.globalCompositeOperation = 'lighter';
  for (let side = 0; side < 4; side += 1) {
    const edge = lens.ring.slice(side * per, side * per + per + 1);
    if (side === 3) edge.push(lens.ring[0]);
    const pts = projectPolygon(view, [OBSERVER, ...edge]);
    if (pts.length < 3) continue;
    const far = project(view, lens.centre);
    let fill = 'rgba(255, 255, 255, 0.04)';
    if (far) {
      fill = ctx.createLinearGradient(eye[0], eye[1], far[0], far[1]);
      fill.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
      fill.addColorStop(1, 'rgba(255, 255, 255, 0.025)');
    }
    tracePolygon(ctx, pts);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const ring = projectPolygon(view, lens.ring);
  if (ring.length > 2) {
    tracePolygon(ctx, ring);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  for (const corner of lens.corners) strokeWorld(ctx, view, OBSERVER, corner);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.stroke();

  const hit = project(view, lens.centre);
  ctx.beginPath();
  strokeWorld(ctx, view, OBSERVER, lens.centre);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.stroke();
  if (hit) {
    ctx.beginPath();
    ctx.rect(hit[0] - 5, hit[1] - 5, 10, 10);
    cross(ctx, hit, 11);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  strokeWorld(ctx, view, [OBSERVER[0], 0, OBSERVER[2]], OBSERVER);
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  if (screenCircle(ctx, view, [OBSERVER[0], 0.5, OBSERVER[2]], [1, 0, 0], [0, 0, 1], 22)) {
    ctx.fillStyle = 'rgba(242, 238, 231, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 238, 231, 0.6)';
    ctx.stroke();
  }
  ctx.beginPath();
  cross(ctx, eye, 8);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function arrowHead(ctx, from, to, size) {
  const a = Math.atan2(to[1] - from[1], to[0] - from[0]);
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - size * Math.cos(a - 0.42), to[1] - size * Math.sin(a - 0.42));
  ctx.lineTo(to[0] - size * Math.cos(a + 0.42), to[1] - size * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();
}

function label(ctx, text, at, color) {
  ctx.font = `500 10.5px ${MONO}`;
  const w = ctx.measureText(text).width + 12;
  const x = Math.round(at[0] - w / 2);
  const y = Math.round(at[1] - 9);
  ctx.fillStyle = 'rgba(8, 8, 10, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 18, 4);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 176, 103, 0.3)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at[0], y + 9.5);
}

function dimension(ctx, view, a, b, tick, text) {
  const seg = projectSegment(view, a, b);
  if (!seg) return;
  const len = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
  ctx.beginPath();
  ctx.moveTo(seg[0][0], seg[0][1]);
  ctx.lineTo(seg[1][0], seg[1][1]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255, 176, 103, 0.14)';
  ctx.stroke();
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = '#ffb067';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  for (const end of [a, b]) strokeWorld(ctx, view, add(end, tick), add(end, tick.map((v) => -v)));
  ctx.stroke();
  if (len > 34) label(ctx, text, [(seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2], '#ffcf9a');
}

function paintGizmo(ctx, frame) {
  const { view, presence, shelf, pose, width, height } = frame;
  const p = presence.gizmo;
  if (p <= 0.01) return;
  const { widthCm, thickCm, depthCm } = SHELF;
  const dims = shelfDimensions(shelf.snapped);
  const midY = shelf.y + thickCm / 2;
  const z = 1.2;

  ctx.save();
  ctx.globalAlpha = p;

  const travelX = pose.axis === 'x' || pose.axis === 'xy';
  const travelY = pose.axis === 'y' || pose.axis === 'xy';
  ctx.beginPath();
  if (travelX) {
    for (let x = shelf.x - 60; x <= shelf.x + 60; x += 5) {
      const snapped = Math.round(x / 5) * 5;
      const major = snapped % 25 === 0 ? 7 : 3.5;
      strokeWorld(ctx, view, [snapped, shelf.y - 12, z], [snapped, shelf.y - 12 - major, z]);
    }
  }
  if (travelY) {
    for (let y = shelf.y - 50; y <= shelf.y + 50; y += 5) {
      const snapped = Math.round(y / 5) * 5;
      const major = snapped % 25 === 0 ? 7 : 3.5;
      strokeWorld(ctx, view, [shelf.x + widthCm + 12, snapped, z], [shelf.x + widthCm + 12 + major, snapped, z]);
    }
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(246, 239, 228, 0.45)';
  ctx.stroke();

  dimension(ctx, view, [0, midY, z], [shelf.x, midY, z], [0, 6, 0], `X: ${dims.x} cm`);
  dimension(ctx, view, [shelf.x + widthCm, midY, z], [W, midY, z], [0, 6, 0], `R: ${dims.r} cm`);
  dimension(ctx, view, [shelf.x + 22, 0, z], [shelf.x + 22, shelf.y, z], [6, 0, 0], `Y: ${dims.y} cm`);
  dimension(ctx, view, [shelf.x + 88, shelf.y + thickCm, z], [shelf.x + 88, H, z], [6, 0, 0], `C: ${dims.c} cm`);

  const origin = [shelf.x + widthCm / 2, midY, depthCm + 0.5];
  const o = project(view, origin);
  if (o) {
    const cursor = [width * 0.86, height * 0.84];
    const reach = pose.lock;
    const tip = [cursor[0] + (o[0] - cursor[0]) * reach, cursor[1] + (o[1] - cursor[1]) * reach];
    const beam = ctx.createLinearGradient(cursor[0], cursor[1], o[0], o[1]);
    beam.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
    beam.addColorStop(1, 'rgba(255, 255, 255, 0.95)');
    ctx.beginPath();
    ctx.moveTo(cursor[0], cursor[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = beam;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cursor[0], cursor[1]);
    ctx.lineTo(cursor[0], cursor[1] + 17);
    ctx.lineTo(cursor[0] + 4.6, cursor[1] + 12.6);
    ctx.lineTo(cursor[0] + 11.4, cursor[1] + 12.6);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#0b0b0a';
    ctx.stroke();

    if (reach >= 0.999 && screenCircle(ctx, view, origin, [1, 0, 0], [0, 1, 0], 13)) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.stroke();
    }

    const axes = [
      ['z', [0, 0, 62]],
      ['x', [86, 0, 0]],
      ['y', [0, 74, 0]],
    ];
    for (const [axis, v] of axes) {
      const end = project(view, add(origin, v));
      if (!end) continue;
      const live = (axis === 'x' && travelX) || (axis === 'y' && travelY);
      ctx.lineCap = 'round';
      if (live) {
        ctx.beginPath();
        ctx.moveTo(o[0], o[1]);
        ctx.lineTo(end[0], end[1]);
        ctx.lineWidth = 8;
        ctx.strokeStyle = axis === 'x' ? 'rgba(255, 106, 61, 0.22)' : 'rgba(62, 224, 168, 0.22)';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(o[0], o[1]);
      ctx.lineTo(end[0], end[1]);
      ctx.lineWidth = live ? 2.8 : axis === 'z' ? 1.4 : 2;
      ctx.strokeStyle = AXIS_COLOR[axis];
      ctx.globalAlpha = p * (live || axis === 'z' ? 1 : 0.78);
      ctx.stroke();
      ctx.fillStyle = AXIS_COLOR[axis];
      arrowHead(ctx, o, end, live ? 11 : 9);
      ctx.globalAlpha = p;
    }
    ctx.fillStyle = '#0b0b0a';
    ctx.fillRect(o[0] - 4, o[1] - 4, 8, 8);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(o[0] - 4, o[1] - 4, 8, 8);
  }
  ctx.restore();
}

/* ---------- iso-lux field ---------- */

const RAMP = [
  [0, [150, 70, 22]],
  [0.35, [232, 146, 58]],
  [0.7, [240, 178, 115]],
  [1, [248, 242, 232]],
];
const BUCKETS = 18;
const LUX_REF = 640;

function rampColor(n) {
  for (let i = 1; i < RAMP.length; i += 1) {
    if (n <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const k = (n - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

const BUCKET_RGB = Array.from({ length: BUCKETS }, (_, b) => rampColor((b + 0.5) / BUCKETS).join(', '));

function paintField(ctx, frame, surfacePresence) {
  const { view, field, presence, bloom } = frame;
  const p = presence.isolux;
  if (p <= 0.01) return;
  const threshold = LUX_REF * (1 - bloom);
  const reveal = (lux) => Math.min(1, Math.max(0, (lux - threshold) / (0.2 * LUX_REF)));

  for (const surface of field.surfaces) {
    const k = surfacePresence[surface.id] * p;
    if (k <= 0.02) continue;
    const { cols, rows, values } = surface;
    const lattice = [];
    for (let j = 0; j <= rows; j += 1) {
      const row = [];
      for (let i = 0; i <= cols; i += 1) row.push(project(view, surface.point(i, j)));
      lattice.push(row);
    }
    const paths = Array.from({ length: BUCKETS }, () => null);
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const lux = (values[j][i] + values[j][i + 1] + values[j + 1][i] + values[j + 1][i + 1]) / 4;
        if (lux < 36 || reveal(lux) <= 0) continue;
        const a = lattice[j][i];
        const b = lattice[j][i + 1];
        const c = lattice[j + 1][i + 1];
        const d = lattice[j + 1][i];
        if (!a || !b || !c || !d) continue;
        const bucket = Math.min(BUCKETS - 1, Math.floor((Math.min(lux, LUX_REF) / LUX_REF) * BUCKETS));
        paths[bucket] ??= new Path2D();
        const mx = (a[0] + b[0] + c[0] + d[0]) / 4;
        const my = (a[1] + b[1] + c[1] + d[1]) / 4;
        const s = 0.84;
        const path = paths[bucket];
        path.moveTo(mx + (a[0] - mx) * s, my + (a[1] - my) * s);
        path.lineTo(mx + (b[0] - mx) * s, my + (b[1] - my) * s);
        path.lineTo(mx + (c[0] - mx) * s, my + (c[1] - my) * s);
        path.lineTo(mx + (d[0] - mx) * s, my + (d[1] - my) * s);
        path.closePath();
      }
    }
    for (let b = 0; b < BUCKETS; b += 1) {
      if (!paths[b]) continue;
      const lux = ((b + 0.5) / BUCKETS) * LUX_REF;
      const alpha = (0.14 + 0.62 * ((b + 0.5) / BUCKETS) ** 0.8) * reveal(lux) * k;
      ctx.fillStyle = `rgba(${BUCKET_RGB[b]}, ${alpha.toFixed(3)})`;
      ctx.fill(paths[b]);
    }

    for (const { level, segments } of surface.contours) {
      const show = Math.min(1, Math.max(0, (level - threshold) / (0.12 * LUX_REF))) * k;
      if (show <= 0.01 || segments.length === 0) continue;
      ctx.beginPath();
      for (const [a, b] of segments) strokeWorld(ctx, view, a, b);
      const color = level >= 500 ? '255, 248, 236' : level >= 250 ? '240, 178, 115' : '232, 146, 58';
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(${color}, ${(0.16 * show).toFixed(3)})`;
      ctx.stroke();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = `rgba(${color}, ${(0.95 * show).toFixed(3)})`;
      ctx.stroke();
    }
  }
}

/** Ring labels go on last, over the furniture, so the pendant never hides one. */
function paintFieldLabels(ctx, frame) {
  const { view, field, presence, bloom } = frame;
  const p = presence.isolux;
  if (p <= 0.01) return;
  const threshold = LUX_REF * (1 - bloom);
  for (const { level, anchor } of field.surfaces[0].labels) {
    const show = Math.min(1, Math.max(0, (level - threshold) / (0.12 * LUX_REF))) * p;
    if (show <= 0.05 || !anchor) continue;
    const at = project(view, anchor);
    if (!at) continue;
    ctx.globalAlpha = show;
    label(ctx, `${level} lx`, at, level >= 500 ? '#fff8ec' : '#ffcf9a');
    ctx.globalAlpha = 1;
  }
}

function paintProbe(ctx, frame) {
  const { view, probe } = frame;
  if (!probe) return;
  ctx.save();
  if (screenCircle(ctx, view, [probe[0], 0.8, probe[2]], [1, 0, 0], [0, 0, 1], 16)) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.stroke();
  }
  ctx.beginPath();
  strokeWorld(ctx, view, [probe[0] - 34, 0.8, probe[2]], [probe[0] + 34, 0.8, probe[2]]);
  strokeWorld(ctx, view, [probe[0], 0.8, probe[2] - 34], [probe[0], 0.8, probe[2] + 34]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.stroke();
  ctx.restore();
}

function paintCompass(ctx, frame) {
  const { view } = frame;
  const tail = project(view, [W + 80, 0, 70]);
  const tip = project(view, [W + 80, 0, -26]);
  const at = project(view, [W + 80, 0, -62]);
  if (!tail || !tip || !at) return;
  ctx.beginPath();
  ctx.moveTo(tail[0], tail[1]);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = 'rgba(242, 238, 231, 0.5)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(242, 238, 231, 0.7)';
  arrowHead(ctx, tail, tip, 8);
  ctx.font = `500 10.5px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('N', at[0], at[1]);
}

/** Paints one frame. `frame` carries the view, act presences and the live poses. */
export function paintFrame(ctx, frame) {
  const { dpr, width, height, view } = frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';

  const walls = WALLS.map((wall) => ({ wall, k: wallPresence(view, wall), depth: toCamera(view, wall.center)[2] })).sort(
    (a, b) => b.depth - a.depth,
  );
  const presenceOf = { floor: 1 };
  for (const { wall, k } of walls) presenceOf[wall.id] = k;

  paintCompass(ctx, frame);
  paintFloor(ctx, frame);
  for (const { wall, k } of walls) if (k > 0.01) paintWall(ctx, frame, wall, k);

  ctx.globalCompositeOperation = 'lighter';
  paintLightOnSurfaces(ctx, frame, presenceOf);
  ctx.globalCompositeOperation = 'source-over';

  paintField(ctx, frame, presenceOf);
  paintProbe(ctx, frame);
  paintObjects(ctx, frame);

  ctx.globalCompositeOperation = 'lighter';
  paintCones(ctx, frame);
  paintBus(ctx, frame);
  ctx.globalCompositeOperation = 'source-over';

  paintFrustum(ctx, frame);
  paintGizmo(ctx, frame);
  paintFieldLabels(ctx, frame);
  for (const { wall, k } of walls) paintCut(ctx, frame, wall, k);
}

