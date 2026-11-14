import * as THREE from 'three';
import { PhysicalSpotLight } from 'three-gpu-pathtracer';
import { getProduct } from '@lumen/data/products.js';
import { createRoomState, DEFAULT_ROOM } from '@lumen/lib/room-3d.js';
import { buildScene } from '@lumen/lib/room-scene.js';
import { boxGeometry, cylinderGeometry, latheGeometry, texturedMesh } from './geometry.js';
import { emitterMaterial, materialForSubpart } from './materials.js';

/*
 * Lumen parts for the path tracer, built from the planner's own parametric
 * CAD records (src/lib/room-scene.js): the photographed shelf is the shelf
 * the planner places, sub-part for sub-part. The studio adds what a
 * rasteriser fakes: real area lights where each LED channel sits, a dim
 * emissive diffuser the camera sees, and IES-like spot optics.
 */

export const LED_2700K = new THREE.Color().setRGB(1.0, 0.56, 0.24, THREE.LinearSRGBColorSpace);

/** Engine module records for items on a room (cm), as the planner builds them. */
export function engineModules(items, room = {}) {
  const state = createRoomState({ ...DEFAULT_ROOM, lighting: 'night', ...room }, items.map((item, i) => ({ uid: item.uid ?? `m${i}`, led: true, ...item })));
  return buildScene({ state }).modules;
}

/** The engine's furniture reference and its styled vignette as a group. */
export function engineFurniture(room, { skipKinds = [] } = {}) {
  const state = createRoomState({ ...DEFAULT_ROOM, lighting: 'night', ...room }, []);
  const scene = buildScene({ state });
  const root = new THREE.Group();
  const skip = new Set(skipKinds);
  for (const part of scene.furniture) {
    if (part.body === true && part.size && !skip.has(part.part)) {
      root.add(subpartMesh({ id: part.part, kind: part.part, geometry: 'box', size: part.size, position: part.position, rotation: [0, 0, 0], material: part.material, color: part.color, roughness: part.roughness, metalness: part.metalness, bevel: { radius: 0.004, segments: 2 } }));
    }
    for (const sub of part.subparts) if (!skip.has(sub.kind)) root.add(subpartMesh(sub));
  }
  for (const sub of scene.furnitureVignette?.parts ?? []) if (!skip.has(sub.kind)) root.add(subpartMesh(sub));
  return root;
}

function subpartMesh(part) {
  const material = materialForSubpart(part);
  let mesh;
  if (part.geometry === 'cylinder') {
    const segments = Math.max(24, part.segments ?? 48);
    const geo = cylinderGeometry(part.radius, part.radiusBottom ?? part.radius, part.size[1], segments);
    mesh = texturedMesh(geo, material, { grain: part.grain === 'y' ? 'y' : 'x', kind: 'cylinder' });
  } else if (part.geometry === 'lathe') {
    const geo = latheGeometry(part.profile, 128);
    mesh = texturedMesh(geo, material, { grain: 'x', kind: 'cylinder' });
  } else {
    const geo = boxGeometry(part.size, part.bevel);
    mesh = texturedMesh(geo, material, { grain: part.grain ?? 'x' });
  }
  mesh.position.fromArray(part.position);
  mesh.rotation.set(part.rotation[0], part.rotation[1], part.rotation[2], 'YXZ');
  mesh.name = part.id;
  return mesh;
}

/** Radiance (cd/m^2-like) of a Lambertian emitter of `area` m^2 giving `lumens`. */
function luminance(lumens, area) {
  return lumens / (Math.PI * Math.max(area, 1e-5));
}

function rectLight(color, intensity, width, height, position, normal, group) {
  const light = new THREE.RectAreaLight(color, intensity, width, height);
  light.position.copy(position);
  // The path tracer lights the side a ray reaches travelling along u x v, so
  // a rect light shines along its local -Z: aim it at position + normal. A
  // plumb normal needs a horizontal up vector or lookAt degenerates.
  if (Math.abs(normal.y) > 0.9) light.up.set(0, 0, 1);
  light.lookAt(position.clone().add(normal));
  light.userData.group = group;
  light.userData.intensity = intensity;
  return light;
}

function spotLight(color, candela, position, target, halfAngle, penumbra, radius, group) {
  const light = new PhysicalSpotLight(color, candela);
  light.position.copy(position);
  light.target.position.copy(target);
  light.angle = halfAngle;
  light.penumbra = penumbra;
  light.radius = radius;
  light.decay = 2;
  light.distance = 0;
  light.userData.group = group;
  light.userData.intensity = candela;
  return light;
}

const v = (a) => new THREE.Vector3().fromArray(a);

/**
 * Area and spot lights for one module, from its emitters and the engine's
 * light aims. Returns [lights, emitterMeshes].
 */
function moduleLights(module, { group, level = 1, halo = null }) {
  const product = getProduct(module.productId);
  const lights = [];
  const meshes = [];
  if (!product.watts || !module.led) return [lights, meshes];
  const lumens = product.lumens * level;
  const color = LED_2700K;
  const shape = module.shape;
  const engineLights = module.lights;

  // The visible diffuser: a thin glowing box where the engine draws it.
  for (const e of module.emitters) {
    const geo = new THREE.BoxGeometry(...e.size);
    const mesh = new THREE.Mesh(geo, null);
    mesh.position.fromArray(e.position);
    mesh.userData.emitterSize = e.size;
    meshes.push(mesh);
  }

  const dirOf = (light) => {
    if (light.type === 'spot') return v(light.target).sub(v(light.position)).normalize();
    return null;
  };

  if (shape === 'shelf' || shape === 'cube' || shape === 'sideboard' || shape === 'pendant') {
    const e = module.emitters[0];
    const [w, , d] = e.size;
    const width = Math.max(w, 0.02);
    const depth = Math.max(d, 0.012);
    const L = luminance(lumens, width * depth);
    const pos = v(e.position).add(new THREE.Vector3(0, -e.size[1] / 2 - 0.0008, 0));
    // Wall modules are along x on the north wall; the module rotation turns them.
    lights.push(rectLight(color, L, width, depth, pos, new THREE.Vector3(0, -1, 0), group));
  } else if (shape === 'lightbar') {
    const e = module.emitters[0];
    const w = e.size[0];
    const L = luminance(lumens / 2, w * 0.03);
    const base = v(e.position);
    lights.push(rectLight(color, L, w, 0.03, base.clone().add(new THREE.Vector3(0, -0.026, -0.015)), new THREE.Vector3(0, -1, 0.15).normalize(), group));
    lights.push(rectLight(color, L, w, 0.03, base.clone().add(new THREE.Vector3(0, 0.026, -0.015)), new THREE.Vector3(0, 1, 0.15).normalize(), group));
  } else if (shape === 'column') {
    const e = module.emitters[0];
    const [w, h] = e.size;
    const normal = v(engineLights[0].position).sub(v(e.position)).setY(0).normalize();
    const L = luminance(lumens, w * h);
    lights.push(rectLight(color, L, Math.max(w, 0.02), h, v(e.position).add(normal.clone().multiplyScalar(e.size[2] / 2 + 0.001)), normal, group));
  } else if (shape === 'spot') {
    const l = engineLights[0];
    const half = (13 * Math.PI) / 180;
    const omega = 2 * Math.PI * (1 - Math.cos(half));
    lights.push(spotLight(color, lumens / omega, v(l.position), v(l.target), half, 0.35, 0.022, group));
  } else if (shape === 'sconce') {
    const half = (17 * Math.PI) / 180;
    const omega = 2 * Math.PI * (1 - Math.cos(half));
    for (const l of engineLights) {
      const dir = dirOf(l);
      const from = v(l.position).add(new THREE.Vector3(0, 0, -0.025));
      const to = from.clone().add(new THREE.Vector3(0, Math.sign(dir.y), 0));
      lights.push(spotLight(color, lumens / 2 / omega, from, to, half, 0.45, 0.014, group));
    }
  } else if (shape === 'frame' && halo) {
    // A rear halo: the frame stands off the wall and its perimeter LED washes the plaster.
    const { x, y, w, h, z } = halo;
    const L = luminance(lumens, w * h);
    lights.push(rectLight(color, L, w, h, new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, -1), group));
  }

  // Diffusers glow at a tenth of their light's radiance: the camera reads them
  // as white-hot, and their extra light stays a few percent of the area light's.
  const radiance = lights.length ? lights[0].intensity * 0.12 : 1;
  for (const mesh of meshes) mesh.material = emitterMaterial(color, radiance, group);
  return [lights, meshes];
}

/**
 * One engine module as a THREE.Group: its sub-parts, glowing diffusers and
 * lights. `standoff` (m) pulls a wall part off the plaster (the frame halo).
 */
export function moduleGroup(module, { group = 'led', level = 1, standoff = 0 } = {}) {
  const root = new THREE.Group();
  root.name = module.uid;
  const parts = new THREE.Group();
  for (const part of module.subparts) parts.add(subpartMesh(part));
  root.add(parts);
  let halo = null;
  if (module.shape === 'frame') {
    const b = module.box;
    halo = { x: ((b.x0 + b.x1) / 2) / 100, y: ((b.y0 + b.y1) / 2) / 100, w: ((b.x1 - b.x0) / 100) * 0.82, h: ((b.y1 - b.y0) / 100) * 0.86, z: standoff * 0.5 + 0.001 };
    parts.position.z += standoff;
  }
  const [lights, emitters] = moduleLights(module, { group, level, halo });
  for (const e of emitters) {
    e.position.z += module.shape === 'frame' ? standoff : 0;
    root.add(e);
  }
  for (const light of lights) {
    root.add(light);
    if (light.target) root.add(light.target);
  }
  root.userData.lights = lights;
  return root;
}
