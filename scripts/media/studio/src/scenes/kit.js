import * as THREE from 'three';
import { PhysicalSpotLight } from 'three-gpu-pathtracer';
import { boxGeometry, cylinderGeometry, latheGeometry, slab, texturedMesh } from '../geometry.js';
import { anodisedMaterial, ceramicMaterial, feltMaterial, floorMaterial, limestoneMaterial, matteMaterial, plasterMaterial, woodMaterial } from '../materials.js';
import { LED_2700K } from '../parts.js';

/*
 * Interior kit for the room and hero shots: shells with real window
 * openings, limestone cladding with physical reveals, a soft sun, recessed
 * track spots and the furniture the engine does not model (a dining table,
 * chairs, a bench). Metres, room frame as the planner's.
 */

export const STEEL = () => matteMaterial('#1b1a19', 0.55);

/**
 * Walls, floor and ceiling. windows: [{ wall: 'west'|'east'|'north',
 * from, to (along the wall), sill, head, mullions, portal }]. Each window
 * gets a slim black steel frame and a portal light (group 'sky').
 */
export function shell(scene, { W, D, H, wall, back = null, floor, ceiling, windows = [], plankAxis = 'x' }) {
  const t = 0.14;
  const f = slab(floor, -0.5, W + 0.5, -t, 0, -0.5, D + 0.5, { grain: plankAxis });
  scene.add(f);
  scene.add(slab(ceiling, -0.5, W + 0.5, H, H + t, -0.5, D + 0.5));
  const walls = {
    north: { mat: back ?? wall, along: [-0.5, W + 0.5], build: (a0, a1, y0, y1) => slab(back ?? wall, a0, a1, y0, y1, -t, 0) },
    south: { mat: wall, along: [-0.5, W + 0.5], build: (a0, a1, y0, y1) => slab(wall, a0, a1, y0, y1, D, D + t) },
    west: { mat: wall, along: [-0.5, D + 0.5], build: (a0, a1, y0, y1) => slab(wall, -t, 0, y0, y1, a0, a1, { grain: 'z' }) },
    east: { mat: wall, along: [-0.5, D + 0.5], build: (a0, a1, y0, y1) => slab(wall, W, W + t, y0, y1, a0, a1, { grain: 'z' }) },
  };
  for (const [name, spec] of Object.entries(walls)) {
    const openings = windows.filter((w) => w.wall === name).sort((a, b) => a.from - b.from);
    let cursor = spec.along[0];
    for (const win of openings) {
      scene.add(spec.build(cursor, win.from, 0, H));
      scene.add(spec.build(win.from, win.to, 0, win.sill));
      scene.add(spec.build(win.from, win.to, win.head, H));
      cursor = win.to;
      windowFrame(scene, name, win, { W, D, t });
    }
    scene.add(spec.build(cursor, spec.along[1], 0, H));
  }
  // Shadow gap at the foot of every wall, in place of a skirting.
  const gap = matteMaterial('#25221f', 0.9);
  scene.add(slab(gap, 0, W, 0, 0.008, 0, 0.005));
  scene.add(slab(gap, 0, 0.005, 0, 0.008, 0, D));
  scene.add(slab(gap, W - 0.005, W, 0, 0.008, 0, D));
}

function windowFrame(scene, wallName, win, { W, t }) {
  const steel = STEEL();
  const bar = 0.045;
  const depth = 0.06;
  // In the wall frame: a along the wall, y up, n out of the wall plane (into the room is +n).
  const place = (a0, a1, y0, y1, n0, n1) => {
    if (wallName === 'north') return slab(steel, a0, a1, y0, y1, -n1, -n0);
    if (wallName === 'west') return slab(steel, -n1, -n0, y0, y1, a0, a1, { grain: 'z' });
    if (wallName === 'east') return slab(steel, W + n0, W + n1, y0, y1, a0, a1, { grain: 'z' });
    return slab(steel, a0, a1, y0, y1, n0, n1);
  };
  const n0 = t * 0.35;
  const n1 = n0 + depth;
  scene.add(place(win.from, win.from + bar, win.sill, win.head, n0, n1));
  scene.add(place(win.to - bar, win.to, win.sill, win.head, n0, n1));
  scene.add(place(win.from, win.to, win.sill, win.sill + bar, n0, n1));
  scene.add(place(win.from, win.to, win.head - bar, win.head, n0, n1));
  const mullions = win.mullions ?? 1;
  for (let k = 1; k <= mullions; k += 1) {
    const a = win.from + ((win.to - win.from) * k) / (mullions + 1);
    scene.add(place(a - bar * 0.4, a + bar * 0.4, win.sill, win.head, n0, n1));
  }
  if (win.transom) scene.add(place(win.from, win.to, win.transom - bar * 0.4, win.transom + bar * 0.4, n0, n1));
  // Deep reveal: the jambs and the sill of the opening in warm plaster.
  // (The wall slabs already form them.)
  const portal = new THREE.RectAreaLight(win.tint ?? '#fff3e4', 1, win.to - win.from, win.head - win.sill);
  const mid = (win.from + win.to) / 2;
  const my = (win.sill + win.head) / 2;
  const out = t + 0.02;
  if (wallName === 'west') {
    portal.position.set(-out, my, mid);
    portal.lookAt(1, my, mid);
  } else if (wallName === 'east') {
    portal.position.set(W + out, my, mid);
    portal.lookAt(W - 1, my, mid);
  } else if (wallName === 'north') {
    portal.position.set(mid, my, -out);
    portal.lookAt(mid, my, 1);
  }
  portal.userData.group = win.group ?? 'sky';
  portal.userData.intensity = win.portal ?? 7;
  scene.add(portal);
}

/**
 * A soft sun: a distant spot with a disc the size the real sun subtends, so
 * shadows open into a penumbra with distance. dir points from the sun to
 * the room.
 */
export function sun(scene, { dir, target, intensity = 6, group = 'sun', spread = 6 }) {
  const d = new THREE.Vector3(...dir).normalize();
  const tgt = new THREE.Vector3(...target);
  const dist = 40;
  const light = new PhysicalSpotLight('#fff1dc', intensity);
  light.position.copy(tgt.clone().addScaledVector(d, -dist));
  light.target.position.copy(tgt);
  light.angle = (spread * Math.PI) / 180;
  light.penumbra = 0.05;
  light.decay = 0;
  light.distance = 0;
  light.radius = dist * Math.tan((0.27 * Math.PI) / 180);
  light.userData.group = group;
  light.userData.intensity = intensity;
  scene.add(light, light.target);
  return light;
}

/**
 * Honed limestone cladding on the north wall: courses of slabs with 3 mm
 * open reveals over a dark backing, so a grazing light catches every joint.
 */
function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.r = Math.min(1, c.r * k);
  c.g = Math.min(1, c.g * k);
  c.b = Math.min(1, c.b * (k > 1 ? k * 0.995 : k * 1.005));
  return `#${c.getHexString()}`;
}

export function limestoneWall(scene, { x0, x1, y0 = 0, y1, slabW = 1.2, slabH = 0.6, depth = 0.03, base = '#d6cab3', seed = 21 }) {
  const tones = [1, 0.975, 1.02, 0.99].map((k, i) => limestoneMaterial({ base: shade(base, k), seed: seed + i * 13 }));
  let pick = seed * 7919;
  const nextStone = () => {
    pick = (pick * 16807) % 2147483647;
    return tones[pick % tones.length];
  };
  const back = matteMaterial('#3a342c', 0.9);
  scene.add(slab(back, x0, x1, y0, y1, -0.002, 0.004));
  const gap = 0.003;
  let row = 0;
  for (let y = y0; y < y1 - 1e-3; y += slabH) {
    const yt = Math.min(y1, y + slabH);
    const offset = row % 2 ? slabW / 2 : 0;
    for (let x = x0 - offset; x < x1 - 1e-3; x += slabW) {
      const a = Math.max(x0, x) + (x > x0 ? gap / 2 : 0);
      const b = Math.min(x1, x + slabW) - (x + slabW < x1 ? gap / 2 : 0);
      if (b - a < 0.02) continue;
      const s = slab(nextStone(), a, b, y + (y > y0 ? gap / 2 : 0), yt - (yt < y1 ? gap / 2 : 0), 0.004, 0.004 + depth, { grain: 'x' });
      scene.add(s);
    }
    row += 1;
  }
}

/**
 * A recessed 24V track in the ceiling along x at depth z, with monopoint
 * heads aimed at points on the walls. Returns the lights.
 */
export function ceilingTrack(scene, { x0, x1, z, H, heads, group = 'track', lumens = 520, halfDeg = 12, cutCeiling = null }) {
  const steel = anodisedMaterial('#1c1d1f');
  const dark = matteMaterial('#0e0d0c', 0.8);
  // The slot: a dark channel 4 cm wide just under the ceiling plane.
  scene.add(slab(dark, x0, x1, H - 0.004, H + 0.03, z - 0.02, z + 0.02));
  const lights = [];
  for (const head of heads) {
    const at = new THREE.Vector3(head.x, H - 0.03, z);
    const aim = new THREE.Vector3(...head.aim);
    const dir = aim.clone().sub(at).normalize();
    // Adapter in the slot, a short stem, and a cylindrical head on the beam axis.
    const adapter = new THREE.Mesh(boxGeometry([0.05, 0.026, 0.032], { radius: 0.003, segments: 2 }), steel);
    adapter.position.set(head.x, H - 0.013, z);
    scene.add(adapter);
    const bodyLen = 0.11;
    const r = 0.031;
    const centre = at.clone().addScaledVector(dir, 0.045 + bodyLen / 2);
    const body = new THREE.Mesh(cylinderGeometry(r, r, bodyLen, 48), steel);
    body.position.copy(centre);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    scene.add(body);
    const stem = new THREE.Mesh(cylinderGeometry(0.006, 0.006, 0.06, 16), steel);
    stem.position.copy(at.clone().addScaledVector(dir, 0.02));
    scene.add(stem);
    // A black baffle and a warm glowing aperture at the mouth.
    const mouth = at.clone().addScaledVector(dir, 0.045 + bodyLen);
    const baffle = new THREE.Mesh(cylinderGeometry(r * 0.86, r * 0.86, 0.004, 40), dark);
    baffle.position.copy(mouth.clone().addScaledVector(dir, -0.008));
    baffle.quaternion.copy(body.quaternion);
    scene.add(baffle);
    const omega = 2 * Math.PI * (1 - Math.cos((halfDeg * Math.PI) / 180));
    const light = new PhysicalSpotLight(LED_2700K, (lumens * (head.level ?? 1)) / omega);
    light.position.copy(mouth.clone().addScaledVector(dir, 0.002));
    light.target.position.copy(aim);
    light.angle = (halfDeg * Math.PI) / 180;
    light.penumbra = 0.35;
    light.radius = 0.016;
    light.decay = 2;
    light.distance = 0;
    light.userData.group = head.group ?? group;
    light.userData.intensity = light.intensity;
    scene.add(light, light.target);
    lights.push(light);
    const glow = new THREE.Mesh(cylinderGeometry(r * 0.5, r * 0.5, 0.002, 32), new THREE.MeshPhysicalMaterial({ color: '#f4efe6', emissive: LED_2700K, emissiveIntensity: light.intensity * 0.04, roughness: 0.6 }));
    glow.material.userData.group = head.group ?? group;
    glow.material.userData.emissiveIntensity = glow.material.emissiveIntensity;
    glow.position.copy(mouth.clone().addScaledVector(dir, -0.006));
    glow.quaternion.copy(body.quaternion);
    scene.add(glow);
  }
  void cutCeiling;
  return lights;
}

/** A solid walnut dining table, long axis along z. */
export function diningTable(scene, { x, z, length = 2.2, width = 0.95, height = 0.75, species = 'walnut', axis = 'z' }) {
  if (axis === 'x') {
    const g = new THREE.Group();
    diningTable(g, { x: 0, z: 0, length, width, height, species, axis: 'z' });
    g.position.set(x, 0, z);
    g.rotation.y = Math.PI / 2;
    scene.add(g);
    return;
  }
  const wood = woodMaterial(species);
  const top = 0.042;
  scene.add(slab(wood, x - width / 2, x + width / 2, height - top, height, z - length / 2, z + length / 2, { grain: 'z', bevel: { radius: 0.006, segments: 3 } }));
  const leg = 0.07;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = x + sx * (width / 2 - 0.09);
      const lz = z + sz * (length / 2 - 0.16);
      scene.add(slab(wood, lx - leg / 2, lx + leg / 2, 0, height - top, lz - leg / 2, lz + leg / 2, { grain: 'y', bevel: { radius: 0.004, segments: 2 } }));
    }
    // Apron rails under the top.
    const ax = x + sx * (width / 2 - 0.09);
    scene.add(slab(wood, ax - 0.012, ax + 0.012, height - top - 0.09, height - top, z - length / 2 + 0.2, z + length / 2 - 0.2, { grain: 'z' }));
  }
}

/**
 * A Scandinavian dining chair: four slender oak legs, an upholstered seat
 * and a bent back rail. `facing` +1 looks toward +x, -1 toward -x.
 */
export function chair(scene, { x, z, facing = 1, angle = null, species = 'oak', seatColor = '#8f877b' }) {
  const wood = woodMaterial(species);
  const seat = feltMaterial(seatColor);
  const g = new THREE.Group();
  const seatH = 0.46;
  const w = 0.46;
  const d = 0.46;
  const leg = 0.028;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const m = texturedMesh(cylinderGeometry(leg * 0.62, leg * 0.42, seatH - 0.03, 24), wood, { grain: 'y', kind: 'cylinder' });
      m.position.set(sx * (d / 2 - 0.04), (seatH - 0.03) / 2, sz * (w / 2 - 0.04));
      g.add(m);
    }
  }
  const frame = slab(wood, -d / 2, d / 2, seatH - 0.05, seatH - 0.02, -w / 2, w / 2, { bevel: { radius: 0.006, segments: 2 } });
  g.add(frame);
  g.add(slab(seat, -d / 2 + 0.01, d / 2 - 0.01, seatH - 0.02, seatH + 0.035, -w / 2 + 0.01, w / 2 - 0.01, { bevel: { radius: 0.02, segments: 4 } }));
  // Back: two rear posts carrying a curved rail.
  for (const sz of [-1, 1]) {
    const post = texturedMesh(cylinderGeometry(0.014, 0.017, 0.36, 20), wood, { grain: 'y', kind: 'cylinder' });
    post.position.set(-d / 2 + 0.03, seatH + 0.16, sz * (w / 2 - 0.04));
    post.rotation.z = -0.08;
    g.add(post);
  }
  const rail = slab(wood, -d / 2 - 0.005, -d / 2 + 0.035, seatH + 0.2, seatH + 0.33, -w / 2 + 0.02, w / 2 - 0.02, { grain: 'z', bevel: { radius: 0.01, segments: 3 } });
  g.add(rail);
  g.position.set(x, 0, z);
  g.rotation.y = angle ?? (facing > 0 ? 0 : Math.PI);
  scene.add(g);
  return g;
}

/** A low oak bench on blackened steel legs. */
export function bench(scene, { x0, x1, z0, z1, height = 0.44, species = 'oak' }) {
  const wood = woodMaterial(species);
  const steel = STEEL();
  scene.add(slab(wood, x0, x1, height - 0.05, height, z0, z1, { bevel: { radius: 0.006, segments: 3 } }));
  for (const x of [x0 + 0.14, x1 - 0.17]) {
    scene.add(slab(steel, x, x + 0.03, 0, height - 0.05, z0 + 0.03, z0 + 0.06));
    scene.add(slab(steel, x, x + 0.03, 0, height - 0.05, z1 - 0.06, z1 - 0.03));
    scene.add(slab(steel, x, x + 0.03, 0.06, 0.09, z0 + 0.03, z1 - 0.03));
  }
}

/** A turned stoneware vessel standing at (x, y, z). */
export function vessel(scene, { x, y, z, h = 0.3, r = 0.11, color = '#cdbfa8', roughness = 0.5 }) {
  const profile = [
    [0, 0],
    [r * 0.55, 0],
    [r * 0.62, 0.01],
    [r * 0.95, h * 0.32],
    [r, h * 0.5],
    [r * 0.82, h * 0.78],
    [r * 0.42, h * 0.94],
    [r * 0.46, h],
    [r * 0.38, h],
    [r * 0.34, h * 0.95],
    [0, h * 0.95],
  ];
  const m = new THREE.Mesh(latheGeometry(profile, 72), ceramicMaterial(color, roughness));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

/** A shallow turned bowl. */
export function bowl(scene, { x, y, z, r = 0.16, h = 0.07, color = '#3e3a36', roughness = 0.4 }) {
  const profile = [
    [0, 0],
    [r * 0.45, 0],
    [r * 0.8, h * 0.35],
    [r, h],
    [r * 0.93, h],
    [r * 0.74, h * 0.42],
    [0, h * 0.22],
  ];
  const m = new THREE.Mesh(latheGeometry(profile, 72), ceramicMaterial(color, roughness));
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}

/** A flat-woven wool rug, 9 mm thick. */
export function rug(scene, { x0, x1, z0, z1, color = '#c9bea9' }) {
  scene.add(slab(feltMaterial(color), x0, x1, 0, 0.009, z0, z1, { bevel: { radius: 0.004, segments: 2 } }));
}

export { floorMaterial, plasterMaterial, limestoneMaterial, woodMaterial };
