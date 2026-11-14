import * as THREE from 'three';
import { getProduct } from '@lumen/data/products.js';
import { slab } from '../geometry.js';
import { floorMaterial, plasterMaterial } from '../materials.js';
import { engineModules, moduleGroup } from '../parts.js';
import { archCamera, skyTexture } from '../pt.js';

/*
 * The catalog plinth: one part in the corner of a daylight gallery room.
 * Warm lime-plaster walls meet a white-oiled oak floor; a tall window in the
 * return wall, just out of frame, rakes soft north light across the back
 * wall from the left; the part's own 2700K channel is on. Room frame as in
 * the planner: x along the north wall, y up, z out into the room (metres
 * here, cm in the engine). The camera stands three-quarters right of the
 * part so the corner and the raking light read; verticals stay plumb.
 */

const ROOM = { widthCm: 420, depthCm: 420, heightCm: 280 };

// x, y: where the part mounts (cm, engine wall frame). yaw: camera bearing
// right of the wall normal (deg). eyeY: camera height (m). span: the width
// of wall the frame holds at the part (m). lift: framing nudge (m, + up).
const FRAMING = {
  shelf: { x: 52, y: 112, yaw: 24, eyeY: 1.42, span: 1.95, lift: 0.05 },
  cube: { x: 62, y: 104, yaw: 26, eyeY: 1.36, span: 1.05, lift: 0.02 },
  sideboard: { x: 58, y: 58, yaw: 26, eyeY: 1.18, span: 1.45, lift: 0.02 },
  lightbar: { x: 58, y: 150, yaw: 24, eyeY: 1.42, span: 1.25, lift: -0.04 },
  column: { x: 398, y: 0, yaw: -24, eyeY: 1.0, span: 2.45, lift: 0.0, depth: 0.25 },
  spot: { x: 82, y: 266, yaw: 24, eyeY: 1.72, span: 0.75, lift: -0.08 },
  frame: { x: 62, y: 104, yaw: 22, eyeY: 1.42, span: 1.2, lift: 0.0 },
  track: { x: 60, y: 277, yaw: 30, eyeY: 2.02, span: 2.1, lift: -0.16 },
  pendant: { x: 44, y: 176, yaw: 20, eyeY: 1.4, span: 2.35, lift: 0.18, depth: 0.45 },
  baffle: { x: 46, y: 118, yaw: 22, eyeY: 1.4, span: 1.75, lift: 0.0 },
  sconce: { x: 86, y: 116, yaw: 22, eyeY: 1.48, span: 1.25, lift: 0.0 },
  hub: { x: 66, y: 124, yaw: 24, eyeY: 1.4, span: 0.95, lift: 0.0 },
};

const V_FOV = 34;

function roomShell(scene) {
  const W = ROOM.widthCm / 100;
  const D = ROOM.depthCm / 100;
  const H = ROOM.heightCm / 100;
  const plaster = plasterMaterial({ base: '#e8e1d5', depth: 0.022 });
  const ceiling = plasterMaterial({ base: '#efe9df', seed: 33, depth: 0.012 });
  const floor = floorMaterial({ species: 'oak', sizeM: 3.6, seed: 11 });
  const t = 0.12;
  scene.add(slab(floor, -0.5, W + 0.5, -t, 0, -0.5, D + 0.5));
  scene.add(slab(ceiling, -0.5, W + 0.5, H, H + t, -0.5, D + 0.5));
  scene.add(slab(plaster, -0.5, W + 0.5, 0, H, -t, 0));
  // Return (west) wall with a tall window from z 0.62 m to 2.1 m.
  const winZ0 = 0.62;
  const winZ1 = 2.1;
  const sill = 0.42;
  const head = 2.48;
  scene.add(slab(plaster, -t, 0, 0, H, -0.5, winZ0));
  scene.add(slab(plaster, -t, 0, 0, H, winZ1, D + 0.5));
  scene.add(slab(plaster, -t, 0, 0, sill, winZ0, winZ1));
  scene.add(slab(plaster, -t, 0, head, H, winZ0, winZ1));
  scene.add(slab(plaster, W, W + t, 0, H, -0.5, D + 0.5));
  scene.add(slab(plaster, -0.5, W + 0.5, 0, H, D, D + t));
  // A 6 mm shadow gap where wall meets floor, in place of a skirting.
  const gap = new THREE.MeshPhysicalMaterial({ color: '#2a2622', roughness: 0.9 });
  scene.add(slab(gap, 0, W, 0, 0.006, 0, 0.004));
  scene.add(slab(gap, 0, 0.004, 0, 0.006, 0, D));

  // Window light: a portal in the opening, sampled directly so the room
  // converges fast, plus the sky the bounces and the camera see.
  const portal = new THREE.RectAreaLight('#fff4e6', 1, winZ1 - winZ0, head - sill);
  portal.position.set(-t - 0.005, (sill + head) / 2, (winZ0 + winZ1) / 2);
  portal.lookAt(new THREE.Vector3(1, (sill + head) / 2, (winZ0 + winZ1) / 2));
  portal.userData.group = 'sky';
  portal.userData.intensity = 7;
  scene.add(portal);
  return { W, D, H };
}

/** The plinth shot for one product in one finish. */
export function productShot(productId, finish, { width = 1600, height = 1200 } = {}) {
  const product = getProduct(productId);
  const f = FRAMING[product.shape] ?? FRAMING.shelf;
  const scene = new THREE.Scene();
  roomShell(scene);
  const sky = skyTexture({ scale: 1.5 });
  scene.environment = sky;
  scene.background = sky;
  scene.userData.envIntensity = 0.6;
  scene.userData.backgroundIntensity = 1;

  const [module] = engineModules([{ productId, finish, xCm: f.x, yCm: f.y }], ROOM);
  const group = moduleGroup(module, { group: 'led', standoff: product.shape === 'frame' ? 0.022 : 0 });
  scene.add(group);

  // Aim at the part's centre; stand back far enough to hold `span` of wall.
  const b = module.box;
  const centre = new THREE.Vector3((b.x0 + b.x1) / 200, (b.y0 + b.y1) / 200 + f.lift, (f.depth ?? (b.z1 / 100) / 2));
  const aspect = width / height;
  const hfov = 2 * Math.atan(Math.tan((V_FOV * Math.PI) / 360) * aspect);
  const dist = f.span / 2 / Math.tan(hfov / 2);
  const yaw = (f.yaw * Math.PI) / 180;
  const eye = new THREE.Vector3(centre.x + Math.sin(yaw) * dist, f.eyeY, centre.z + Math.cos(yaw) * dist);
  const camera = archCamera({ position: eye, look: centre, fovV: V_FOV, aspect });
  const passes = [
    { name: 'sky', groups: ['sky'], env: true, background: true, spp: 512, bounces: 6 },
    { name: 'led', groups: ['led'], env: false, background: false, spp: 384, bounces: 6 },
  ];
  return { scene, camera, passes, meta: { productId, finish, lit: product.watts > 0, shape: product.shape } };
}
