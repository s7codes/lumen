import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/*
 * Geometry with world-scale UVs: every texture is authored in metres, so a
 * walnut board and a walnut column show the same grain size. The grain axis
 * runs along the texture's u. A random offset per mesh keeps two boards from
 * wearing the same figure.
 */

let seed = 1;
function rand() {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

export function resetUvSeed(value = 1) {
  seed = value;
}

/** Box projection in local metres. grain: 'x' | 'y' | 'z' (default 'x'). */
export function applyBoxUv(geometry, { scale = 1, grain = 'x', offset = true } = {}) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const ou = offset ? rand() * 7.3 : 0;
  const ov = offset ? rand() * 7.3 : 0;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (grain === 'y') {
      if (ay >= ax && ay >= az) [u, v] = [x, z];
      else if (az >= ax) [u, v] = [y, x];
      else [u, v] = [y, z];
    } else if (grain === 'z') {
      if (ax >= ay && ax >= az) [u, v] = [z, y];
      else if (ay >= az) [u, v] = [z, x];
      else [u, v] = [x, y];
    } else {
      if (ay >= ax && ay >= az) [u, v] = [x, z];
      else if (az >= ax) [u, v] = [x, y];
      else [u, v] = [z, y];
    }
    uv[i * 2] = u * scale + ou;
    uv[i * 2 + 1] = v * scale + ov;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/** Cylinder or lathe: u along the axis (y), v round the circumference. */
export function applyCylinderUv(geometry, { scale = 1, axisGrain = true } = {}) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const ou = rand() * 7.3;
  const ov = rand() * 7.3;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const arc = a * Math.max(r, 0.01);
    if (axisGrain) {
      uv[i * 2] = y * scale + ou;
      uv[i * 2 + 1] = arc * scale + ov;
    } else {
      uv[i * 2] = arc * scale + ou;
      uv[i * 2 + 1] = y * scale + ov;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

export function boxGeometry([w, h, d], bevel = null) {
  const r = bevel ? Math.min(bevel.radius ?? bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4) : 0;
  if (r > 0.0005) return new RoundedBoxGeometry(w, h, d, bevel.segments ?? 3, r);
  return new THREE.BoxGeometry(w, h, d);
}

export function cylinderGeometry(rTop, rBottom, h, segments = 48) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, false);
}

export function latheGeometry(profile, segments = 64) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y)), segments);
}

/** A mesh with world-scale UVs for its material. */
export function texturedMesh(geometry, material, { grain = 'x', kind = 'box' } = {}) {
  const scale = material.userData.uvScale ?? 1;
  if (kind === 'box') applyBoxUv(geometry, { scale, grain });
  else applyCylinderUv(geometry, { scale, axisGrain: grain === 'y' });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

/** An axis-aligned slab from corner extents (metres). */
export function slab(material, x0, x1, y0, y1, z0, z1, { grain = 'x', bevel = null } = {}) {
  const geo = boxGeometry([x1 - x0, y1 - y0, z1 - z0], bevel);
  const mesh = texturedMesh(geo, material, { grain });
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return mesh;
}
