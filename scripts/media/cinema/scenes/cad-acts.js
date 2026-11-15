import * as THREE from 'three';
import { FILM_EYE, FILM_SECONDS, filmCamera, filmDimPct, filmDrag, filmShelf, filmView } from '../../../../src/lib/showcase-film.js';
import { EYE_FOV_DEG, eyeIlluminance, floorPeak, floorPeakPoint, illuminance, OBJECTS, SHELF, shelfDimensions, STAGE_ROOM, TRACK } from '../../../../src/lib/showcase-scene.js';
import { clamp01, smoothstep } from '../engine/kit.js';
import { cross, direction, endTick, hairline, INK, laser, midpoint, MONO, onScreen, rgba, tag } from '../engine/overlay.js';
import { AMBER, buildChamber, CM, ORANGE, setIsoSources } from './cad-stage.js';

/*
 * The four 3D Spatial Studio acts, filmed in the CAD chamber. Every pose
 * comes from src/lib/showcase-film.js and every figure from
 * src/lib/showcase-scene.js, the same functions the overview HUD reads
 * against the film clock, so a number over a frame is the number the HUD
 * prints under it.
 */

const WIDTH = 1440;
const HEIGHT = 960;
const ASPECT = WIDTH / HEIGHT;
const UP = [0, 1, 0];

function cameraFor(act, camera, t) {
  const v = filmView(act, t, ASPECT);
  camera.fov = v.fovDeg;
  camera.aspect = ASPECT;
  camera.position.set(v.eye[0] * CM, v.eye[1] * CM, v.eye[2] * CM);
  camera.up.set(0, 1, 0);
  camera.lookAt(v.target[0] * CM, v.target[1] * CM, v.target[2] * CM);
  camera.updateProjectionMatrix();
}

/** Screen point of a room point in cm. */
function at(view, p) {
  return view.project([p[0] * CM, p[1] * CM, p[2] * CM]);
}

/**
 * The theatre prints its own HUD over these films: the room and act bar
 * across the top, telemetry and the readout along the foot. Badges keep to
 * the band between them.
 */
const SAFE = Object.freeze({ x: 70, top: 110, bottom: 150 });

/** The part of a screen segment inside the safe band of the frame, or null (Liang-Barsky). */
function clipToFrame(a, b, view, safe = SAFE) {
  let t0 = 0;
  let t1 = 1;
  const d = [b[0] - a[0], b[1] - a[1]];
  const edges = [
    [-d[0], a[0] - safe.x],
    [d[0], view.width - safe.x - a[0]],
    [-d[1], a[1] - safe.top],
    [d[1], view.height - safe.bottom - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [[a[0] + d[0] * t0, a[1] + d[1] * t0], [a[0] + d[0] * t1, a[1] + d[1] * t1]];
}

/**
 * A dimension line between two room points (cm): dashed laser, end ticks and
 * a badge at the middle of the part of the line on screen, so a long laser
 * that runs out of frame keeps its figure in view.
 */
function dimension(ctx, view, a, b, text, { color = rgba(INK.champagne, 0.85), badge = {}, dash = [7, 5] } = {}) {
  const pa = at(view, a);
  const pb = at(view, b);
  if (!pa || !pb) return;
  laser(ctx, pa, pb, color, { dash, width: 1.25 });
  const dir = direction(pa, pb);
  endTick(ctx, pa, dir, color, 5);
  endTick(ctx, pb, dir, color, 5);
  const seen = clipToFrame(pa, pb, view);
  if (text && seen) tag(ctx, midpoint(seen[0], seen[1]), text, { align: 'center', size: 12, ...badge });
}

function film(engine, act, chamber, extra = {}) {
  const camera = new THREE.PerspectiveCamera(38, ASPECT, 0.05, 60);
  return {
    id: `cad-${act}`,
    width: WIDTH,
    height: HEIGHT,
    seconds: FILM_SECONDS[act],
    fps: 60,
    samples: 40,
    shutter: 0.5,
    scene: chamber.scene,
    camera,
    dof: null,
    ...extra,
  };
}

/* ---------- Act 01: the four-wall envelope ---------- */

const NODES = (shelf) => {
  const feedX = shelf.x + SHELF.widthCm / 2;
  return [
    { p: [TRACK[0][0], 298, 14], label: 'N1 DRIVER 24V DC' },
    { p: [feedX, shelf.y + SHELF.thickCm, 3], label: 'N2 SHELF 110' },
    { p: [320, 212, 190], label: 'N3 PENDANT 150' },
    { p: [619, 192, 21], label: 'N4 COLUMN 140' },
    { p: [TRACK[1][0], 298, 14], label: 'N5 RAIL END' },
  ];
};

function nodeMarker(ctx, view, node) {
  const p = at(view, node.p);
  if (!onScreen(p, view, 40)) return;
  ctx.save();
  ctx.strokeStyle = rgba(INK.amber, 0.95);
  ctx.lineWidth = 1.25;
  ctx.strokeRect(Math.round(p[0]) - 3.5, Math.round(p[1]) - 3.5, 7, 7);
  ctx.restore();
  const q = [p[0] + 16, p[1] - 16];
  hairline(ctx, [p[0] + 4, p[1] - 4], q, rgba(INK.amber, 0.7));
  tag(ctx, [q[0] + 2, q[1]], node.label, { size: 11, color: rgba(INK.champagne, 0.95), edge: rgba(INK.amber, 0.45) });
}

export async function envelope(engine) {
  // The pendant is filmed at a quieter level here, so the envelope reads as obsidian round its pool.
  const chamber = buildChamber(engine, { accents: true, compass: true, bus: true, pendantCd: 1100 });
  const f = film(engine, 'orbit', chamber, {
    volume: { lights: [chamber.lights.pendant, chamber.lights.shelf, chamber.lights.column, ...chamber.lights.accents], density: 0.0036, g: 0.42, steps: 10, maxDist: 40, box: [[0, 0, 0], [6.4, 3, 5.2]] },
    grade: { exposure: 0.2, toe: 0.09, glare: 0.04, vignette: 0.24, balance: [1, 0.98, 0.95], saturation: 1.04 },
  });
  f.pose = (t, sub) => {
    cameraFor('orbit', f.camera, t);
    chamber.busUniforms.uTime.value = t;
    chamber.placeLights(sub);
  };
  f.overlay = (ctx, t, view) => {
    // Room dimensions on the floor perimeter, CAD style.
    dimension(ctx, view, [0, 0, -34], [STAGE_ROOM.widthCm, 0, -34], `${STAGE_ROOM.widthCm} CM`);
    dimension(ctx, view, [-34, 0, 0], [-34, 0, STAGE_ROOM.depthCm], `${STAGE_ROOM.depthCm} CM`);
    dimension(ctx, view, [STAGE_ROOM.widthCm + 34, 0, 0], [STAGE_ROOM.widthCm + 34, STAGE_ROOM.heightCm, 0], `${STAGE_ROOM.heightCm} CM`);
    for (const node of NODES(SHELF.home)) nodeMarker(ctx, view, node);
    const railMid = at(view, [(TRACK[0][0] + TRACK[1][0]) / 2, 296, 14]);
    if (onScreen(railMid, view, 60)) tag(ctx, [railMid[0], railMid[1] + 18], '24V DC BUS / 5 NODES', { align: 'center', size: 11, color: rgba(INK.amber, 1), edge: rgba(INK.amber, 0.5) });
  };
  return f;
}

/* ---------- Act 02: the 165 cm eye ---------- */

const TARGETS = [
  { p: [195, 112, 0.5], n: [0, 0, 1], label: 'SHELF WASH' },
  { p: [320, 0, 190], n: [0, 1, 0], label: 'PENDANT POOL' },
  { p: [604, 236, 0.5], n: [0, 0, 1], label: 'COLUMN 140', kelvin: true },
  { p: [0.5, 147, 306], n: [1, 0, 0], label: 'ART FRAME' },
];

function bracket(ctx, p, color, r = 9) {
  const s = 4;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = p[0] + dx * r;
    const cy = p[1] + dy * r;
    ctx.moveTo(cx - dx * s, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - dy * s);
  }
  ctx.stroke();
  ctx.restore();
}

export async function walkthrough(engine) {
  const chamber = buildChamber(engine, { accents: true, compass: true, bus: true, pendantCd: 1100 });
  const f = film(engine, 'inside', chamber, {
    volume: { lights: [chamber.lights.pendant, chamber.lights.shelf, chamber.lights.column, ...chamber.lights.accents], density: 0.003, g: 0.42, steps: 10, maxDist: 20, box: [[0, 0, 0], [6.4, 3, 5.2]] },
    grade: { exposure: 0.2, toe: 0.09, glare: 0.04, vignette: 0.26, balance: [1, 0.98, 0.95], saturation: 1.04 },
  });
  f.pose = (t, sub) => {
    cameraFor('inside', f.camera, t);
    chamber.busUniforms.uTime.value = t;
    chamber.placeLights(sub);
  };
  f.overlay = (ctx, t, view) => {
    const cam = filmCamera('inside', t);
    const eye = [cam.xCm, FILM_EYE.heightCm, cam.zCm];
    const ahead = (deg) => {
      const a = ((cam.headingDeg + deg) * Math.PI) / 180;
      return at(view, [eye[0] + Math.sin(a) * 5000, eye[1], eye[2] - Math.cos(a) * 5000]);
    };
    // The optical horizon at 165 cm: where every eye-height point at infinity lands.
    const horizon = ahead(0);
    if (horizon) {
      const y = Math.round(horizon[1]) + 0.5;
      laser(ctx, [70, y], [view.width - 70, y], rgba(INK.champagne, 0.55), { dash: [10, 6], width: 1 });
      tag(ctx, [76, y - 15], `EYE ${FILM_EYE.heightCm} CM`, { size: 11 });
      tag(ctx, [view.width - 76, y - 15], 'HORIZON 0 DEG', { size: 11, align: 'right' });
    }
    // Heading tape: 5 deg ticks across the lens, bearings every 15 deg.
    const tapeY = 132;
    hairline(ctx, [150, tapeY + 0.5], [view.width - 150, tapeY + 0.5], rgba(INK.champagne, 0.35));
    const half = 50;
    for (let deg = -half - 15; deg <= half + 15; deg += 1) {
      const bearing = Math.round(cam.headingDeg + deg);
      if (((bearing % 5) + 5) % 5 !== 0) continue;
      const p = ahead(bearing - cam.headingDeg);
      if (!p || p[0] < 150 || p[0] > view.width - 150) continue;
      const major = ((bearing % 15) + 15) % 15 === 0;
      const x = Math.round(p[0]) + 0.5;
      hairline(ctx, [x, tapeY - (major ? 10 : 5)], [x, tapeY], rgba(INK.champagne, major ? 0.85 : 0.5));
      if (major) {
        const b = ((bearing % 360) + 360) % 360;
        ctx.save();
        ctx.font = `500 11px ${MONO}`;
        ctx.fillStyle = rgba(INK.champagne, 0.9);
        ctx.textAlign = 'center';
        ctx.fillText(String(b).padStart(3, '0'), x, tapeY - 16);
        ctx.restore();
      }
    }
    // Caret at the heading.
    ctx.save();
    ctx.fillStyle = rgba(INK.amber, 1);
    ctx.beginPath();
    ctx.moveTo(view.width / 2 - 5, tapeY + 4);
    ctx.lineTo(view.width / 2 + 5, tapeY + 4);
    ctx.lineTo(view.width / 2, tapeY + 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    tag(ctx, [150, tapeY + 22], `FOV ${EYE_FOV_DEG} DEG`, { size: 11, plate: null, edge: null, color: rgba(INK.champagne, 0.75) });

    // Lux targets on the fixtures the lens sweeps.
    for (const target of TARGETS) {
      const p = at(view, target.p);
      if (!onScreen(p, view, 90) || p[1] < 170) continue;
      const lux = Math.round(illuminance(target.p, target.n));
      bracket(ctx, p, rgba(INK.amber, 0.95));
      const q = [p[0] + 24, p[1] - 26];
      hairline(ctx, [p[0] + 9, p[1] - 9], q, rgba(INK.amber, 0.7));
      tag(ctx, [q[0] + 2, q[1]], `${target.label} ${lux} LX`, { size: 12, edge: rgba(INK.amber, 0.5) });
      if (target.kelvin) tag(ctx, [q[0] + 2, q[1] + 24], '2700K / CRI 97', { size: 11, color: rgba(INK.amber, 1), edge: rgba(INK.amber, 0.4) });
    }
    // The eye's own reading at the centre of the lens.
    const c = [view.width / 2, view.height / 2];
    cross(ctx, c, rgba(INK.paper, 0.8), 9, 1);
    tag(ctx, [c[0] + 16, c[1] + 18], `EYE ${Math.round(eyeIlluminance(cam.headingDeg))} LX`, { size: 12, color: rgba(INK.paper, 0.95) });
  };
  return f;
}

/* ---------- Act 03: raycast and gizmo ---------- */

function arrow(axis, color) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.46, 24), material);
  shaft.position.y = 0.23;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 48), material);
  tip.position.y = 0.52;
  group.add(shaft, tip);
  if (axis === 'x') group.rotation.z = -Math.PI / 2;
  if (axis === 'z') group.rotation.x = Math.PI / 2;
  group.renderOrder = 20;
  shaft.renderOrder = 20;
  tip.renderOrder = 20;
  return { group, material };
}

/**
 * How hard the drag is pulling each axis at film time t, 0 to 1, from the
 * speed of the unsnapped track. Speed is continuous and zero at rest, so a
 * handle warms up as its axis moves and cools as it stops, and the film's
 * last frame and first frame (the shelf at home, at rest) match exactly.
 */
function axisDrive(t) {
  const h = 1 / 120;
  const a = filmDrag('gizmo', t - h);
  const b = filmDrag('gizmo', t + h);
  const speed = (d) => clamp01(Math.abs(d) / (2 * h) / 38);
  return { x: smoothstep(0, 1, speed(b.x - a.x)), y: smoothstep(0, 1, speed(b.y - a.y)) };
}

function axisLabel(drive) {
  if (drive.x > 0.05 && drive.y > 0.05) return 'FREE XY';
  if (drive.x > 0.05) return 'AXIS LOCK X';
  if (drive.y > 0.05) return 'AXIS LOCK Y';
  return 'SELECTED';
}

export async function gizmo(engine) {
  const chamber = buildChamber(engine, { accents: true, compass: false, bus: true, pendantCd: 1100 });
  const shelfGroup = chamber.groups.shelf;
  const gizmoGroup = new THREE.Group();
  chamber.scene.add(gizmoGroup);
  const axes = { x: arrow('x', ORANGE.clone()), y: arrow('y', ORANGE.clone()), z: arrow('z', AMBER.clone()) };
  for (const a of Object.values(axes)) gizmoGroup.add(a.group);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.03, 32, 16), new THREE.MeshBasicMaterial({ color: AMBER.clone().multiplyScalar(16), depthTest: false, depthWrite: false, transparent: true }));
  hub.renderOrder = 21;
  gizmoGroup.add(hub);
  const shelfLight = chamber.lights.shelf;
  // The shelf is the hero here: its downlight's cone reads in the haze as it slides.
  shelfLight.userData.haze = 0.95;
  const homeLight = { position: [...shelfLight.userData.home.position], target: [...shelfLight.userData.home.target] };

  const f = film(engine, 'gizmo', chamber, {
    volume: { lights: [chamber.lights.pendant, shelfLight, chamber.lights.column, ...chamber.lights.accents.slice(0, 2)], density: 0.0045, g: 0.42, steps: 12, maxDist: 20, box: [[0, 0, 0], [6.4, 3, 5.2]] },
    grade: { exposure: 0.2, toe: 0.09, glare: 0.075, vignette: 0.24, balance: [1, 0.98, 0.95], saturation: 1.04 },
  });
  f.pose = (t, sub) => {
    cameraFor('gizmo', f.camera, t);
    const pose = filmShelf('gizmo', t);
    const dx = (pose.x - SHELF.home.x) * CM;
    const dy = (pose.y - SHELF.home.y) * CM;
    shelfGroup.position.set(dx, dy, 0);
    shelfLight.userData.home = {
      position: [homeLight.position[0] + dx, homeLight.position[1] + dy, homeLight.position[2]],
      target: [homeLight.target[0] + dx, homeLight.target[1], homeLight.target[2]],
    };
    chamber.setBus(pose);
    chamber.busUniforms.uTime.value = t;
    chamber.placeLights(sub);
    // The gizmo rides the shelf's front face in every frame; an axis burns
    // brighter and more orange as the drag pulls it.
    gizmoGroup.position.set((pose.x + SHELF.widthCm / 2) * CM, (pose.y + SHELF.thickCm / 2) * CM, (SHELF.depthCm + 14) * CM);
    const drive = axisDrive(t);
    for (const [id, a] of Object.entries(axes)) {
      const k = id === 'z' ? 0 : drive[id];
      a.material.color.copy(AMBER).lerp(ORANGE, k).multiplyScalar(id === 'z' ? 6 : 9 + 17 * k);
      a.material.opacity = 1;
    }
  };
  f.overlay = (ctx, t, view) => {
    const pose = filmShelf('gizmo', t);
    const drag = filmDrag('gizmo', t);
    const d = shelfDimensions(pose);
    const x0 = pose.x;
    const x1 = pose.x + SHELF.widthCm;
    const y0 = pose.y;
    const y1 = pose.y + SHELF.thickCm;
    const ym = (y0 + y1) / 2;
    const xc = (x0 + x1) / 2;
    const drive = axisDrive(t);

    // The ray: each loop the cursor re-takes the shelf, fading in and out so the loop has no seam.
    const hit = at(view, [xc, ym, SHELF.depthCm]);
    const rayAlpha = smoothstep(0.02, 0.24, t) * (1 - smoothstep(0.62, 1.1, t));
    if (hit && rayAlpha > 0.01) {
      const cursor = [view.width * 0.8, view.height * 0.84];
      laser(ctx, cursor, hit, rgba(INK.paper, 0.85 * rayAlpha), { dash: [3, 4], width: 1.25 });
      cross(ctx, hit, rgba(INK.orange, rayAlpha), 10, 1.5);
      tag(ctx, [hit[0] + 18, hit[1] + 34], `RAY HIT / NORTH WALL / ${Math.round(xc)}, ${Math.round(ym)} CM`, { size: 11, color: rgba(INK.paper, rayAlpha), edge: rgba(INK.orange, 0.6 * rayAlpha), plate: rgba(INK.graphite, 0.72 * rayAlpha) });
      // A plain arrow cursor drawn as a path.
      ctx.save();
      ctx.globalAlpha = rayAlpha;
      ctx.fillStyle = rgba(INK.paper, 0.95);
      ctx.strokeStyle = rgba(INK.graphite, 0.9);
      ctx.beginPath();
      ctx.moveTo(cursor[0], cursor[1]);
      ctx.lineTo(cursor[0], cursor[1] + 17);
      ctx.lineTo(cursor[0] + 4.5, cursor[1] + 13);
      ctx.lineTo(cursor[0] + 8, cursor[1] + 20);
      ctx.lineTo(cursor[0] + 10.5, cursor[1] + 19);
      ctx.lineTo(cursor[0] + 7, cursor[1] + 12);
      ctx.lineTo(cursor[0] + 12.5, cursor[1] + 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();

    // Selection box round the shelf, and the dashed ghost where the drag holds it.
    const boxEdges = (bx0, bx1, by0, by1, bz0, bz1) => {
      const c = [
        [bx0, by0, bz0], [bx1, by0, bz0], [bx1, by1, bz0], [bx0, by1, bz0],
        [bx0, by0, bz1], [bx1, by0, bz1], [bx1, by1, bz1], [bx0, by1, bz1],
      ].map((p) => at(view, p));
      return [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([i, j]) => [c[i], c[j]]);
    };
    for (const [a, b] of boxEdges(x0 - 1, x1 + 1, y0 - 1, y1 + 1, 0, SHELF.depthCm + 1)) hairline(ctx, a, b, rgba(INK.amber, 0.9), 1.25);
    const moving = Math.abs(drag.x - pose.x) > 0.3 || Math.abs(drag.y - pose.y) > 0.3;
    if (moving) for (const [a, b] of boxEdges(drag.x, drag.x + SHELF.widthCm, drag.y, drag.y + SHELF.thickCm, 0, SHELF.depthCm)) laser(ctx, a, b, rgba(INK.champagne, 0.5), { dash: [3, 3], width: 1 });

    // The wall rail at the shelf's mounting height, 5 cm ticks.
    const railY = ym;
    const r0 = Math.max(0, Math.floor((x0 - 70) / 5) * 5);
    const r1 = Math.min(STAGE_ROOM.widthCm, Math.ceil((x1 + 70) / 5) * 5);
    hairline(ctx, at(view, [r0, railY, 0.4]), at(view, [r1, railY, 0.4]), rgba(INK.champagne, 0.45));
    for (let x = r0; x <= r1; x += 5) {
      const major = x % 50 === 0;
      const mid = x % 25 === 0;
      const len = major ? 9 : mid ? 6 : 3.5;
      const edge = x === x0 || x === x1;
      const a = at(view, [x, railY - len, 0.4]);
      const b = at(view, [x, railY + len, 0.4]);
      hairline(ctx, a, b, edge ? rgba(INK.orange, 1) : rgba(INK.champagne, major ? 0.85 : 0.5), edge ? 1.5 : 1);
      if (major && !edge) {
        const p = at(view, [x, railY - 15, 0.4]);
        if (p) {
          ctx.save();
          ctx.font = `500 10px ${MONO}`;
          ctx.fillStyle = rgba(INK.champagne, 0.75);
          ctx.textAlign = 'center';
          ctx.fillText(String(x), p[0], p[1]);
          ctx.restore();
        }
      }
    }

    // Laser dimensions to both walls, the floor and the ceiling, and the depth off the wall.
    const orange = rgba(INK.orange, 0.95);
    const champ = rgba(INK.champagne, 0.85);
    const xActive = drive.x > 0.05;
    const yActive = drive.y > 0.05;
    const badge = (on) => (on ? { color: rgba(INK.paper, 1), edge: rgba(INK.orange, 0.85) } : {});
    dimension(ctx, view, [0, ym, 12], [x0, ym, 12], `X: ${d.x} CM`, { color: xActive ? orange : champ, badge: badge(xActive) });
    dimension(ctx, view, [x1, ym, 12], [STAGE_ROOM.widthCm, ym, 12], `R: ${d.r} CM`, { color: xActive ? orange : champ, badge: badge(xActive) });
    dimension(ctx, view, [xc - 30, 0, 12], [xc - 30, y0, 12], `Y: ${d.y} CM`, { color: yActive ? orange : champ, badge: badge(yActive) });
    dimension(ctx, view, [xc - 30, y1, 12], [xc - 30, STAGE_ROOM.heightCm, 12], `C: ${d.c} CM`, { color: yActive ? orange : champ, badge: badge(yActive) });
    dimension(ctx, view, [x1 + 8, y0 - 8, 0], [x1 + 8, y0 - 8, SHELF.depthCm], `Z: ${SHELF.depthCm} CM`, { badge: { size: 11 } });

    // Axis letters at the gizmo tips, and the snap state.
    const g = [(pose.x + SHELF.widthCm / 2), (pose.y + SHELF.thickCm / 2), SHELF.depthCm + 14];
    const tips = { X: [g[0] + 66, g[1], g[2]], Y: [g[0], g[1] + 66, g[2]], Z: [g[0], g[1], g[2] + 66] };
    for (const [axis, p] of Object.entries(tips)) {
      const on = (axis === 'X' && xActive) || (axis === 'Y' && yActive);
      tag(ctx, at(view, p), axis, { align: 'center', size: 12, weight: 500, color: on ? rgba(INK.paper, 1) : rgba(INK.champagne, 0.9), edge: on ? rgba(INK.orange, 0.9) : rgba(INK.champagne, 0.4) });
    }
    const lockLabel = axisLabel(drive);
    // The name plate rides beside the shelf's right end, clear of the Y and C lasers above and below it.
    const anchor = at(view, [x1 + 22, y1 + 48, 25]);
    if (anchor) {
      tag(ctx, anchor, 'FLOATING SHELF 110 / WALNUT', { size: 12, color: rgba(INK.paper, 0.95), edge: rgba(INK.amber, 0.6) });
      tag(ctx, [anchor[0], anchor[1] + 24], `SNAP 5 CM / ${lockLabel}`, { size: 11, color: rgba(INK.amber, 1), edge: rgba(INK.amber, 0.45) });
    }
    ctx.restore();
  };
  return f;
}

/* ---------- Act 04: the iso-lux field ---------- */

const LABELLED = [500, 250, 100];
const LABEL_BEARING = (118 * Math.PI) / 180;

/** Where a floor ring crosses the label bearing out of the peak, found by bisection. */
function ringAnchor(level, dim) {
  const peak = floorPeakPoint();
  const dir = [Math.cos(LABEL_BEARING), Math.sin(LABEL_BEARING)];
  const e = (r) => illuminance([peak[0] + dir[0] * r, 0, peak[2] + dir[1] * r], UP, SHELF.home, dim);
  let lo = 0;
  let hi = 420;
  if (e(lo) < level || e(hi) > level) return null;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (e(mid) >= level) lo = mid;
    else hi = mid;
  }
  const r = (lo + hi) / 2;
  const p = [peak[0] + dir[0] * r, 0, peak[2] + dir[1] * r];
  return p[0] > 8 && p[0] < STAGE_ROOM.widthCm - 8 && p[2] > 8 && p[2] < STAGE_ROOM.depthCm - 8 ? p : null;
}

const plinthBoxes = OBJECTS.find((o) => o.id === 'plinths').boxes;
function inPlinth(x, z) {
  return plinthBoxes.some((b) => x > b.min[0] - 6 && x < b.max[0] + 6 && z > b.min[2] - 6 && z < b.max[2] + 6);
}

const NODES_X = [70, 170, 270, 370, 470, 570];
const NODES_Z = [60, 160, 260, 360, 460];
const SCAN_PERIOD = 3.5;

function scanX(t) {
  const phase = (((t % SCAN_PERIOD) + SCAN_PERIOD) % SCAN_PERIOD) / SCAN_PERIOD;
  return -40 + phase * (STAGE_ROOM.widthCm + 80);
}

function probeAt(t) {
  const span = FILM_SECONDS.isolux;
  const a = (2 * Math.PI * t) / span;
  return [320 + 188 * Math.sin(a), 0, 268 + 118 * Math.sin(2 * a + 0.7)];
}

export async function isolux(engine) {
  const chamber = buildChamber(engine, { iso: true, accents: false, compass: false, bus: true });
  const f = film(engine, 'isolux', chamber, {
    volume: { lights: [chamber.lights.pendant, chamber.lights.shelf, chamber.lights.column], density: 0.0035, g: 0.42, steps: 12, maxDist: 40, box: [[0, 0, 0], [6.4, 3, 5.2]] },
    grade: { exposure: 0.2, toe: 0.09, glare: 0.035, vignette: 0.22, balance: [1, 0.99, 0.97], saturation: 1.02 },
  });
  const pendantHome = chamber.lights.pendant.intensity;
  f.pose = (t, sub) => {
    cameraFor('isolux', f.camera, t);
    const dim = filmDimPct('isolux', t) / 100;
    chamber.lights.pendant.intensity = pendantHome * dim;
    setIsoSources(chamber.isoMats, SHELF.home, dim);
    for (const m of chamber.isoMats) m.uniforms.uScanX.value = scanX(t);
    chamber.busUniforms.uTime.value = t;
    chamber.placeLights(sub);
  };
  f.overlay = (ctx, t, view) => {
    const dimPct = filmDimPct('isolux', t);
    const dim = dimPct / 100;
    const sx = scanX(t);
    // Measurement nodes on a 100 cm lattice, brightest in the scan's wake.
    for (const x of NODES_X) {
      for (const z of NODES_Z) {
        if (inPlinth(x, z)) continue;
        const p = at(view, [x, 0, z]);
        if (!onScreen(p, view, 30)) continue;
        const since = sx - x;
        const wake = since >= 0 ? Math.exp(-since / 140) : 0;
        const a = 0.5 + 0.5 * wake;
        cross(ctx, p, rgba(INK.paper, 0.55 + 0.45 * wake), 4.5, 1);
        ctx.save();
        ctx.font = `500 11px ${MONO}`;
        ctx.fillStyle = rgba(INK.paper, a);
        ctx.fillText(String(Math.round(illuminance([x, 0, z], UP, SHELF.home, dim))), p[0] + 7, p[1] - 6);
        ctx.restore();
      }
    }
    // Inline ring labels on the floor.
    for (const level of LABELLED) {
      const anchor = ringAnchor(level, dim);
      const p = anchor && at(view, anchor);
      if (!onScreen(p, view, 40)) continue;
      tag(ctx, p, `${level} LX`, { align: 'center', size: 12, color: rgba(INK.graphite, 1), plate: level === 500 ? 'rgba(255, 224, 140, 0.95)' : level === 250 ? 'rgba(255, 154, 74, 0.95)' : 'rgba(179, 116, 62, 0.95)', edge: null, weight: 500 });
    }
    // The peak.
    const peak = at(view, floorPeakPoint());
    if (peak) {
      cross(ctx, peak, rgba(INK.graphite, 0.95), 9, 2);
      cross(ctx, peak, rgba(INK.paper, 1), 8, 1);
      const q = [peak[0] + 30, peak[1] - 34];
      hairline(ctx, [peak[0] + 6, peak[1] - 6], q, rgba(INK.paper, 0.85));
      tag(ctx, [q[0] + 2, q[1]], `PEAK ${Math.round(floorPeak(dimPct))} LX`, { size: 13, color: rgba(INK.paper, 1), edge: rgba(INK.gold, 0.8) });
    }
    // The probe the scan hands its reading to.
    const probe = probeAt(t);
    const pp = at(view, probe);
    if (pp) {
      ctx.save();
      ctx.strokeStyle = rgba(INK.paper, 0.95);
      ctx.lineWidth = 1.25;
      ctx.strokeRect(Math.round(pp[0]) - 7.5, Math.round(pp[1]) - 7.5, 15, 15);
      ctx.restore();
      cross(ctx, pp, rgba(INK.paper, 0.95), 12, 1);
      const lux = Math.round(illuminance(probe, UP, SHELF.home, dim));
      tag(ctx, [pp[0] + 18, pp[1] + 22], `PROBE ${(probe[0] / 100).toFixed(2)} / ${(probe[2] / 100).toFixed(2)} M  ${lux} LX`, { size: 11, color: rgba(INK.paper, 1), edge: rgba(INK.paper, 0.45) });
    }
    // The DALI-2 level the field is breathing at.
    const dali = at(view, [320, 212, 190]);
    if (onScreen(dali, view, 60)) tag(ctx, [dali[0], dali[1] - 26], `PENDANT DALI-2 ${dimPct}%`, { align: 'center', size: 11, color: rgba(INK.amber, 1), edge: rgba(INK.amber, 0.5) });
  };
  return f;
}

export const CAD_FILMS = Object.freeze({ 'cad-orbit': envelope, 'cad-inside': walkthrough, 'cad-gizmo': gizmo, 'cad-isolux': isolux });
