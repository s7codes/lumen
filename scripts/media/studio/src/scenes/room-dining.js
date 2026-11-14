import * as THREE from 'three';
import { archCamera } from '../pt.js';
import { chair, diningTable, floorMaterial, plasterMaterial, rug, shell, vessel } from './kit.js';
import { daylight, placeModules } from './common.js';

// Dining & Living: a walnut table under the Linear Suspension Pendant 150,
// a steel-framed window raking north light from the left, an acoustic art
// frame on the far wall.
export default function dining() {
  const W = 4.8;
  const D = 6.4;
  const H = 2.85;
  const room = { widthCm: 480, depthCm: 640, heightCm: 285 };
  const scene = new THREE.Scene();
  const wall = plasterMaterial({ base: '#ebe4d8', depth: 0.02 });
  const back = plasterMaterial({ base: '#e3dbcc', seed: 35, depth: 0.026 });
  const ceiling = plasterMaterial({ base: '#f0ebe2', seed: 33, depth: 0.01 });
  const floor = floorMaterial({ species: 'oak', sizeM: 3.6, seed: 13 });
  shell(scene, { W, D, H, wall, back, floor, ceiling, plankAxis: 'z', windows: [{ wall: 'west', from: 0.35, to: 3.35, sill: 0.4, head: 2.6, mullions: 2, portal: 8 }] });
  daylight(scene);
  const tz = 1.95;
  rug(scene, { x0: 0.75, x1: 4.05, z0: tz - 1.35, z1: tz + 1.35, color: '#cbc0ab' });
  diningTable(scene, { x: 2.4, z: tz, length: 2.3, width: 0.98, axis: 'x' });
  for (const x of [1.62, 2.4, 3.18]) {
    chair(scene, { x, z: tz - 0.68, angle: -Math.PI / 2 });
    chair(scene, { x: x + 0.05, z: tz + 0.7, angle: Math.PI / 2 });
  }
  vessel(scene, { x: 2.22, y: 0.75, z: tz - 0.05, h: 0.26, r: 0.085, color: '#d4c6ad', roughness: 0.55 });
  vessel(scene, { x: 2.46, y: 0.75, z: tz + 0.08, h: 0.16, r: 0.06, color: '#3d3833', roughness: 0.35 });
  placeModules(scene, room, [
    { productId: 'linear-pendant-150', finish: 'obsidian', xCm: 165, yCm: 150, group: 'pendant', move: [2.4, tz] },
    { productId: 'acoustic-art-frame-50x70', finish: 'walnut', xCm: 215, yCm: 132, group: 'frame', standoff: 0.022 },
  ]);
  const camera = archCamera({ position: new THREE.Vector3(4.15, 1.42, 6.05), look: new THREE.Vector3(1.95, 1.08, 0), fovV: 52, aspect: 0.8 });
  const passes = [
    { name: 'sky', groups: ['sky'], env: true, background: true, spp: 1536 },
    { name: 'pendant', groups: ['pendant'], spp: 1024 },
    { name: 'frame', groups: ['frame'], spp: 768 },
  ];
  return { scene, camera, passes, meta: { room: 'dining' } };
}
