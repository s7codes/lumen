import { ACT_SECONDS, eyeHeading, gizmoPose, gizmoTrack, ORBIT_DEG_PER_S, SHELF, STAGE_ROOM, wrap360 } from './showcase-scene.js';

/*
 * The four showcase films: what the 3D Spatial Studio engine was filmed
 * doing in each act, as pure functions of film time. The capture stage
 * (scripts/media/capture) feeds these poses to the planner's own canvas,
 * frame by frame, and the overview's HUD reads the same functions against
 * video.currentTime, so every figure over a film matches the frame under it.
 *
 * Rooms are in cm in the planner frame: x along the north wall, y up, z out
 * toward the south wall. Orbit cameras are the planner's yaw / pitch / zoom
 * around the room's orbit frame.
 */

export const FILM_FPS = 60;

/**
 * Film length per act. The orbit is the calm turntable, one full turn at
 * ORBIT_DEG_PER_S, so its film runs 18 s and loops a held act without a seam;
 * the other films are one act long.
 */
export const FILM_SECONDS = Object.freeze({ orbit: 360 / ORBIT_DEG_PER_S, inside: ACT_SECONDS, gizmo: ACT_SECONDS, isolux: ACT_SECONDS });

/** Media files under /media/showcase/, one per act. */
export const FILM_FILES = Object.freeze({ orbit: '01-envelope', inside: '02-walkthrough', gizmo: '03-raycast-gizmo', isolux: '04-iso-lux' });

/**
 * The envelope film's elevation: one swell per turn, from a low
 * architectural eye (14 deg) up toward plan view (70 deg) and back.
 */
export const FILM_ORBIT_PITCH = Object.freeze({ min: 14, max: 70 });

/** The eye-level lens of the walkthrough film. */
export const FILM_EYE = Object.freeze({ heightCm: 165, fovDeg: 78, xCm: STAGE_ROOM.widthCm / 2, zCm: 392 });

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Film time folded into one loop of the act's film. */
export function filmTime(act, t) {
  const span = FILM_SECONDS[act] ?? ACT_SECONDS;
  const v = Number.isFinite(t) ? t % span : 0;
  return v < 0 ? v + span : v;
}

/**
 * The camera of a film at time t: an orbit pose (yaw, pitch, zoom) or, for
 * the walkthrough, an eye-level stance. Every motion is periodic in its
 * film's length, so a held act loops without a seam.
 */
export function filmCamera(act, t) {
  const time = filmTime(act, t);
  const span = FILM_SECONDS[act] ?? ACT_SECONDS;
  const phase = time / span;
  switch (act) {
    case 'inside':
      return {
        mode: 'inside',
        xCm: FILM_EYE.xCm + 18 * Math.sin(TAU * phase),
        zCm: FILM_EYE.zCm - 26 * Math.sin(Math.PI * phase) ** 2,
        headingDeg: eyeHeading(time),
        pitchDeg: -3 + 2 * Math.sin(TAU * phase),
        fovDeg: FILM_EYE.fovDeg,
      };
    case 'gizmo':
      return { mode: 'orbit', yaw: -24 + 4 * Math.sin(TAU * phase), pitch: 14, zoom: 2.35 };
    case 'isolux':
      return { mode: 'orbit', yaw: 14 * Math.sin(TAU * phase), pitch: 56, zoom: 1.08 };
    case 'orbit':
    default:
      // One full turn per film, rising from FILM_ORBIT_PITCH.min to plan view and back down.
      return {
        mode: 'orbit',
        yaw: wrapSigned(-32 + 360 * phase),
        pitch: (FILM_ORBIT_PITCH.min + FILM_ORBIT_PITCH.max) / 2 - ((FILM_ORBIT_PITCH.max - FILM_ORBIT_PITCH.min) / 2) * Math.cos(TAU * phase),
        zoom: 1.2,
      };
  }
}

function wrapSigned(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** The shelf the gizmo film slides, on 5 cm ticks; at home in every other film. */
export function filmShelf(act, t) {
  if (act !== 'gizmo') return { ...SHELF.home, axis: null, lock: 0 };
  return gizmoPose(filmTime(act, t));
}

/** Where the drag holds the shelf before the snap: the ghost the gizmo film draws. */
export function filmDrag(act, t) {
  if (act !== 'gizmo') return { ...SHELF.home, axis: null, lock: 0 };
  return gizmoTrack(filmTime(act, t));
}

/** DALI-2 level of the pendant channel: the iso-lux film breathes 55 to 100 percent. */
export function filmDimPct(act, t) {
  if (act !== 'isolux') return 100;
  const phase = filmTime(act, t) / FILM_SECONDS.isolux;
  return Math.round(77.5 + 22.5 * Math.cos(TAU * phase));
}

/** Compass bearing (0-359) and pitch the HUD prints for a film frame. */
export function filmBearing(act, t) {
  const cam = filmCamera(act, t);
  if (cam.mode === 'inside') return { az: wrap360(cam.headingDeg) % 360, pitch: Math.abs(cam.pitchDeg) };
  return { az: wrap360(cam.yaw) % 360, pitch: cam.pitch };
}

/*
 * The planner's orbit frame for the stage room (src/lib/room-scene.js,
 * cameraFrame / cameraPosition, as filmed): a 38 deg lens fitted to the
 * room's bounding sphere, aimed a touch toward the north wall.
 */
const ORBIT_FOV_DEG = 38;
const FRAME_FILL_WIDE = 1.26;
const WIDE_ASPECT = 1.6;
const TARGET_LEAN = 0.06;

function orbitFrame(aspect) {
  const { widthCm: W, depthCm: D, heightCm: H } = STAGE_ROOM;
  const half = (ORBIT_FOV_DEG / 2) * DEG;
  const radius = 0.5 * Math.hypot(W, H, D);
  const fill = 1 + (FRAME_FILL_WIDE - 1) * Math.min(1, Math.max(0, (aspect - 1) / (WIDE_ASPECT - 1)));
  return { target: [W / 2, H * 0.42, D / 2 - D * TARGET_LEAN], base: radius / (Math.tan(half) * fill), fov: ORBIT_FOV_DEG };
}

/** Eye, target and vertical lens of a film frame, in room cm. */
export function filmView(act, t, aspect = 1.5) {
  const cam = filmCamera(act, t);
  if (cam.mode === 'inside') {
    const h = cam.headingDeg * DEG;
    const p = cam.pitchDeg * DEG;
    const eye = [cam.xCm, FILM_EYE.heightCm, cam.zCm];
    return { eye, target: [eye[0] + Math.sin(h) * Math.cos(p) * 100, eye[1] + Math.sin(p) * 100, eye[2] - Math.cos(h) * Math.cos(p) * 100], fovDeg: cam.fovDeg };
  }
  const frame = orbitFrame(aspect);
  const distance = frame.base / cam.zoom;
  const yaw = cam.yaw * DEG;
  const pitch = cam.pitch * DEG;
  const [tx, ty, tz] = frame.target;
  return {
    eye: [tx + distance * Math.sin(yaw) * Math.cos(pitch), ty + distance * Math.sin(pitch), tz + distance * Math.cos(yaw) * Math.cos(pitch)],
    target: frame.target,
    fovDeg: frame.fov,
  };
}

/**
 * The floor point (cm) under a stage pixel, or null where the ray misses
 * the floor inside the room. sx, sy are 0..1 across the stage.
 */
export function filmFloorUnder(act, t, sx, sy, aspect = 1.5) {
  const { eye, target, fovDeg } = filmView(act, t, aspect);
  const f = normalize([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = normalize(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const ty = Math.tan((fovDeg / 2) * DEG);
  const tx = ty * aspect;
  const nx = (sx * 2 - 1) * tx;
  const ny = (1 - sy * 2) * ty;
  const dir = [f[0] + r[0] * nx + u[0] * ny, f[1] + r[1] * nx + u[1] * ny, f[2] + r[2] * nx + u[2] * ny];
  if (dir[1] >= -1e-6) return null;
  const k = -eye[1] / dir[1];
  const x = eye[0] + dir[0] * k;
  const z = eye[2] + dir[2] * k;
  if (x < 0 || x > STAGE_ROOM.widthCm || z < 0 || z > STAGE_ROOM.depthCm) return null;
  return [x, 0, z];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
