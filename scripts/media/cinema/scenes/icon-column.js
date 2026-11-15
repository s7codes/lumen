import * as THREE from 'three';
import { block, clamp01, DEG, easeInOut, lerp, placeLight, smoothstep, spot } from '../engine/kit.js';
import { brass, emitter, matte, oakMaps, plasterMaps, studioEnvironment, travertineMaps, WARM } from '../engine/materials.js';

/*
 * Icon 03, the column: a dark corner in Venetian plaster. Recessed ceiling
 * grazers paint overlapping conic scallops down both walls, one after the
 * other, while the Corner Floor Column 140 washes the corner from its
 * vertical emitter (a line source 120 cm tall). The camera arcs slowly
 * round the corner.
 */

export const SECONDS = 4;
const H = 2.8;
const GRAZE = [0.8, 1.7, 2.6, 3.5];

export default async function column(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  scene.environment = studioEnvironment(engine.renderer, { warm: 1, cool: 0.3, floor: 0.01 });
  scene.environmentIntensity = 0.35;

  const plaster = plasterMaps(1024, 17, [0.3, 0.255, 0.21]);
  const plasterMat = new THREE.MeshPhysicalMaterial({ map: plaster.color, roughnessMap: plaster.rough, roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.32 });
  scene.add(block([0, 0, -0.1], [6, H, 0], plasterMat, { radius: 0, uvScale: 2.2 }));
  scene.add(block([-0.1, 0, 0], [0, H, 6], plasterMat, { radius: 0, uvScale: 2.2 }));
  const oak = oakMaps(1024, 9, [0.22, 0.16, 0.12]);
  scene.add(block([-0.1, -0.05, -0.1], [7, 0, 7], new THREE.MeshPhysicalMaterial({ map: oak.color, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.4 }), { radius: 0, uvScale: 1.6 }));
  scene.add(block([-0.1, H, -0.1], [7, H + 0.05, 7], matte('#2b2826', 0.92), { radius: 0 }));

  // A low travertine bench along the back wall catches the scallops' feet.
  const trav = travertineMaps(1024, 4);
  scene.add(block([1.15, 0, 0.02], [3.35, 0.42, 0.44], new THREE.MeshPhysicalMaterial({ map: trav.color, roughnessMap: trav.rough, roughness: 1, color: '#e9dccb' }), { radius: 0.006, uvScale: 0.9 }));

  // The grazers: brass trims, black baffles and a lens, 22 cm off each wall.
  const trimMat = brass({ roughness: 0.3 });
  const baffleMat = matte('#070707', 0.95);
  const lenses = [];
  const grazers = [];
  const add = (x, z, target) => {
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.004, 12, 64), trimMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.set(x, H - 0.002, z);
    scene.add(trim);
    const baffle = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.004, 48), baffleMat);
    baffle.position.set(x, H - 0.001, z);
    scene.add(baffle);
    const lensMat = emitter(0);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 48), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, H - 0.003, z);
    scene.add(lens);
    lenses.push(lensMat);
    grazers.push(
      spot(scene, {
        color: WARM,
        intensity: 0,
        angle: 30 * DEG,
        penumbra: 0.3,
        position: [x, H - 0.012, z],
        target,
        cast: true,
        near: 0.02,
        far: 6,
        mapSize: 1024,
        haze: 0.35,
        hazeRadius: 0.08,
        jitter: { radius: 0.012 },
      }),
    );
  };
  for (const x of GRAZE) add(x, 0.17, [x, 0, -0.06]);
  for (const z of GRAZE) add(0.17, z, [-0.06, 0, z]);

  // The Corner Floor Column 140: walnut, a brushed aluminium emitter channel
  // facing the corner and a brass foot.
  const col = new THREE.Group();
  col.position.set(0.3, 0, 0.3);
  col.rotation.y = Math.PI / 4;
  scene.add(col);
  const walnut = new THREE.MeshPhysicalMaterial({ color: '#4a3020', roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.35 });
  const shaft = block([-0.045, 0.025, -0.035], [0.045, 1.4, 0.035], walnut, { radius: 0.006 });
  col.add(shaft);
  col.add(block([-0.075, 0, -0.075], [0.075, 0.025, 0.075], brass({ roughness: 0.32 }), { radius: 0.004 }));
  col.add(block([-0.047, 1.4, -0.037], [0.047, 1.412, 0.037], brass({ roughness: 0.3 }), { radius: 0.003 }));
  const strip = emitter(0);
  col.add(block([-0.014, 0.14, -0.0365], [0.014, 1.36, -0.034], strip, { radius: 0, cast: false, receive: false }));
  // The room side carries a hairline slit of the same light.
  const slit = emitter(0);
  col.add(block([-0.003, 0.18, 0.034], [0.003, 1.32, 0.0365], slit, { radius: 0, cast: false, receive: false }));
  const columnLight = spot(scene, {
    color: WARM,
    intensity: 0,
    angle: 88 * DEG,
    penumbra: 1,
    position: [0.262, 0.74, 0.262],
    target: [0, 0.74, 0],
    cast: false,
    haze: 0.5,
    jitter: { line: [0, 0.6, 0] },
  });
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.9, 0.85, 0.8), new THREE.Color(0.2, 0.17, 0.14), 0.012));

  const camera = new THREE.PerspectiveCamera(36, 1920 / 800, 0.05, 40);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const focusPoint = new THREE.Vector3(0.35, 1.1, 0.35);

  function rig(t) {
    const e = easeInOut(clamp01(t / SECONDS));
    const yaw = lerp(52, 38, e) * DEG;
    const r = lerp(6.1, 5.65, e);
    eye.set(Math.cos(yaw) * r, lerp(1.42, 1.48, e), Math.sin(yaw) * r);
    look.set(lerp(-0.42, -0.6, e), lerp(1.42, 1.42, e), lerp(0.62, 0.72, e));
  }

  // The grazers come up in a cascade, outward from the corner on both walls.
  function cascade(i, t) {
    const order = i % GRAZE.length;
    return lerp(0.18, 1, smoothstep(0.15 + order * 0.38, 0.95 + order * 0.38, t));
  }

  function pose(t, sub) {
    rig(t);
    camera.position.copy(eye);
    camera.lookAt(look);
    grazers.forEach((light, i) => {
      const level = cascade(i, t);
      light.intensity = 430 * level;
      lenses[i].color.copy(WARM).multiplyScalar(420 * level);
      placeLight(light, sub);
    });
    const colLevel = lerp(0.6, 1, smoothstep(0, 1.6, t));
    columnLight.intensity = 46 * colLevel;
    strip.color.copy(WARM).multiplyScalar(70 * colLevel);
    slit.color.copy(WARM).multiplyScalar(26 * colLevel);
    placeLight(columnLight, sub);
  }

  return {
    id: 'icon-column',
    width: 1920,
    height: 800,
    seconds: SECONDS,
    fps: 60,
    samples: 112,
    shutter: 0.5,
    scene,
    camera,
    dof: {
      fstop: 6.3,
      focalLength: 0.032,
      focus: (t) => {
        rig(t);
        return eye.distanceTo(focusPoint);
      },
    },
    volume: { lights: [...grazers, columnLight], density: 0.01, g: 0.5, steps: 32, maxDist: 10 },
    grade: { exposure: 0.07, glare: 0.045, vignette: 0.3, balance: [1, 0.98, 0.95], saturation: 1.04 },
    pose,
  };
}
