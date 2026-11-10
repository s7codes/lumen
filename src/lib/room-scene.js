import { getFinish, getProduct } from '../data/products.js';
import { kelvinToRgb } from './photometry.js';
import { clearanceCallouts, furnitureLayout, moduleBox } from './room-3d.js';

/*
 * Deterministic 3D compiler for the room planner. It projects the room, the
 * furniture and every mounted module through a perspective pinhole camera
 * and returns flat 2D polygons in draw order, so the view renders as plain
 * SVG with no WebGL context. Units: cm in, viewport px out.
 */

const DEG = Math.PI / 180;
const FOV_DEG = 38;
const FRAME_FILL_WIDE = 1.26;
const WIDE_ASPECT = 1.6;
const LABEL_CHAR_PX = 6;
const LABEL_PAD_PX = 10;
const LABEL_MARGIN_PX = 6;
const WALL_T = 12;
const SLAB_T = 10;
const GRID_CM = 50;
const AXIS_OVERRUN_CM = 26;
const POOL_SEGMENTS = 20;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

/* Colour */

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(color) {
  return `rgb(${color.map((c) => Math.round(Math.min(255, Math.max(0, c)))).join(', ')})`;
}

function scale(color, k) {
  return color.map((c) => c * k);
}

function mix(a, b, t) {
  return a.map((c, i) => c + (b[i] - c) * t);
}

const PALETTES = {
  night: {
    surface: { back: '#1d1c1a', left: '#181715', right: '#161513', floor: '#11100e' },
    poche: '#2c2a27',
    shade: { front: 0.58, top: 0.74, left: 0.46, right: 0.4, bottom: 0.3, back: 0.3 },
    patchPeak: 0.6,
    emitterOff: [62, 58, 53],
    shadow: 'rgba(0, 0, 0, 0.5)',
    wallShadow: 0,
  },
  daylight: {
    surface: { back: '#e7e2d9', left: '#d9d3c8', right: '#cfc8bc', floor: '#c6c0b4' },
    poche: '#2b2926',
    shade: { front: 0.94, top: 1.06, left: 0.82, right: 0.72, bottom: 0.6, back: 0.6 },
    patchPeak: 0.2,
    emitterOff: [150, 144, 134],
    shadow: 'rgba(30, 26, 20, 0.16)',
    wallShadow: 0.1,
  },
};

const FURNITURE_TONES = {
  shadow: '#0d0c0b',
  oak: '#c4a57c',
  linen: '#d8d2c6',
  'linen-hi': '#e8e3d9',
  steel: '#2c2e30',
  felt: '#5b5853',
  'felt-hi': '#68655f',
};

/* Camera */

/**
 * Orbit camera around a target on the room's centre line. Distance fits the
 * room's bounding sphere to the shorter viewport side, divided by zoom. A
 * square viewport fits the whole sphere; a wide one lets it overfill the
 * height by up to 26 percent, because a room seen from above is wider than
 * it is tall. At maximum zoom the distance still exceeds the sphere radius,
 * so every room point has positive depth and no near-plane clipping is needed.
 */
export function createRig(room, camera, viewport) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const target = [W / 2, H * 0.42, D * 0.44];
  const half = (FOV_DEG / 2) * DEG;
  const radius = 0.5 * Math.hypot(W, H, D);
  const aspect = viewport.w / viewport.h;
  const fill = 1 + (FRAME_FILL_WIDE - 1) * Math.min(1, Math.max(0, (aspect - 1) / (WIDE_ASPECT - 1)));
  const distance = radius / (Math.tan(half) * fill) / camera.zoom;
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const eye = [
    target[0] + distance * Math.sin(yaw) * Math.cos(pitch),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * Math.cos(yaw) * Math.cos(pitch),
  ];
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const focal = Math.min(viewport.w, viewport.h) / (2 * Math.tan(half));
  return { eye, forward, right, up, focal, cx: viewport.w / 2, cy: viewport.h * 0.52 };
}

export function project(rig, p) {
  const v = sub(p, rig.eye);
  const depth = Math.max(1, dot(v, rig.forward));
  const s = rig.focal / depth;
  return [rig.cx + dot(v, rig.right) * s, rig.cy - dot(v, rig.up) * s, depth];
}

function facing(rig, normal, point) {
  return dot(normal, sub(rig.eye, point)) > 0;
}

function points2d(rig, pts) {
  return pts.map((p) => project(rig, p));
}

function pointsAttr(projected) {
  return projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/* Boxes */

const FACE_DEFS = [
  { id: 'front', n: [0, 0, 1], corners: [4, 5, 7, 6] },
  { id: 'back', n: [0, 0, -1], corners: [1, 0, 2, 3] },
  { id: 'left', n: [-1, 0, 0], corners: [0, 4, 6, 2] },
  { id: 'right', n: [1, 0, 0], corners: [5, 1, 3, 7] },
  { id: 'top', n: [0, 1, 0], corners: [6, 7, 3, 2] },
  { id: 'bottom', n: [0, -1, 0], corners: [0, 1, 5, 4] },
];

// Corner index bits: 1 = x1, 2 = y1, 4 = z1. An edge joins corners that
// differ in one bit; its two faces are fixed by the other two bits.
const EDGE_DEFS = (() => {
  const faceOf = (axis, high) => ['left', 'right', 'bottom', 'top', 'back', 'front'][axis * 2 + (high ? 1 : 0)];
  const edges = [];
  for (let a = 0; a < 8; a += 1) {
    for (let bit = 0; bit < 3; bit += 1) {
      const b = a | (1 << bit);
      if (b === a) continue;
      const others = [0, 1, 2].filter((axis) => axis !== bit);
      edges.push({ a, b, faces: others.map((axis) => faceOf(axis, (a >> axis) & 1)) });
    }
  }
  return edges;
})();

function boxCorners(box) {
  return Array.from({ length: 8 }, (_, i) => [
    i & 1 ? box.x1 : box.x0,
    i & 2 ? box.y1 : box.y0,
    i & 4 ? box.z1 : box.z0,
  ]);
}

function boxCenter(box) {
  return [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
}

function boxFaces(rig, box) {
  const corners = boxCorners(box);
  const projected = corners.map((p) => project(rig, p));
  const faces = FACE_DEFS.map((def) => ({
    id: def.id,
    visible: facing(rig, def.n, corners[def.corners[0]]),
    projected: def.corners.map((i) => projected[i]),
  }));
  return { corners, projected, faces };
}

function boxEdges(geometry) {
  const visible = new Set(geometry.faces.filter((face) => face.visible).map((face) => face.id));
  return EDGE_DEFS.map(({ a, b, faces }) => {
    const [x1, y1] = geometry.projected[a];
    const [x2, y2] = geometry.projected[b];
    return { x1, y1, x2, y2, hidden: !faces.some((id) => visible.has(id)) };
  });
}

function screenBounds(projected) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of projected) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/**
 * Painter order for two disjoint axis-aligned boxes. Any plane that separates
 * them decides it: the box on the far side from the eye cannot occlude the
 * other, so it draws first. Returns -1 (a first), 1 (b first) or 0 when the
 * boxes interpenetrate and depth has to break the tie.
 */
function compareBoxes(a, b, eye) {
  const lo = ['x0', 'y0', 'z0'];
  const hi = ['x1', 'y1', 'z1'];
  for (let axis = 0; axis < 3; axis += 1) {
    if (a[hi[axis]] <= b[lo[axis]]) return eye[axis] > a[hi[axis]] ? -1 : 1;
    if (b[hi[axis]] <= a[lo[axis]]) return eye[axis] > b[hi[axis]] ? 1 : -1;
  }
  return 0;
}

/** Topological painter sort; free nodes go farthest first, cycles fall back to depth. */
function orderSolids(solids, eye) {
  const n = solids.length;
  const after = Array.from({ length: n }, () => []);
  const indegree = new Array(n).fill(0);

  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (!boundsOverlap(solids[i].bounds, solids[j].bounds)) continue;
      const order = compareBoxes(solids[i].box, solids[j].box, eye);
      if (order === 0) continue;
      const [first, second] = order < 0 ? [i, j] : [j, i];
      after[first].push(second);
      indegree[second] += 1;
    }
  }

  const done = new Array(n).fill(false);
  const result = [];
  while (result.length < n) {
    let pick = -1;
    for (let i = 0; i < n; i += 1) {
      if (done[i] || indegree[i] > 0) continue;
      if (pick === -1 || solids[i].distance > solids[pick].distance) pick = i;
    }
    if (pick === -1) {
      for (let i = 0; i < n; i += 1) {
        if (!done[i] && (pick === -1 || solids[i].distance > solids[pick].distance)) pick = i;
      }
    }
    done[pick] = true;
    result.push(solids[pick]);
    for (const next of after[pick]) indegree[next] -= 1;
  }
  return result;
}

/* Room shell: section-cut slabs around an open front and an open ceiling */

function shellSlabs(room, rig) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const slabs = [
    { id: 'floor', interior: 'top', box: { x0: -WALL_T, x1: W + WALL_T, y0: -SLAB_T, y1: 0, z0: -WALL_T, z1: D } },
    { id: 'back', interior: 'front', box: { x0: -WALL_T, x1: W + WALL_T, y0: 0, y1: H, z0: -WALL_T, z1: 0 } },
  ];
  // A side wall is drawn only while the eye is inside its plane: past it, the
  // wall would stand between the camera and the room, so it is cut away.
  if (rig.eye[0] > 0) slabs.push({ id: 'left', interior: 'right', box: { x0: -WALL_T, x1: 0, y0: 0, y1: H, z0: 0, z1: D } });
  if (rig.eye[0] < W) slabs.push({ id: 'right', interior: 'left', box: { x0: W, x1: W + WALL_T, y0: 0, y1: H, z0: 0, z1: D } });
  return slabs;
}

function buildShell(room, rig, palette) {
  const polygons = [];
  for (const slab of shellSlabs(room, rig)) {
    const geometry = boxFaces(rig, slab.box);
    for (const face of geometry.faces) {
      if (!face.visible) continue;
      const interior = face.id === slab.interior;
      polygons.push({
        key: `${slab.id}-${face.id}`,
        surface: interior ? slab.id : null,
        fill: interior ? palette.surface[slab.id] : palette.poche,
        points: pointsAttr(face.projected),
      });
    }
  }
  return polygons;
}

function buildGrid(room, rig) {
  const { widthCm: W, depthCm: D } = room;
  const lines = [];
  const segment = (key, a, b) => {
    const [x1, y1] = project(rig, a);
    const [x2, y2] = project(rig, b);
    lines.push({ key, x1, y1, x2, y2 });
  };
  for (let x = GRID_CM; x < W; x += GRID_CM) segment(`x${x}`, [x, 0, 0], [x, 0, D]);
  for (let z = GRID_CM; z < D; z += GRID_CM) segment(`z${z}`, [0, 0, z], [W, 0, z]);
  return lines;
}

/* Light cast on the main wall and the floor */

function clampWall(room, [x, y]) {
  return [Math.min(room.widthCm, Math.max(0, x)), Math.min(room.heightCm, Math.max(0, y)), 0.4];
}

function clampFloor(room, [x, z]) {
  return [Math.min(room.widthCm, Math.max(0, x)), 0.4, Math.min(room.depthCm, Math.max(0, z))];
}

function wash(room, xa, xb, yEdge, reach, spread, direction) {
  const yFar = yEdge + direction * reach;
  const mid = (xa + xb) / 2;
  return {
    type: 'linear',
    pts: [
      [xa, yEdge],
      [xb, yEdge],
      [xb + spread, yFar],
      [xa - spread, yFar],
    ].map((p) => clampWall(room, p)),
    from: [mid, yEdge, 0.4],
    to: [mid, yFar, 0.4],
  };
}

function circle(cx, cy, r) {
  return Array.from({ length: POOL_SEGMENTS }, (_, i) => {
    const a = (i / POOL_SEGMENTS) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

function wallGlow(room, cx, cy, r) {
  return { type: 'radial', pts: circle(cx, cy, r).map((p) => clampWall(room, p)), center: [cx, cy, 0.4] };
}

function floorPool(room, cx, cz, r) {
  return { type: 'radial', pts: circle(cx, cz, r).map((p) => clampFloor(room, p)), center: [cx, 0.4, cz] };
}

/** Light patches for one lit module, as 3D polygons on the wall and floor planes. */
export function lightPatches(item, room) {
  const product = getProduct(item.productId);
  if (!item.led || product.watts === 0) return [];
  const b = moduleBox(item);
  const xMid = (b.x0 + b.x1) / 2;

  switch (product.shape) {
    case 'shelf':
      return [wash(room, b.x0 - 4, b.x1 + 4, b.y0, 78, 20, -1)];
    case 'cube':
      return [wash(room, b.x0, b.x1, b.y0, 34, 8, -1)];
    case 'sideboard': {
      const patches = [wash(room, b.x0 - 4, b.x1 + 4, b.y0, Math.min(b.y0, 90), 16, -1)];
      if (b.y0 < 80) patches.push(floorPool(room, xMid, b.z1 * 0.6, (b.x1 - b.x0) * 0.55));
      return patches;
    }
    case 'lightbar':
      return [wash(room, b.x0, b.x1, b.y0, 56, 14, -1), wash(room, b.x0, b.x1, b.y1, 56, 14, 1)];
    case 'column':
      return [wallGlow(room, xMid, b.y0 + (b.y1 - b.y0) * 0.55, 112), floorPool(room, xMid, b.z1 * 0.5 + 12, 58)];
    case 'spot':
      return [wash(room, xMid - 6, xMid + 6, b.y0, 136, 44, -1)];
    case 'frame':
      return [wallGlow(room, xMid, (b.y0 + b.y1) / 2, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.72)];
    default:
      return [];
  }
}

function buildPatches(room, items, rig, palette) {
  const patches = [];
  for (const item of items) {
    const product = getProduct(item.productId);
    const strength = Math.min(1.25, Math.max(0.55, product.lumens / 1200));
    const color = kelvinToRgb(product.kelvin ?? 2700).join(', ');
    lightPatches(item, room).forEach((patch, i) => {
      const projected = points2d(rig, patch.pts);
      const base = { key: `${item.uid}-${i}`, uid: item.uid, color, peak: palette.patchPeak * strength };
      if (patch.type === 'linear') {
        const [x1, y1] = project(rig, patch.from);
        const [x2, y2] = project(rig, patch.to);
        patches.push({ ...base, type: 'linear', points: pointsAttr(projected), x1, y1, x2, y2 });
      } else {
        const [cx, cy] = project(rig, patch.center);
        const r = Math.max(1, ...projected.map(([x, y]) => Math.hypot(x - cx, y - cy)));
        patches.push({ ...base, type: 'radial', points: pointsAttr(projected), cx, cy, r });
      }
    });
  }
  return patches;
}

/* Module surface details on the front face */

function frontRect(b, x0, x1, y0, y1) {
  const z = b.z1 + 0.05;
  return [
    [x0, y0, z],
    [x1, y0, z],
    [x1, y1, z],
    [x0, y1, z],
  ];
}

function moduleDetails(product, b) {
  const xMid = (b.x0 + b.x1) / 2;
  switch (product.shape) {
    case 'shelf':
      return [{ kind: 'emit', pts: frontRect(b, b.x0 + 2, b.x1 - 2, b.y0, b.y0 + 1.4) }];
    case 'cube':
      return [
        { kind: 'recess', pts: frontRect(b, b.x0 + 1.8, b.x1 - 1.8, b.y0 + 1.8, b.y1 - 1.8) },
        { kind: 'emit', pts: frontRect(b, b.x0 + 1.8, b.x1 - 1.8, b.y1 - 3.4, b.y1 - 1.8) },
      ];
    case 'sideboard':
      return [
        { kind: 'line', pts: frontRect(b, xMid - 0.3, xMid + 0.3, b.y0 + 1.2, b.y1 - 1.2) },
        { kind: 'emit', pts: frontRect(b, b.x0 + 2, b.x1 - 2, b.y0, b.y0 + 0.9) },
      ];
    case 'lightbar':
      return [{ kind: 'emit', pts: frontRect(b, b.x0 + 1, b.x1 - 1, b.y0 + 1.2, b.y0 + 3.6) }];
    case 'column':
      return [{ kind: 'emit', pts: frontRect(b, xMid - 3, xMid + 3, b.y0 + 4, b.y1 - 6) }];
    case 'spot':
      return [{ kind: 'emit', pts: frontRect(b, b.x0 + 3, b.x1 - 3, b.y0 + 1, b.y0 + 4) }];
    case 'frame':
      return [{ kind: 'felt', pts: frontRect(b, b.x0 + 3, b.x1 - 3, b.y0 + 3, b.y1 - 3) }];
    case 'track':
      return [{ kind: 'line', pts: frontRect(b, b.x0 + 1, b.x1 - 1, b.y0 + 1.1, b.y0 + 1.9) }];
    default:
      return [];
  }
}

function detailFill(kind, lit, light, palette, shadeFront) {
  if (kind === 'emit') return lit ? rgb(light) : rgb(palette.emitterOff);
  if (kind === 'recess') return rgb(lit ? mix([12, 11, 10], light, 0.32) : [12, 11, 10]);
  if (kind === 'felt') return rgb(scale([58, 56, 52], shadeFront));
  return 'rgba(0, 0, 0, 0.42)';
}

/* Solids */

function solidFaces(geometry, base, palette) {
  return geometry.faces
    .filter((face) => face.visible)
    .map((face) => ({
      key: face.id,
      fill: rgb(scale(base, palette.shade[face.id])),
      points: pointsAttr(face.projected),
    }));
}

function moduleSolid(item, rig, palette, technical) {
  const product = getProduct(item.productId);
  const finish = getFinish(item.finish);
  const box = moduleBox(item);
  const geometry = boxFaces(rig, box);
  const base = hexToRgb(finish.hex);
  const lit = item.led && product.watts > 0;
  const light = kelvinToRgb(product.kelvin ?? 2700);
  const frontVisible = geometry.faces[0].visible;
  const details = frontVisible
    ? moduleDetails(product, box).map((detail, i) => ({
        key: `${detail.kind}-${i}`,
        kind: detail.kind,
        lit: detail.kind === 'emit' && lit,
        fill: detailFill(detail.kind, lit, light, palette, palette.shade.front),
        points: pointsAttr(points2d(rig, detail.pts)),
      }))
    : [];

  return {
    key: item.uid,
    kind: 'module',
    uid: item.uid,
    item,
    product,
    box,
    geometry,
    bounds: screenBounds(geometry.projected),
    distance: Math.hypot(...sub(boxCenter(box), rig.eye)),
    faces: solidFaces(geometry, base, palette),
    details,
    edges: technical ? boxEdges(geometry) : null,
  };
}

function furnitureSolids(furniture, rig, palette, technical) {
  if (!furniture) return [];
  return furniture.parts.map((p) => {
    const geometry = boxFaces(rig, p.box);
    return {
      key: `furniture-${p.id}`,
      kind: 'furniture',
      part: p.id,
      box: p.box,
      geometry,
      bounds: screenBounds(geometry.projected),
      distance: Math.hypot(...sub(boxCenter(p.box), rig.eye)),
      faces: solidFaces(geometry, hexToRgb(FURNITURE_TONES[p.tone]), palette),
      details: [],
      edges: technical ? boxEdges(geometry) : null,
    };
  });
}

/* Contact shadows */

function buildShadows(room, items, furniture, rig, palette) {
  const shadows = [];
  const floorQuad = (key, b, grow) => {
    const pts = [
      [b.x0 - grow, b.z0],
      [b.x1 + grow, b.z0],
      [b.x1 + grow, b.z1 + grow],
      [b.x0 - grow, b.z1 + grow],
    ].map((p) => clampFloor(room, p));
    shadows.push({ key, fill: palette.shadow, points: pointsAttr(points2d(rig, pts)) });
  };

  if (furniture) floorQuad('furniture', furniture.bounds, 4);
  for (const item of items) {
    const box = moduleBox(item);
    if (box.y0 === 0) floorQuad(`floor-${item.uid}`, box, 3);
    if (palette.wallShadow > 0 && box.y0 > 0) {
      const pts = [
        [box.x0 + 2, box.y0 - 5],
        [box.x1 + 5, box.y0 - 5],
        [box.x1 + 5, box.y1 - 3],
        [box.x0 + 2, box.y1 - 3],
      ].map((p) => clampWall(room, p));
      shadows.push({
        key: `wall-${item.uid}`,
        fill: `rgba(30, 26, 20, ${palette.wallShadow})`,
        points: pointsAttr(points2d(rig, pts)),
      });
    }
  }
  return shadows;
}

/* Technical overlay */

export function labelWidth(text) {
  return text.length * LABEL_CHAR_PX + LABEL_PAD_PX;
}

/** Keeps a label box fully inside the viewport; x is the box centre. */
function placeLabel(viewport, text, x, y) {
  const half = labelWidth(text) / 2;
  const minX = half + LABEL_MARGIN_PX;
  const maxX = viewport.w - half - LABEL_MARGIN_PX;
  const minY = 8 + LABEL_MARGIN_PX;
  const maxY = viewport.h - 8 - LABEL_MARGIN_PX;
  return {
    lx: maxX > minX ? Math.min(maxX, Math.max(minX, x)) : viewport.w / 2,
    ly: Math.min(maxY, Math.max(minY, y)),
  };
}

function segment(rig, key, a, b) {
  const [x1, y1] = project(rig, a);
  const [x2, y2] = project(rig, b);
  return { key, x1, y1, x2, y2 };
}

function buildRoomEdges(room, rig) {
  const box = { x0: 0, x1: room.widthCm, y0: 0, y1: room.heightCm, z0: 0, z1: room.depthCm };
  const geometry = boxFaces(rig, box);
  return EDGE_DEFS.map(({ a, b }, i) => {
    const [x1, y1] = geometry.projected[a];
    const [x2, y2] = geometry.projected[b];
    return { key: `room-${i}`, x1, y1, x2, y2 };
  });
}

function buildAxes(room, rig, viewport) {
  const { widthCm: W, depthCm: D, heightCm: H } = room;
  const axes = [
    { id: 'x', length: W, label: `X ${W} cm`, dir: [1, 0, 0], tick: [0, 0, 5] },
    { id: 'y', length: H, label: `Y ${H} cm`, dir: [0, 1, 0], tick: [5, 0, 0] },
    { id: 'z', length: D, label: `Z ${D} cm`, dir: [0, 0, 1], tick: [5, 0, 0] },
  ];
  return axes.map((axis) => {
    const end = axis.dir.map((c) => c * (axis.length + AXIS_OVERRUN_CM));
    const ticks = [];
    for (let t = GRID_CM; t <= axis.length; t += GRID_CM) {
      const at = axis.dir.map((c) => c * t);
      ticks.push(segment(rig, `${axis.id}${t}`, at, at.map((c, i) => c + axis.tick[i])));
    }
    const [x, y] = project(rig, axis.dir.map((c) => c * (axis.length + AXIS_OVERRUN_CM + 8)));
    return {
      id: axis.id,
      label: axis.label,
      line: segment(rig, axis.id, [0, 0, 0], end),
      ticks,
      ...placeLabel(viewport, axis.label, x, y),
    };
  });
}

function buildCallouts(state, selectedUid, rig, viewport) {
  return clearanceCallouts(state, selectedUid).map((callout) => {
    const [x1, y1] = project(rig, callout.from);
    const [x2, y2] = project(rig, callout.to);
    const length = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / length) * 4;
    const ny = ((x2 - x1) / length) * 4;
    return {
      ...callout,
      x1,
      y1,
      x2,
      y2,
      ticks: [
        { x1: x1 - nx, y1: y1 - ny, x2: x1 + nx, y2: y1 + ny },
        { x1: x2 - nx, y1: y2 - ny, x2: x2 + nx, y2: y2 + ny },
      ],
      ...placeLabel(viewport, callout.label, (x1 + x2) / 2, (y1 + y2) / 2),
    };
  });
}

function outline(solid) {
  return solid.geometry.faces
    .filter((face) => face.visible)
    .map((face) => ({ key: face.id, points: pointsAttr(face.projected) }));
}

/**
 * Compiles the room into draw-ordered 2D primitives for one camera and
 * viewport. Pure and deterministic: the same inputs give the same output.
 */
export function buildScene({ state, camera, viewport, conflicts, selectedUid, technical }) {
  const { room, items } = state;
  const palette = PALETTES[room.lighting] ?? PALETTES.night;
  const rig = createRig(room, camera, viewport);
  const furniture = furnitureLayout(room);

  const solids = orderSolids(
    [
      ...items.map((item) => moduleSolid(item, rig, palette, technical)),
      ...furnitureSolids(furniture, rig, palette, technical),
    ],
    rig.eye,
  );

  const selected = solids.find((solid) => solid.uid === selectedUid) ?? null;
  const flagged = solids.filter((solid) => solid.uid && conflicts.has(solid.uid));

  return {
    lighting: room.lighting,
    shell: buildShell(room, rig, palette),
    grid: buildGrid(room, rig),
    shadows: buildShadows(room, items, furniture, rig, palette),
    patches: buildPatches(room, items, rig, palette),
    solids,
    selection: selected ? outline(selected) : null,
    conflicts: flagged.map((solid) => ({ uid: solid.uid, faces: outline(solid) })),
    technical: technical
      ? {
          roomEdges: buildRoomEdges(room, rig),
          axes: buildAxes(room, rig, viewport),
          callouts: buildCallouts(state, selectedUid, rig, viewport),
          tags: solids
            .filter((solid) => solid.kind === 'module')
            .map((solid) => {
              const [x, y] = project(rig, [solid.box.x0, solid.box.y1, solid.box.z1]);
              const sku = solid.product.sku;
              return { uid: solid.uid, sku, ...placeLabel(viewport, sku, x + labelWidth(sku) / 2, y - 12) };
            }),
        }
      : null,
  };
}
