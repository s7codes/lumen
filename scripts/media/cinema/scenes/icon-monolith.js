import * as THREE from 'three';
import { block, clamp01, DEG, easeInOut, lerp, placeLight, smoothstep, spot } from '../engine/kit.js';
import { brass, canvasTexture, emitter, matte, obsidianGloss, plasterMaps, studioEnvironment, travertineMaps, WARM } from '../engine/materials.js';

/*
 * Icon 01, the monolith: a sculptural dome lamp, glossy obsidian outside and
 * brushed brass inside, on a travertine stem and a long travertine slab.
 * The camera glides low along the slab while the 2700K reflector dims up
 * and an inner brass vane sweeps its hot spot across the stone.
 */

export const SECONDS = 4;

const LAMP = { x: 0, z: -0.14, rim: 0.3, radius: 0.19, squash: 0.82 };

export default async function monolith(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  scene.environment = studioEnvironment(engine.renderer, { warm: 1.1, cool: 0.35, floor: 0.012 });
  scene.environmentIntensity = 0.55;

  // Stone: the slab and the lamp's stem and foot share one travertine.
  const trav = travertineMaps(1024, 3);
  const stone = new THREE.MeshPhysicalMaterial({ map: trav.color, roughnessMap: trav.rough, roughness: 1, color: '#f2e6d6', clearcoat: 0.18, clearcoatRoughness: 0.5 });
  const slab = block([-1.3, -0.16, -0.62], [1.3, 0, 0.38], stone, { radius: 0.006, uvScale: 0.9 });
  scene.add(slab);

  const plaster = plasterMaps(1024, 11, [0.07, 0.062, 0.054]);
  const wallMat = new THREE.MeshStandardMaterial({ map: plaster.color, roughnessMap: plaster.rough, roughness: 1 });
  const wall = block([-4, -1.2, -1.75], [4, 2.6, -1.6], wallMat, { radius: 0, uvScale: 2.2 });
  scene.add(wall);
  const floor = block([-4, -1.3, -1.6], [4, -1.2, 3], matte('#0d0c0b', 0.7), { radius: 0 });
  scene.add(floor);

  // The lamp, turned round its axis.
  const lamp = new THREE.Group();
  lamp.position.set(LAMP.x, 0, LAMP.z);
  scene.add(lamp);
  // A honed limestone monolith for a foot, a slim dark bronze stem.
  const lime = new THREE.MeshPhysicalMaterial({ color: '#d6c7b1', roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5 });
  const bronze = new THREE.MeshPhysicalMaterial({ color: '#5a4630', metalness: 1, roughness: 0.32 });
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.108, 0.05, 128), lime);
  foot.position.y = 0.025;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.4, 64), bronze);
  stem.position.y = 0.05 + 0.2;
  for (const m of [foot, stem]) {
    m.castShadow = true;
    m.receiveShadow = true;
    lamp.add(m);
  }
  const shellGeo = new THREE.SphereGeometry(LAMP.radius, 128, 48, 0, Math.PI * 2, 0, Math.PI / 2);
  // The shade reflects its own product studio: one long warm softbox overhead
  // and a narrow strip at the side, which model the dome's curve.
  const shellMat = obsidianGloss({ roughness: 0.12 });
  shellMat.envMap = studioEnvironment(engine.renderer, { warm: 9, cool: 1.4, floor: 0 });
  shellMat.envMapIntensity = 1;
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.scale.set(1, LAMP.squash, 1);
  shell.position.y = LAMP.rim;
  shell.castShadow = true;
  shell.receiveShadow = true;
  lamp.add(shell);

  // The reflector: brushed brass inside the shell, lit from within. Its glow is
  // a smooth radial falloff from the source ring, scaled by the dimmer.
  const glowMap = canvasTexture(
    256,
    (u, v) => {
      const k = 0.18 + 0.82 * (1 - v) ** 1.6;
      return [k, k * 0.93, k * 0.8];
    },
    { blur: 2 },
  );
  const reflectorMat = new THREE.MeshPhysicalMaterial({ color: '#c99a52', metalness: 1, roughness: 0.34, side: THREE.BackSide, emissive: WARM, emissiveMap: glowMap, emissiveIntensity: 0 });
  const reflector = new THREE.Mesh(new THREE.SphereGeometry(LAMP.radius * 0.968, 128, 48, 0, Math.PI * 2, 0, Math.PI / 2), reflectorMat);
  reflector.scale.set(1, LAMP.squash, 1);
  reflector.position.y = LAMP.rim;
  lamp.add(reflector);
  const lip = new THREE.Mesh(new THREE.RingGeometry(LAMP.radius * 0.968, LAMP.radius, 128, 1), brass({ roughness: 0.22 }));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = LAMP.rim - 0.0005;
  lamp.add(lip);
  // Source ring round the stem, just under the apex.
  const ringMat = emitter(0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.006, 24, 96), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = LAMP.rim + 0.1;
  lamp.add(ring);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 96), brass({ roughness: 0.3 }));
  collar.position.y = LAMP.rim + 0.112;
  lamp.add(collar);

  const sourceY = LAMP.rim + 0.094;
  const base = [LAMP.x, sourceY, LAMP.z];
  // Main light: an annulus round the stem, so the stem casts a soft core.
  const main = spot(scene, {
    color: WARM,
    intensity: 0,
    angle: 68 * DEG,
    penumbra: 0.35,
    position: base,
    target: [LAMP.x, 0, LAMP.z],
    near: 0.005,
    far: 4,
    mapSize: 2048,
    bias: -0.0002,
    normalBias: 0.004,
    haze: 1,
    hazeRadius: 0.05,
    jitter: { ring: [0.04, 0.066] },
  });
  // The sweeping vane: a tighter lobe whose aim travels across the slab.
  const vane = spot(scene, {
    color: WARM,
    intensity: 0,
    angle: 17 * DEG,
    penumbra: 0.7,
    position: base,
    target: [LAMP.x, 0, LAMP.z + 0.4],
    near: 0.005,
    far: 4,
    mapSize: 2048,
    bias: -0.0002,
    normalBias: 0.004,
    haze: 0.6,
    hazeRadius: 0.05,
    jitter: { ring: [0.04, 0.066] },
  });
  // A soft wash on the back wall behind the shade, so the glossy dome reads as a silhouette.
  const wash = spot(scene, {
    color: WARM,
    intensity: 900,
    angle: 30 * DEG,
    penumbra: 1,
    position: [0.15, 2.6, -0.6],
    target: [0.12, 0.1, -1.6],
    cast: false,
    haze: 0.15,
  });
  // A kicker from behind and above draws the shade's crown and the stem's edge.
  const kicker = spot(scene, {
    color: WARM,
    intensity: 220,
    angle: 9 * DEG,
    penumbra: 0.9,
    position: [-0.9, 1.25, -1.35],
    target: [LAMP.x, 0.38, LAMP.z],
    cast: false,
    haze: 0,
  });
  void kicker;
  const fill = new THREE.HemisphereLight(new THREE.Color(0.9, 0.85, 0.8), new THREE.Color(0.25, 0.2, 0.15), 0.012);
  scene.add(fill);

  const camera = new THREE.PerspectiveCamera(21, 1920 / 800, 0.05, 30);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();

  function level(t) {
    // The dimmer rises from 42 to 100 percent over the first 1.8 s.
    return lerp(0.42, 1, easeInOut(t / 1.8));
  }

  function rig(t) {
    const e = easeInOut(clamp01(t / SECONDS));
    eye.set(lerp(-0.42, 0.02, e), lerp(0.205, 0.195, e), lerp(1.72, 1.56, e));
    look.set(lerp(-0.36, -0.29, e), lerp(0.215, 0.215, e), LAMP.z);
  }

  const focusPoint = new THREE.Vector3(LAMP.x, 0.22, LAMP.z + 0.15);

  function pose(t, sub) {
    rig(t);
    camera.position.copy(eye);
    camera.lookAt(look);
    const dim = level(t);
    main.intensity = 150 * dim;
    // The vane swings from the left of the slab toward the camera's right.
    const az = lerp(-62, 48, smoothstep(0.1, 3.9, t)) * DEG;
    vane.userData.home.target = [LAMP.x + Math.sin(az) * 0.42, 0, LAMP.z + Math.cos(az) * 0.42];
    vane.intensity = 140 * dim * smoothstep(0, 0.6, t + 0.3);
    placeLight(main, sub);
    placeLight(vane, sub);
    reflectorMat.emissiveIntensity = 2.6 * dim;
    ringMat.color.copy(WARM).multiplyScalar(60 * dim);
  }

  return {
    id: 'icon-monolith',
    width: 1920,
    height: 800,
    seconds: SECONDS,
    fps: 60,
    samples: 112,
    shutter: 0.5,
    scene,
    camera,
    dof: {
      fstop: 5.6,
      focalLength: 0.05,
      focus: (t) => {
        rig(t);
        return eye.distanceTo(focusPoint);
      },
    },
    volume: { lights: [main, vane, wash], density: 0.012, g: 0.62, steps: 20, maxDist: 6 },
    grade: { exposure: 0.06, glare: 0.05, vignette: 0.32, balance: [1.0, 0.98, 0.95], saturation: 1.05 },
    pose,
  };
}
