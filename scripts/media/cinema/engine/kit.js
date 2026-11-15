import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * Small scene-building kit shared by the films: planar world UVs, rounded
 * blocks, eased clocks and light helpers.
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** Sine ease in and out on 0..1. */
export function easeInOut(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
}

/**
 * Replaces a geometry's UVs with world-planar ones at `scale` metres per
 * texture tile, picking the projection plane per face from its normal.
 */
export function planarUV(geometry, scale = 1, offset = [0, 0, 0]) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i) + offset[0];
    const y = pos.getY(i) + offset[1];
    const z = pos.getZ(i) + offset[2];
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x / scale, z / scale);
    else if (nx >= nz) uv.setXY(i, z / scale, y / scale);
    else uv.setXY(i, x / scale, y / scale);
  }
  geometry.setAttribute('uv', uv);
  uv.needsUpdate = true;
  return geometry;
}

/** A rounded block from min / max corners, with planar UVs baked in world space. */
export function block(min, max, material, { radius = 0.004, segments = 3, uvScale = 1, cast = true, receive = true } = {}) {
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const r = Math.min(radius, size[0] / 2.01, size[1] / 2.01, size[2] / 2.01);
  const geometry = r > 0 ? new RoundedBoxGeometry(size[0], size[1], size[2], segments, r) : new THREE.BoxGeometry(size[0], size[1], size[2]);
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  planarUV(geometry, uvScale, center);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...center);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** A spotlight aimed at a target, with shadow settings for the accumulation renderer. */
export function spot(scene, { color, intensity, angle, penumbra = 0.5, position, target, cast = true, near = 0.05, far = 12, mapSize = 1024, bias = -0.0003, normalBias = 0.01, haze = 1, hazeRadius = 0.04, jitter = null }) {
  const light = new THREE.SpotLight(color, intensity, 0, angle, penumbra, 2);
  light.position.set(...position);
  light.target.position.set(...target);
  light.castShadow = cast;
  if (cast) {
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.camera.near = near;
    light.shadow.camera.far = far;
    light.shadow.bias = bias;
    light.shadow.normalBias = normalBias;
  }
  light.userData.haze = haze;
  light.userData.hazeRadius = hazeRadius;
  light.userData.home = { position: [...position], target: [...target] };
  light.userData.jitter = jitter;
  scene.add(light);
  scene.add(light.target);
  return light;
}

/**
 * Places a light for one sub-frame: its home pose moved by the sub-frame's
 * sample across its emitter. `jitter` is { radius } for a disc across the
 * beam, { ring: [r0, r1] } for an annulus round the vertical axis, or
 * { line: [dx, dy, dz] } for a line source of half-extent (dx, dy, dz), whose
 * target travels with it. `sub` carries `light` (a disc sample) and `line`
 * (a stratified value in -1..1).
 */
export function placeLight(light, sub, home = light.userData.home) {
  const j = light.userData.jitter;
  const [px, py, pz] = home.position;
  const [tx, ty, tz] = home.target;
  let ox = 0;
  let oy = 0;
  let oz = 0;
  if (j && sub && sub.k >= 0) {
    const [u, v] = sub.light;
    if (j.line) {
      const s = sub.line;
      ox = j.line[0] * s;
      oy = j.line[1] * s;
      oz = j.line[2] * s;
    } else if (j.ring) {
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const rr = j.ring[0] + (j.ring[1] - j.ring[0]) * r;
      ox = Math.cos(a) * rr;
      oz = Math.sin(a) * rr;
    } else if (j.radius) {
      ox = u * j.radius;
      oz = v * j.radius;
    }
  }
  light.position.set(px + ox, py + oy, pz + oz);
  light.target.position.set(tx + (j?.line ? ox : 0), ty + (j?.line ? oy : 0), tz + (j?.line ? oz : 0));
  light.target.updateMatrixWorld();
}

/** Text drawn into a canvas texture, for labels that live in the room. */
export function textTexture(text, { font = '500 64px "IBM Plex Mono"', color = '#e5c799', tracking = 0.18, pad = 24 } = {}) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 64);
  const chars = [...text];
  const widths = chars.map((c) => probe.measureText(c).width);
  const width = widths.reduce((a, b) => a + b, 0) + size * tracking * (chars.length - 1) + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(size * 1.5 + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  let x = pad;
  chars.forEach((c, i) => {
    ctx.fillText(c, x, canvas.height / 2);
    x += widths[i] + size * tracking;
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { texture: tex, aspect: canvas.width / canvas.height };
}
