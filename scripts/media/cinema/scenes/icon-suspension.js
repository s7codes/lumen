import * as THREE from 'three';
import { block, clamp01, DEG, easeInOut, lerp, placeLight, smoothstep, spot } from '../engine/kit.js';
import { concreteMaps, emitter, matte, oakMaps, plasterMaps, studioEnvironment, WARM } from '../engine/materials.js';

/*
 * Icon 02, the suspension: the Linear Pendant 150 hung from the Track Bus
 * 200 spine over a long smoked-oak table in a dark gallery. The pendant is
 * a true line source (its light travels its 140 cm length across the
 * sub-frames), so its pool on the table is long, its edges razor-sharp
 * across the beam and its shadows soft along it.
 */

export const SECONDS = 4;
const PENDANT_Y = 1.47;
const TRACK_Y = 2.86;

/** A turned solid from a few profile points, smoothed through a centripetal spline. */
function lathe(profile, material, segments = 128) {
  const curve = new THREE.CatmullRomCurve3(profile.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  const points = curve.getPoints(96).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  const geometry = new THREE.LatheGeometry(points, segments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export default async function suspension(engine) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0, 0, 0);
  scene.environment = studioEnvironment(engine.renderer, { warm: 1, cool: 0.3, floor: 0.01 });
  scene.environmentIntensity = 0.4;

  const oak = oakMaps(1024, 7, [0.27, 0.2, 0.15]);
  const oakMat = new THREE.MeshPhysicalMaterial({ map: oak.color, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.35 });
  scene.add(block([-1.25, 0.72, -0.48], [1.25, 0.76, 0.48], oakMat, { radius: 0.004, uvScale: 1.4 }));
  scene.add(block([-1.06, 0, -0.4], [-1.0, 0.72, 0.4], oakMat, { radius: 0.003, uvScale: 1.4 }));
  scene.add(block([1.0, 0, -0.4], [1.06, 0.72, 0.4], oakMat, { radius: 0.003, uvScale: 1.4 }));

  // On the table: a bone ceramic vessel, a low basalt bowl and a closed folio.
  const ceramic = new THREE.MeshPhysicalMaterial({ color: '#d9d1c4', roughness: 0.62, clearcoat: 0.2, clearcoatRoughness: 0.4 });
  const vessel = lathe(
    [
      [0, 0],
      [0.055, 0],
      [0.07, 0.04],
      [0.082, 0.12],
      [0.074, 0.2],
      [0.046, 0.25],
      [0.034, 0.275],
      [0.036, 0.29],
      [0.03, 0.29],
      [0.028, 0.27],
      [0, 0.26],
    ],
    ceramic,
  );
  vessel.position.set(-0.46, 0.76, -0.1);
  scene.add(vessel);
  const basalt = new THREE.MeshPhysicalMaterial({ color: '#2b2723', roughness: 0.48, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  const bowl = lathe(
    [
      [0, 0],
      [0.09, 0],
      [0.15, 0.04],
      [0.165, 0.075],
      [0.155, 0.078],
      [0.13, 0.05],
      [0.06, 0.035],
      [0, 0.034],
    ],
    basalt,
  );
  bowl.position.set(0.4, 0.76, 0.05);
  scene.add(bowl);
  scene.add(block([-0.06, 0.76, 0.12], [0.2, 0.785, 0.3], matte('#3b3632', 0.75), { radius: 0.003 }));

  const concrete = concreteMaps(512, 5, [0.19, 0.18, 0.17]);
  scene.add(block([-6, -0.1, -2], [6, 0, 6], new THREE.MeshStandardMaterial({ map: concrete.color, roughness: 0.55 }), { radius: 0, uvScale: 3 }));
  const plaster = plasterMaps(1024, 13, [0.24, 0.225, 0.205]);
  scene.add(block([-6, 0, -2.1], [6, 3, -1.95], new THREE.MeshStandardMaterial({ map: plaster.color, roughnessMap: plaster.rough, roughness: 1 }), { radius: 0, uvScale: 2.4 }));
  scene.add(block([-6, 2.9, -2], [6, 3, 6], matte('#2a2725', 0.9), { radius: 0 }));

  // Track Bus 200 spine and the pendant on two cables.
  const black = new THREE.MeshPhysicalMaterial({ color: '#0f0e0d', roughness: 0.38, metalness: 0.4 });
  scene.add(block([-3.4, TRACK_Y, -0.022], [3.4, 2.9, 0.022], black, { radius: 0.002 }));
  scene.add(block([-3.4, TRACK_Y - 0.002, -0.006], [3.4, TRACK_Y, 0.006], matte('#050505', 0.9), { radius: 0, cast: false }));
  const body = block([-0.75, PENDANT_Y, -0.021], [0.75, PENDANT_Y + 0.04, 0.021], black, { radius: 0.004 });
  scene.add(body);
  const diffuser = emitter(0);
  scene.add(block([-0.735, PENDANT_Y - 0.002, -0.011], [0.735, PENDANT_Y + 0.001, 0.011], diffuser, { radius: 0, cast: false, receive: false }));
  const glow = emitter(0);
  scene.add(block([-0.735, PENDANT_Y + 0.04, -0.006], [0.735, PENDANT_Y + 0.0415, 0.006], glow, { radius: 0, cast: false, receive: false }));
  const cableMat = matte('#1a1918', 0.6);
  for (const x of [-0.62, 0.62]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, TRACK_Y - PENDANT_Y - 0.04, 8), cableMat);
    cable.position.set(x, (TRACK_Y + PENDANT_Y + 0.04) / 2, 0);
    scene.add(cable);
    const adaptor = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 32), black);
    adaptor.position.set(x, TRACK_Y - 0.015, 0);
    scene.add(adaptor);
  }

  const down = spot(scene, {
    color: WARM,
    intensity: 0,
    angle: 36 * DEG,
    penumbra: 0.16,
    position: [0, PENDANT_Y - 0.004, 0],
    target: [0, 0, 0],
    near: 0.01,
    far: 6,
    mapSize: 2048,
    bias: -0.0002,
    normalBias: 0.006,
    haze: 2.4,
    hazeRadius: 0.16,
    jitter: { line: [0.7, 0, 0] },
  });
  const up = spot(scene, {
    color: WARM,
    intensity: 0,
    angle: 72 * DEG,
    penumbra: 0.9,
    position: [0, PENDANT_Y + 0.045, 0],
    target: [0, 3, 0],
    cast: false,
    haze: 0.4,
    hazeRadius: 0.2,
    jitter: { line: [0.7, 0, 0] },
  });
  // An acoustic art frame on the back wall, held in one track spot.
  const frameOak = new THREE.MeshPhysicalMaterial({ map: oak.color, roughness: 0.5 });
  const ART = { x: 1.55, y: 1.62, w: 0.72, h: 0.96 };
  scene.add(block([ART.x - ART.w / 2, ART.y - ART.h / 2, -1.95], [ART.x + ART.w / 2, ART.y + ART.h / 2, -1.9], frameOak, { radius: 0.003, uvScale: 1.2 }));
  scene.add(block([ART.x - ART.w / 2 + 0.035, ART.y - ART.h / 2 + 0.035, -1.9], [ART.x + ART.w / 2 - 0.035, ART.y + ART.h / 2 - 0.035, -1.885], matte('#3a332d', 0.95), { radius: 0.002 }));
  const accents = [
    spot(scene, {
      color: WARM,
      intensity: 700,
      angle: 13 * DEG,
      penumbra: 0.55,
      position: [1.2, TRACK_Y - 0.09, 0],
      target: [ART.x, ART.y, -1.9],
      cast: true,
      near: 0.05,
      far: 6,
      haze: 1.2,
      hazeRadius: 0.1,
      jitter: { radius: 0.01 },
    }),
  ];
  for (const light of accents) {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.11, 32), black);
    can.position.copy(light.position);
    can.lookAt(light.target.position);
    can.rotateX(Math.PI / 2);
    scene.add(can);
  }
  scene.add(new THREE.HemisphereLight(new THREE.Color(0.9, 0.85, 0.8), new THREE.Color(0.2, 0.17, 0.14), 0.01));

  const camera = new THREE.PerspectiveCamera(38, 1920 / 800, 0.05, 40);
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const focusPoint = new THREE.Vector3(0, 0.85, 0);

  function rig(t) {
    const e = easeInOut(clamp01(t / SECONDS));
    eye.set(lerp(-2.0, -1.12, e), lerp(1.06, 1.1, e), lerp(3.18, 3.0, e));
    // Aimed left of the pendant: on a wide banner it rides the right half, clear of the centred title and key.
    look.set(lerp(-0.95, -0.92, e), lerp(1.78, 1.78, e), lerp(-1.0, -0.98, e));
  }

  function pose(t, sub) {
    rig(t);
    camera.position.copy(eye);
    camera.lookAt(look);
    // The pendant comes up from 70 percent as the film opens.
    const level = lerp(0.7, 1, smoothstep(0, 1.2, t));
    down.intensity = 520 * level;
    up.intensity = 120 * level;
    diffuser.color.copy(WARM).multiplyScalar(140 * level);
    glow.color.copy(WARM).multiplyScalar(10 * level);
    placeLight(down, sub);
    placeLight(up, sub);
  }

  return {
    id: 'icon-suspension',
    width: 1920,
    height: 800,
    seconds: SECONDS,
    fps: 60,
    samples: 112,
    shutter: 0.5,
    scene,
    camera,
    dof: {
      fstop: 8,
      focalLength: 0.035,
      focus: (t) => {
        rig(t);
        return eye.distanceTo(focusPoint);
      },
    },
    volume: { lights: [down, up, ...accents], density: 0.014, g: 0.55, steps: 40, maxDist: 12 },
    grade: { exposure: 0.07, glare: 0.05, vignette: 0.3, balance: [1, 0.98, 0.95], saturation: 1.04 },
    pose,
  };
}
