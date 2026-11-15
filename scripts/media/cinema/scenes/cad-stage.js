import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRoomState } from '../../../../src/lib/room-3d.js';
import { buildScene } from '../../../../src/lib/room-scene.js';
import { AMBIENT_LX, busRuns, ISO_LEVELS, lightSources, OBJECTS, SHELF, SOURCE_SIZE_M2, STAGE_ROOM, TRACK } from '../../../../src/lib/showcase-scene.js';
import { block, DEG, placeLight, spot, textTexture } from '../engine/kit.js';
import { gridSurface, kelvin, WARM } from '../engine/materials.js';

/*
 * The CAD calibration chamber the four showcase acts are filmed in: the
 * Gallery room (640 x 520 x 300 cm) in obsidian with a 50 cm hairline
 * lattice on every face, the planner's own parametric fixtures (built by
 * src/lib/room-scene.js exactly as the 3D Spatial Studio builds them),
 * three plinths, the 24V DC bus from the ceiling rail to every node, and
 * 2700K light from the photometric sources the HUD reads.
 *
 * Units: metres in the scene, centimetres wherever src/lib speaks.
 */

export const CM = 0.01;
export const W = STAGE_ROOM.widthCm * CM;
export const D = STAGE_ROOM.depthCm * CM;
export const H = STAGE_ROOM.heightCm * CM;

const ROOM = Object.freeze({ widthCm: STAGE_ROOM.widthCm, depthCm: STAGE_ROOM.depthCm, heightCm: STAGE_ROOM.heightCm, furniture: 'none', lighting: 'night' });

export const ITEMS = Object.freeze([
  { uid: 'shelf', productId: 'floating-shelf-110', finish: 'walnut', xCm: SHELF.home.x, yCm: SHELF.home.y, led: true },
  { uid: 'pendant', productId: 'linear-pendant-150', finish: 'obsidian', xCm: 245, yCm: 206, led: true },
  { uid: 'spot-1', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 70, yCm: 266, led: true },
  { uid: 'spot-2', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 470, yCm: 266, led: true },
  { uid: 'column', productId: 'corner-floor-column-140', finish: 'walnut', xCm: 618, yCm: 0, led: true },
  { uid: 'frame', productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 236, yCm: 112, wall: 'west', led: true },
  { uid: 'sconce', productId: 'wall-sconce-80', finish: 'chalk', xCm: 150, yCm: 110, wall: 'east', led: true },
]);

export const CHAMPAGNE = new THREE.Color('#e5c799');
export const AMBER = new THREE.Color('#e8923a');
export const ORANGE = new THREE.Color('#ff7a2e');
export const GOLD = new THREE.Color('#ffd27a');

/* ---------- planner parts ---------- */

function partGeometry(part) {
  if (part.geometry === 'cylinder') return new THREE.CylinderGeometry(part.radius, part.radiusBottom ?? part.radius, part.size[1], part.segments ?? 32);
  if (part.geometry === 'lathe' && Array.isArray(part.profile) && part.profile.length >= 2) {
    return new THREE.LatheGeometry(part.profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), part.segments ?? 48);
  }
  if (part.bevel && part.bevel.radius > 0) return new RoundedBoxGeometry(part.size[0], part.size[1], part.size[2], Math.max(1, part.bevel.segments ?? 2), part.bevel.radius);
  return new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
}

const materials = new Map();
function partMaterial(part) {
  const key = [part.color, part.roughness, part.metalness, part.emissive, part.emissiveIntensity].join('|');
  if (!materials.has(key)) {
    const m = new THREE.MeshStandardMaterial({ color: part.color, roughness: Math.max(0.12, part.roughness ?? 0.6), metalness: part.metalness ?? 0 });
    if (part.emissive && part.emissiveIntensity > 0) {
      m.emissive = new THREE.Color(part.emissive);
      m.emissiveIntensity = part.emissiveIntensity * 40;
    }
    materials.set(key, m);
  }
  return materials.get(key);
}

/** One planner module as a group of its sub-parts and emitter boxes, in room metres. */
function moduleGroup(module, emitterGain) {
  const group = new THREE.Group();
  group.name = module.uid;
  for (const part of module.subparts) {
    const mesh = new THREE.Mesh(partGeometry(part), partMaterial(part));
    mesh.position.fromArray(part.position);
    mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2], 'YXZ');
    mesh.castShadow = part.shadow !== false;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const e of module.emitters) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(e.color).multiplyScalar(e.intensity * emitterGain) });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(e.size[0], e.size[1], e.size[2]), m);
    mesh.position.fromArray(e.position);
    group.add(mesh);
  }
  return group;
}

/* ---------- bus ---------- */

const BUS_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BUS_FS = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uLength;
uniform float uOffset;
uniform float uTime;
uniform float uSpeed;
uniform float uSpacing;
uniform float uBase;
uniform float uPulse;
void main() {
  float s = vUv.x * uLength + uOffset;
  float p = fract((s - uSpeed * uTime) / uSpacing) - 0.5;
  float bump = exp(-pow(p * uSpacing / 9.0, 2.0));
  gl_FragColor = vec4(uColor * (uBase + uPulse * bump), 1.0);
}
`;

/** A bus run (cm polyline) as a thin tube whose pulses travel from the driver outward. */
function busTube(run, uniforms) {
  const path = new THREE.CurvePath();
  for (let i = 1; i < run.points.length; i += 1) {
    const a = new THREE.Vector3(...run.points[i - 1]).multiplyScalar(CM);
    const b = new THREE.Vector3(...run.points[i]).multiplyScalar(CM);
    path.add(new THREE.LineCurve3(a, b));
  }
  const segments = Math.max(8, Math.round(run.total / 4));
  const geometry = new THREE.TubeGeometry(path, segments, 0.0045, 8, false);
  const material = new THREE.ShaderMaterial({
    vertexShader: BUS_VS,
    fragmentShader: BUS_FS,
    uniforms: { ...uniforms, uLength: { value: run.total }, uOffset: { value: run.offset } },
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  return mesh;
}

/* ---------- iso-lux surface ---------- */

const ISO_VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

function srgbToLinear(hex) {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

// False colour, lux to tone: obsidian, umber, deep bronze at 100, copper at
// 250, amber at 350, warm gold at 500 and pale champagne past it.
const RAMP = [
  [0, '#0e0d0c'],
  [60, '#1f150f'],
  [100, '#3f2616'],
  [175, '#653619'],
  [250, '#91461b'],
  [350, '#bf6620'],
  [500, '#e2932f'],
  [650, '#f0bb5c'],
  [820, '#f8dca0'],
];
const LINES = { 100: '#a8622c', 250: '#ff7f30', 350: '#ffae3c', 500: '#ffd76a' };

function isoFragment() {
  const stops = RAMP.map(([lx, hex]) => [lx, srgbToLinear(hex)]);
  let ramp = `vec3 ramp(float e) {\n  vec3 c = ${stops[0][1]};\n`;
  for (let i = 1; i < stops.length; i += 1) ramp += `  c = mix(c, ${stops[i][1]}, smoothstep(${stops[i - 1][0].toFixed(1)}, ${stops[i][0].toFixed(1)}, e));\n`;
  ramp += '  return c;\n}';
  const lines = ISO_LEVELS.map((level) => `  iso(e, fw, ${level.toFixed(1)}, ${srgbToLinear(LINES[level] ?? '#ffd27a')}, col);`).join('\n');
  return /* glsl */ `
precision highp float;
varying vec3 vW;
uniform vec3 uN;
uniform vec3 uSrcP[5];
uniform float uSrcI[5];
uniform float uSrcM[5];
uniform vec3 uSrcA[5];
uniform float uAmbient;
uniform float uSize;
uniform float uGain;
uniform float uLineGain;
uniform float uScanX;
uniform float uScanOn;
uniform float uGrid;

float illum(vec3 pcm) {
  float e = uAmbient;
  for (int i = 0; i < 5; i++) {
    vec3 v = (pcm - uSrcP[i]) / 100.0;
    float r2 = dot(v, v);
    if (r2 < 1e-4) continue;
    float r = sqrt(r2);
    float ca = dot(v, uSrcA[i]) / r;
    if (ca <= 0.0) continue;
    float ci = -dot(v, uN) / r;
    if (ci <= 0.0) continue;
    e += uSrcI[i] * pow(ca, uSrcM[i]) * ci / (r2 + uSize);
  }
  return e;
}

${ramp}

void iso(float e, float fw, float level, vec3 tint, inout vec3 col) {
  float d = abs(e - level) / max(fw, 1e-4);
  float halo = 1.0 - smoothstep(1.2, 3.4, d);
  float core = 1.0 - smoothstep(0.35, 1.25, d);
  col *= 1.0 - 0.55 * halo;
  col = mix(col, tint * uLineGain, core);
}

float lattice(vec3 p, float spacing) {
  vec3 q = p / spacing;
  vec3 f = abs(fract(q - 0.5) - 0.5);
  vec3 w = fwidth(q);
  vec3 l = 1.0 - smoothstep(w * 0.5, w * 1.5, f);
  float g = 0.0;
  if (abs(uN.y) < 0.5) g = max(g, l.y);
  if (abs(uN.x) < 0.5) g = max(g, l.x);
  if (abs(uN.z) < 0.5) g = max(g, l.z);
  return g;
}

void main() {
  vec3 pcm = vW * 100.0;
  float e = illum(pcm);
  vec3 col = ramp(e);
  col = mix(col, col * 0.55 + vec3(0.012, 0.01, 0.008), lattice(vW, 0.5) * uGrid);
  float fw = fwidth(e);
${lines}
  if (uScanOn > 0.5) {
    float dx = (pcm.x - uScanX);
    float band = exp(-pow(dx / 14.0, 2.0));
    float wake = (dx < 0.0) ? exp(dx / 46.0) : 0.0;
    col *= 1.0 + 0.55 * band + 0.18 * wake;
    float edge = 1.0 - smoothstep(0.4, 1.4, abs(dx) / max(fwidth(pcm.x), 1e-4));
    col = mix(col, ${srgbToLinear('#f5e3c0')} * uLineGain * 0.55, edge * 0.5);
  }
  gl_FragColor = vec4(col * uGain, 1.0);
}
`;
}

/** The iso-lux material for one face: the engine's sources, evaluated per pixel. */
export function isoSurface(normal, { gain = 2.1, lineGain = 0.8, scan = false } = {}) {
  const uniforms = {
    uN: { value: new THREE.Vector3(...normal) },
    uSrcP: { value: Array.from({ length: 5 }, () => new THREE.Vector3()) },
    uSrcI: { value: [0, 0, 0, 0, 0] },
    uSrcM: { value: [1, 1, 1, 1, 1] },
    uSrcA: { value: Array.from({ length: 5 }, () => new THREE.Vector3(0, -1, 0)) },
    uAmbient: { value: AMBIENT_LX },
    uSize: { value: SOURCE_SIZE_M2 },
    uGain: { value: gain },
    uLineGain: { value: lineGain },
    uScanX: { value: -1000 },
    uScanOn: { value: scan ? 1 : 0 },
    uGrid: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: ISO_VS, fragmentShader: isoFragment(), uniforms, side: THREE.FrontSide });
  material.extensions = { derivatives: true };
  return material;
}

/** Loads the engine's sources (with the pendant at `dim`) into iso-lux materials. */
export function setIsoSources(materials, shelf, dim) {
  const sources = lightSources(shelf, dim);
  for (const m of materials) {
    sources.forEach((src, i) => {
      m.uniforms.uSrcP.value[i].set(...src.p);
      m.uniforms.uSrcI.value[i] = src.i;
      m.uniforms.uSrcM.value[i] = src.m;
      m.uniforms.uSrcA.value[i].set(...src.axis);
    });
  }
}

/* ---------- the chamber ---------- */

function plane(width, height, material, position, rotation) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.receiveShadow = true;
  return mesh;
}

function floorLabel(scene, text, position, rotationY, width) {
  const { texture, aspect } = textTexture(text, { font: '500 96px "IBM Plex Mono"', color: '#ffffff', tracking: 0.28, pad: 20 });
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, color: CHAMPAGNE.clone().multiplyScalar(0.42), polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / aspect), material);
  // Laid flat (X), then turned about the vertical (Y) so it reads from inside the room.
  mesh.rotation.set(-Math.PI / 2, rotationY, 0, 'YXZ');
  mesh.position.set(position[0], 0.003, position[2]);
  scene.add(mesh);
  return mesh;
}

/**
 * Builds the chamber. Options: `act` (which film), `iso` (false-colour
 * floor and walls), `accents` (track spots and wall grazers on).
 */
export function buildChamber(engine, { iso = false, accents = true, compass = true, bus = true, pendantCd = 3300 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);

  // Shell: every face points into the room, so a face between the camera and
  // the room is culled and the orbit sees in, as the planner's section cut does.
  // Obsidian (#0e0d0c where no light falls) with bronze hairlines every 50 cm.
  const line = new THREE.Color('#7a6a56');
  const floorMat = gridSurface({ color: '#0e0d0c', roughness: 0.8, specular: 0, spacing: 0.5, line, glow: 0.16, reflect: 0.055, width: 0.9 });
  const wallMat = gridSurface({ color: '#0e0d0c', roughness: 0.85, specular: 0, spacing: 0.5, line, glow: 0.14, reflect: 0.055, width: 0.9 });
  const ceilingMat = gridSurface({ color: '#0b0a09', roughness: 0.9, specular: 0.25, spacing: 0.5, line, glow: 0.1, reflect: 0.08, width: 0.9 });
  const isoMats = [];
  const surface = (normal, fallback, scan = false) => {
    if (!iso) return fallback;
    const m = isoSurface(normal, { scan });
    isoMats.push(m);
    return m;
  };
  scene.add(plane(W, D, surface([0, 1, 0], floorMat, true), [W / 2, 0, D / 2], [-Math.PI / 2, 0, 0]));
  scene.add(plane(W, H, surface([0, 0, 1], wallMat), [W / 2, H / 2, 0], [0, 0, 0]));
  scene.add(plane(D, H, surface([-1, 0, 0], wallMat), [W, H / 2, D / 2], [0, -Math.PI / 2, 0]));
  scene.add(plane(W, H, surface([0, 0, -1], wallMat), [W / 2, H / 2, D], [0, Math.PI, 0]));
  scene.add(plane(D, H, surface([1, 0, 0], wallMat), [0, H / 2, D / 2], [0, Math.PI / 2, 0]));
  scene.add(plane(W, D, ceilingMat, [W / 2, H, D / 2], [Math.PI / 2, 0, 0]));

  // Room edges: a champagne hairline box.
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)), new THREE.LineBasicMaterial({ color: CHAMPAGNE.clone().multiplyScalar(0.7) }));
  edges.position.set(W / 2, H / 2, D / 2);
  scene.add(edges);

  // Plinths in satin obsidian with hairline edges.
  const plinthMat = new THREE.MeshStandardMaterial({ color: '#1b1917', roughness: 0.62, metalness: 0 });
  const edgeMat = new THREE.LineBasicMaterial({ color: CHAMPAGNE.clone().multiplyScalar(0.4) });
  for (const b of OBJECTS.find((o) => o.id === 'plinths').boxes) {
    const min = b.min.map((v) => v * CM);
    const max = b.max.map((v) => v * CM);
    const mesh = block(min, max, plinthMat, { radius: 0.004 });
    scene.add(mesh);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2])), edgeMat);
    e.position.copy(mesh.position);
    scene.add(e);
  }
  // A brass sphere on the first plinth.
  const first = OBJECTS.find((o) => o.id === 'plinths').boxes[0];
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.12, 96, 48), new THREE.MeshStandardMaterial({ color: '#c9a062', metalness: 1, roughness: 0.3 }));
  sphere.position.set(((first.min[0] + first.max[0]) / 2) * CM, first.max[1] * CM + 0.12, ((first.min[2] + first.max[2]) / 2) * CM);
  sphere.castShadow = true;
  sphere.receiveShadow = true;
  scene.add(sphere);

  // The planner's fixtures at home.
  const state = createRoomState(ROOM, ITEMS.map((item) => ({ ...item })), { yaw: 0, pitch: 24, zoom: 1 });
  const built = buildScene({ state });
  const groups = {};
  for (const module of built.modules) {
    const g = moduleGroup(module, 9);
    groups[module.uid] = g;
    scene.add(g);
  }

  // Ceiling rail: the 24V track along the north wall.
  const railMat = new THREE.MeshStandardMaterial({ color: '#151311', roughness: 0.4, metalness: 0.5 });
  const [ta, tb] = TRACK;
  scene.add(block([ta[0] * CM, H - 0.04, ta[2] * CM - 0.018], [tb[0] * CM, H, ta[2] * CM + 0.018], railMat, { radius: 0.002, cast: false }));

  // Bus traces with pulses.
  const busUniforms = {
    uColor: { value: AMBER.clone() },
    uTime: { value: 0 },
    uSpeed: { value: 64 },
    uSpacing: { value: 96 },
    uBase: { value: 0.7 },
    uPulse: { value: 7 },
  };
  const busGroup = new THREE.Group();
  scene.add(busGroup);
  let busShelfKey = null;
  const setBus = (shelf) => {
    const key = `${shelf.x}|${shelf.y}`;
    if (key === busShelfKey) return;
    busShelfKey = key;
    for (const child of [...busGroup.children]) {
      child.geometry.dispose();
      child.material.dispose();
      busGroup.remove(child);
    }
    for (const run of busRuns(shelf)) busGroup.add(busTube(run, busUniforms));
  };
  if (bus) setBus(SHELF.home);
  busGroup.visible = bus;

  if (compass) {
    floorLabel(scene, 'NORTH WALL', [W / 2, 0, 0.42], 0, 1.3);
    floorLabel(scene, 'SOUTH WALL', [W / 2, 0, D - 0.42], Math.PI, 1.3);
    floorLabel(scene, 'EAST WALL', [W - 0.42, 0, D / 2], -Math.PI / 2, 1.15);
    floorLabel(scene, 'WEST WALL', [0.42, 0, D / 2], Math.PI / 2, 1.15);
  }

  // Light: the HUD's photometric sources, as filmed light.
  const lights = {};
  lights.pendant = spot(scene, {
    color: WARM,
    intensity: pendantCd,
    angle: 85 * DEG,
    penumbra: 1,
    position: [3.2, 2.05, 1.9],
    target: [3.2, 0, 1.9],
    near: 0.02,
    far: 9,
    mapSize: 2048,
    bias: -0.0003,
    normalBias: 0.01,
    haze: 0.1,
    hazeRadius: 0.25,
    jitter: { line: [0.62, 0, 0] },
  });
  // The shelf's grazing downlight, filmed brighter than its 240 cd so its pool reads on obsidian.
  lights.shelf = spot(scene, {
    color: WARM,
    intensity: 620,
    angle: 72 * DEG,
    penumbra: 1,
    position: [(SHELF.home.x + SHELF.widthCm / 2) * CM, (SHELF.home.y - 1) * CM, 0.16],
    target: [(SHELF.home.x + SHELF.widthCm / 2) * CM, 0, 0.16],
    near: 0.02,
    far: 6,
    haze: 0.28,
    hazeRadius: 0.12,
    jitter: { line: [0.5, 0, 0] },
  });
  lights.column = spot(scene, {
    color: WARM,
    intensity: 380,
    angle: 70 * DEG,
    penumbra: 1,
    position: [6.19, 1.92, 0.21],
    target: [6.19, 3.5, 0.21],
    cast: false,
    haze: 0.35,
    hazeRadius: 0.12,
  });
  lights.accents = [];
  if (accents) {
    // The two directional spots on the north wall, and two grazers per other wall.
    for (const x of [0.7, 4.7]) {
      lights.accents.push(spot(scene, { color: WARM, intensity: 1500, angle: 14 * DEG, penumbra: 0.55, position: [x + 0.06, 2.6, 0.12], target: [x + 0.06, 0.9, 0.0], cast: false, haze: 2.6, hazeRadius: 0.08 }));
    }
    const graze = [
      [[6.12, 2.97, 1.5], [6.4, 0.6, 1.5]],
      [[6.12, 2.97, 3.9], [6.4, 0.6, 3.9]],
      [[1.9, 2.97, 4.92], [1.9, 0.6, 5.2]],
      [[4.5, 2.97, 4.92], [4.5, 0.6, 5.2]],
      [[0.28, 2.97, 1.2], [0, 0.6, 1.2]],
      [[0.28, 2.97, 4.55], [0, 0.6, 4.55]],
    ];
    for (const [position, target] of graze) {
      lights.accents.push(spot(scene, { color: WARM, intensity: 1200, angle: 19 * DEG, penumbra: 0.6, position, target, cast: false, haze: 2.2, hazeRadius: 0.08 }));
    }
    // Their small recessed trims in the ceiling.
    const trim = new THREE.MeshBasicMaterial({ color: WARM.clone().multiplyScalar(16) });
    for (const [position] of graze) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 32), trim);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(position[0], H - 0.002, position[2]);
      scene.add(lens);
    }
  }
  // Sconce and frame halo, quiet.
  const sconceUp = spot(scene, { color: WARM, intensity: 160, angle: 38 * DEG, penumbra: 0.9, position: [6.37, 1.36, 2.05], target: [6.37, 3, 2.05], cast: false, haze: 0 });
  const sconceDown = spot(scene, { color: WARM, intensity: 160, angle: 38 * DEG, penumbra: 0.9, position: [6.37, 1.08, 2.05], target: [6.37, 0, 2.05], cast: false, haze: 0 });
  lights.sconce = [sconceUp, sconceDown];
  const halo = new THREE.PointLight(kelvin(3000), 2.2, 0, 2);
  halo.position.set(0.3, 1.47, 3.06);
  scene.add(halo);

  // A faint fill: unlit obsidian reads as a deep #0e0d0c, never a void.
  scene.add(new THREE.HemisphereLight(new THREE.Color(1, 0.95, 0.88), new THREE.Color(0.75, 0.68, 0.6), 12));

  return {
    scene,
    groups,
    lights,
    isoMats,
    busUniforms,
    setBus,
    busGroup,
    sphere,
    placeLights(sub) {
      placeLight(lights.pendant, sub);
      placeLight(lights.shelf, sub);
    },
  };
}
