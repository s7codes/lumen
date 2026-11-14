import * as THREE from 'three';
import { engineFurniture } from '../parts.js';
import { archCamera } from '../pt.js';
import { floorMaterial, plasterMaterial, shell } from './kit.js';
import { daylight, placeModules } from './common.js';

// Bedroom Sanctuary: the planner's platform bed vignette between two walnut
// Vertical Architectural Sconces, soft light from a window on the right.
export default function bedroom() {
  const W = 4.4;
  const D = 5.4;
  const H = 2.7;
  const room = { widthCm: 440, depthCm: 540, heightCm: 270, furniture: 'bed-160' };
  const scene = new THREE.Scene();
  const wall = plasterMaterial({ base: '#ebe3d7', depth: 0.02 });
  const back = plasterMaterial({ base: '#ddd2c1', seed: 37, depth: 0.028 });
  const ceiling = plasterMaterial({ base: '#efe9df', seed: 33, depth: 0.01 });
  const floor = floorMaterial({ species: 'oak', sizeM: 3.6, seed: 17 });
  shell(scene, { W, D, H, wall, back, floor, ceiling, plankAxis: 'z', windows: [{ wall: 'east', from: 1.5, to: 3.7, sill: 0.5, head: 2.42, mullions: 1, portal: 6 }] });
  daylight(scene, { env: 0.5 });
  scene.add(engineFurniture(room, { skipKinds: ['lamp'] }));
  placeModules(scene, room, [
    { productId: 'wall-sconce-80', finish: 'walnut', xCm: 108, yCm: 92, group: 'sconce' },
    { productId: 'wall-sconce-80', finish: 'walnut', xCm: 322, yCm: 92, group: 'sconce' },
  ]);
  const camera = archCamera({ position: new THREE.Vector3(2.2, 1.18, 5.05), look: new THREE.Vector3(2.2, 1.05, 0), fovV: 52, aspect: 0.8 });
  const passes = [
    { name: 'sky', groups: ['sky'], env: true, background: true, spp: 1536 },
    { name: 'sconce', groups: ['sconce'], spp: 1024 },
  ];
  return { scene, camera, passes, meta: { room: 'bedroom' } };
}
