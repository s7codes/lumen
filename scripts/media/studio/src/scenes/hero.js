import * as THREE from 'three';
import { RectAreaLight } from 'three';
import { slab } from '../geometry.js';
import { LED_2700K } from '../parts.js';
import { archCamera } from '../pt.js';
import { bowl, ceilingTrack, floorMaterial, limestoneMaterial, limestoneWall, plasterMaterial, shell, sun, vessel, woodMaterial } from './kit.js';
import { daylight, placeModules } from './common.js';

// The overview hero: a limestone gallery wall. The left half stays a calm,
// evenly lit field for the copy; the right half carries the Lumen set: a
// travertine console on a walnut plinth under the Linear Suspension
// Pendant 150, a walnut Floating Shelf 110, a recessed 24V track grazing
// the stone and a Corner Floor Column 140. Daylight rakes in from a
// window to the left; the warm scene is the same room after dusk.
export default function hero() {
  const W = 6.8;
  const D = 5.8;
  const H = 2.95;
  const room = { widthCm: 680, depthCm: 580, heightCm: 295 };
  const scene = new THREE.Scene();
  const wall = plasterMaterial({ base: '#e9e2d6', depth: 0.02 });
  const ceiling = plasterMaterial({ base: '#efe9e0', seed: 33, depth: 0.01 });
  const floor = floorMaterial({ species: 'oak', sizeM: 3.6, seed: 23 });
  shell(scene, { W, D, H, wall, back: wall, floor, ceiling, plankAxis: 'x', windows: [{ wall: 'west', from: 1.3, to: 4.9, sill: 0.04, head: 2.72, mullions: 2, transom: 2.3, portal: 9 }] });
  limestoneWall(scene, { x0: 0, x1: W, y0: 0, y1: H, base: '#d8ccb5' });
  daylight(scene, { env: 0.55 });
  sun(scene, { dir: [1, -0.42, -0.5], target: [1.6, 0.6, 1.2], intensity: 7, spread: 7 });

  // Travertine console on a walnut plinth behind a shadow gap.
  const travertine = limestoneMaterial({ base: '#ddcdb0', seed: 27 });
  const walnut = woodMaterial('walnut');
  scene.add(slab(travertine, 3.55, 6.15, 0.38, 0.46, 0.02, 0.48, { bevel: { radius: 0.003, segments: 2 } }));
  scene.add(slab(walnut, 3.8, 5.9, 0.0, 0.372, 0.07, 0.4, { bevel: { radius: 0.003, segments: 2 } }));
  vessel(scene, { x: 5.62, y: 0.46, z: 0.26, h: 0.42, r: 0.13, color: '#b9aa90', roughness: 0.6 });
  bowl(scene, { x: 4.72, y: 0.46, z: 0.27, r: 0.17, h: 0.06, color: '#34302c', roughness: 0.38 });

  placeModules(scene, room, [
    { productId: 'linear-pendant-150', finish: 'obsidian', xCm: 385, yCm: 122, group: 'pendant', move: [4.6, 0.27] },
    { productId: 'floating-shelf-110', finish: 'walnut', xCm: 548, yCm: 152, group: 'shelf' },
    { productId: 'corner-floor-column-140', finish: 'walnut', xCm: 660, yCm: 0, group: 'column' },
  ]);
  ceilingTrack(scene, {
    x0: 0.25,
    x1: 6.6,
    z: 0.62,
    H,
    group: 'track',
    heads: [
      { x: 3.75, aim: [3.75, 1.45, 0.03] },
      { x: 4.6, aim: [4.6, 1.3, 0.03] },
      { x: 5.45, aim: [5.6, 1.7, 0.03] },
    ],
  });
  // A linear wall-washer in the ceiling over the copy side: after dusk it
  // keeps the limestone behind the words a warm, even field.
  const wash = new RectAreaLight(LED_2700K, 1, 3.0, 0.035);
  wash.position.set(1.75, H - 0.006, 0.62);
  wash.up.set(0, 0, 1);
  wash.lookAt(1.75, 0, -0.9);
  wash.userData.group = 'wash';
  wash.userData.intensity = 2600 / (Math.PI * 3.0 * 0.035);
  scene.add(wash);

  const camera = archCamera({ position: new THREE.Vector3(3.95, 1.38, 4.75), look: new THREE.Vector3(3.95, 1.5, 0), fovV: 41, aspect: 16 / 9 });
  const passes = [
    { name: 'sky', groups: ['sky'], env: true, background: true, spp: 1536 },
    { name: 'sun', groups: ['sun'], spp: 768 },
    { name: 'pendant', groups: ['pendant'], spp: 1024 },
    { name: 'shelf', groups: ['shelf'], spp: 768 },
    { name: 'track', groups: ['track'], spp: 1024 },
    { name: 'wash', groups: ['wash'], spp: 768 },
    { name: 'column', groups: ['column'], spp: 768 },
  ];
  const anchors = [
    { id: 'pendant', at: [4.6, 1.27, 0.27] },
    { id: 'shelf', at: [6.2, 1.55, 0.2] },
    { id: 'track', at: [4.6, 2.86, 0.62] },
    { id: 'column', at: [6.69, 1.2, 0.15] },
    { id: 'console', at: [4.0, 0.42, 0.45] },
  ];
  return { scene, camera, passes, anchors, meta: { room: 'hero' } };
}
