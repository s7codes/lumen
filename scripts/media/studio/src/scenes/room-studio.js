import * as THREE from 'three';
import { archCamera } from '../pt.js';
import { bench, ceilingTrack, floorMaterial, limestoneWall, plasterMaterial, shell, vessel } from './kit.js';
import { daylight, placeModules } from './common.js';

// Studio Wall: honed limestone carrying three walnut floating shelves, an
// oak acoustic art frame and a corner floor column, grazed by a recessed
// 24V track.
export default function studio() {
  const W = 4.25;
  const D = 5.4;
  const H = 2.85;
  const room = { widthCm: 425, depthCm: 540, heightCm: 285 };
  const scene = new THREE.Scene();
  const wall = plasterMaterial({ base: '#ebe4d8', depth: 0.02 });
  const ceiling = plasterMaterial({ base: '#f0ebe2', seed: 33, depth: 0.01 });
  const floor = floorMaterial({ species: 'oak', sizeM: 3.6, seed: 19 });
  shell(scene, { W, D, H, wall, back: wall, floor, ceiling, plankAxis: 'z', windows: [{ wall: 'west', from: 1.9, to: 4.3, sill: 0.45, head: 2.55, mullions: 1, portal: 6 }] });
  limestoneWall(scene, { x0: 0, x1: W, y0: 0, y1: H, base: '#d9ceb8' });
  daylight(scene, { env: 0.5 });
  placeModules(scene, room, [
    { productId: 'floating-shelf-110', finish: 'walnut', xCm: 70, yCm: 98, group: 'shelf' },
    { productId: 'floating-shelf-110', finish: 'walnut', xCm: 70, yCm: 140, group: 'shelf' },
    { productId: 'floating-shelf-110', finish: 'walnut', xCm: 70, yCm: 182, group: 'shelf' },
    { productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 258, yCm: 108, group: 'frame', standoff: 0.022 },
    { productId: 'corner-floor-column-140', finish: 'walnut', xCm: 403, yCm: 0, group: 'column' },
  ]);
  bench(scene, { x0: 0.62, x1: 2.0, z0: 0.08, z1: 0.46 });
  vessel(scene, { x: 1.62, y: 0.44, z: 0.27, h: 0.32, r: 0.1, color: '#c9b9a0', roughness: 0.55 });
  ceilingTrack(scene, {
    x0: 0.5,
    x1: 4.1,
    z: 0.72,
    H,
    heads: [
      { x: 1.0, aim: [1.05, 1.25, 0.04] },
      { x: 1.75, aim: [1.7, 1.25, 0.04] },
      { x: 2.83, aim: [2.83, 1.35, 0.04] },
    ],
  });
  const camera = archCamera({ position: new THREE.Vector3(2.18, 1.3, 5.1), look: new THREE.Vector3(2.18, 1.36, 0), fovV: 53, aspect: 0.8 });
  const passes = [
    { name: 'sky', groups: ['sky'], env: true, background: true, spp: 1536 },
    { name: 'shelf', groups: ['shelf'], spp: 768 },
    { name: 'track', groups: ['track'], spp: 768 },
    { name: 'column', groups: ['column'], spp: 512 },
    { name: 'frame', groups: ['frame'], spp: 512 },
  ];
  return { scene, camera, passes, meta: { room: 'studio' } };
}
