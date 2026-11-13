import { Edges, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  EquirectangularReflectionMapping,
  Euler,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  NoColorSpace,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { formatInt } from '../../lib/format.js';
import { fieldImage, isoLuxContours } from '../../lib/illuminance-field.js';
import {
  contactShadowMap,
  cornerShadeMap,
  faceUvTransform,
  iblTier,
  PBR_MATERIALS,
  studioEnvironmentMap,
  synthesizeMaterial,
} from '../../lib/pbr-materials.js';
import { CAMERA_PITCH, CAMERA_YAW, ROOM_WALLS, sameCamera, sanitizeCamera, WALL_HEADING, wrapYaw } from '../../lib/room-3d.js';
import { intersectRayWithWall } from '../../lib/room-raycast.js';
import {
  cameraFrame,
  cameraFromPosition,
  cameraPosition,
  headingDelta,
  orbitLimits,
  subpartLookKey,
  sunDirection,
  wallCull,
} from '../../lib/room-scene.js';
import { wallDirToRoom, wallToRoom } from '../../lib/room-walls.js';
import {
  coastWalk,
  compassReadout,
  elevationCamera,
  EYE_HEIGHT_CM,
  facingWall,
  furnitureZone,
  headingTurn,
  LOOK_PITCH,
  lookDirection,
  normalizeHeading,
  placeWalk,
  rampWalkVelocity,
  sanitizeInsideFov,
  stepContinuousWalk,
  WALK_HOLD_S,
  walkIntent,
  walkTargetVelocity,
} from '../../lib/room-walkthrough.js';
import { MAX_FRAME_DT, stepSpring } from '../../lib/spring.js';
import { setAttr, setData, setText } from '../../lib/dom-writes.js';

const DRAG_THRESHOLD_PX = 4;
const WHEEL_COMMIT_MS = 180;
const POLAR_LIMITS = orbitLimits(CAMERA_YAW, CAMERA_PITCH);

// Critically damped (c = 2 sqrt(k)): presets glide in without overshoot and
// settle in about 0.4 s at any refresh rate.
const CAMERA_SPRING = { stiffness: 140, damping: 2 * Math.sqrt(140) };

const INK = {
  night: { edge: '#f2eee7', hidden: '#f2eee7', wire: '#aeb2b5' },
  daylight: { edge: '#0b0b0a', hidden: '#0b0b0a', wire: '#44484b' },
};
const AXIS_COLORS = { x: '#e8923a', y: '#f2eee7', z: '#aeb2b5' };
const SELECT_COLOR = '#e8923a';
const FAULT_COLOR = '#c8553d';
const CALLOUT_COLORS = { ok: '#f0b273', tight: '#e08a74' };
const ISO_COLORS = { 100: '#d6a06e', 250: '#f0b273', 500: '#f6efe4' };
// The lux grid floats just above a 0.6 cm area rug and the sun patches on it.
const FLOOR_LUX_LIFT = 0.0095;
const DEG = Math.PI / 180;
const noRaycast = () => null;

// Lens changes (orbit to eye level, wall to wall in elevation) glide a little
// slower than presets so the move reads as one continuous camera move.
const LENS_SPRING = { stiffness: 120, damping: 2 * Math.sqrt(120) };
const LOOK_DEG_PER_PX = 0.22;
const LOOK_THRESHOLD_PX = 4;
// One wheel notch (100 px of deltaY) swings the inside lens 4 deg.
const FOV_DEG_PER_WHEEL_PX = 0.04;
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 400;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * Camera rig: OrbitControls drives the lens; committed yaw / pitch / zoom
 * drive OrbitControls. Yaw is relative to the heading of the wall in view,
 * so switching walls glides the heading and the orbit centre while the
 * relative view stays put. The azimuth is never limited: a drag keeps
 * turning round all four walls, and yaw wraps through +-180.
 */

const GLIDE_KEYS = ['yaw', 'pitch', 'zoom', 'heading', 'tx', 'ty', 'tz'];
const GLIDE_EPSILON = { yaw: 0.05, pitch: 0.05, zoom: 0.002, heading: 0.05, tx: 0.0005, ty: 0.0005, tz: 0.0005 };

function CameraRig({ room, wall, camera, api }) {
  const controlsRef = useRef(null);
  const lens = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = size.width / Math.max(1, size.height);
  const { widthCm, depthCm, heightCm } = room;
  const frame = useMemo(
    () => cameraFrame({ widthCm, depthCm, heightCm }, aspect, wall),
    [widthCm, depthCm, heightCm, aspect, wall],
  );
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const glide = useRef(null);
  const placed = useRef({ heading: frame.heading, target: frame.target });
  const session = useRef({ active: false, moved: false, timer: 0 });

  // `at` is the heading and orbit centre the lens is placed against.
  const place = useCallback(
    (view, at = frameRef.current) => {
      const f = { ...frameRef.current, heading: at.heading, target: at.target };
      lens.position.set(...cameraPosition(f, view));
      lens.lookAt(...f.target);
      const controls = controlsRef.current;
      if (controls) {
        controls.target.set(...f.target);
        controls.update();
      }
      placed.current = { heading: f.heading, target: f.target };
      invalidate();
    },
    [lens, invalidate],
  );

  const readView = useCallback(
    () => cameraFromPosition({ ...frameRef.current, ...placed.current }, lens.position.toArray()),
    [lens],
  );

  useLayoutEffect(() => {
    lens.fov = frame.fov;
    lens.near = 0.05;
    lens.far = 60;
    lens.updateProjectionMatrix();
    const controls = controlsRef.current;
    if (controls) {
      controls.minDistance = frame.minDistance;
      controls.maxDistance = frame.maxDistance;
    }
    // A wall switch is handed to the glide below; size and envelope changes snap.
    if (glide.current || placed.current.heading !== frame.heading) return;
    place(api.viewRef.current, frame);
  }, [frame, lens, place, api]);

  // A committed camera or wall that differs from the view (preset, keys,
  // reload, wall tab) glides in on a spring; the echo of our own orbit commit
  // only snaps the lens onto the rounded values.
  useEffect(() => {
    const f = frameRef.current;
    const from = api.viewRef.current;
    const at = placed.current;
    const sameWall = at.heading === f.heading;
    if (sameCamera(camera, from) && sameWall) {
      if (!glide.current) place(camera, f);
      return;
    }
    // A preset or key commit supersedes a wheel commit still waiting out its pause.
    clearTimeout(session.current.timer);
    if (prefersReducedMotion()) {
      glide.current = null;
      api.gliding.current = false;
      api.showView(camera);
      place(camera, f);
      return;
    }
    // Unwrap the start heading and the goal yaw so both swings take the short
    // way round: 175 to -175 turns 10 deg, not 350.
    const heading = f.heading - headingDelta(at.heading, f.heading);
    const [tx, ty, tz] = at.target;
    glide.current = {
      value: { yaw: from.yaw, pitch: from.pitch, zoom: from.zoom, heading, tx, ty, tz },
      velocity: Object.fromEntries(GLIDE_KEYS.map((key) => [key, 0])),
      view: camera,
      yaw: from.yaw + headingDelta(from.yaw, camera.yaw),
    };
    api.gliding.current = true;
    invalidate();
  }, [camera, frame.heading, api, place, invalidate]);

  useEffect(() => () => clearTimeout(session.current.timer), []);

  useFrame((_, delta) => {
    const g = glide.current;
    if (!g) return;
    const f = frameRef.current;
    const dt = Math.min(Math.max(delta, 0), MAX_FRAME_DT);
    const { stiffness, damping } = CAMERA_SPRING;
    const goal = {
      ...g.view,
      yaw: g.yaw,
      heading: f.heading,
      tx: f.target[0],
      ty: f.target[1],
      tz: f.target[2],
    };
    let settled = true;
    for (const key of GLIDE_KEYS) {
      [g.value[key], g.velocity[key]] = stepSpring(g.value[key], g.velocity[key], goal[key], dt, stiffness, damping);
      if (Math.abs(g.value[key] - goal[key]) >= GLIDE_EPSILON[key]) settled = false;
    }
    if (settled) {
      glide.current = null;
      api.gliding.current = false;
      api.showView(g.view);
      place(g.view, f);
      return;
    }
    const view = { yaw: wrapYaw(g.value.yaw), pitch: g.value.pitch, zoom: g.value.zoom };
    api.showView(view);
    place(view, { heading: g.value.heading, target: [g.value.tx, g.value.ty, g.value.tz] });
  });

  const onStart = useCallback(() => {
    clearTimeout(session.current.timer);
    glide.current = null;
    api.gliding.current = false;
    session.current.active = true;
    session.current.moved = false;
  }, [api]);

  const onChange = useCallback(() => {
    const s = session.current;
    if (!s.active) return;
    if (api.pointerDown.current && !s.moved) {
      s.moved = true;
      api.setOrbiting(true);
    }
    api.showView(readView());
  }, [api, readView]);

  // Wheel ticks arrive as separate start / end pairs, so the commit waits for
  // a short pause; a drag commits as soon as the pointer lifts.
  const onEnd = useCallback(() => {
    const s = session.current;
    s.active = false;
    api.setOrbiting(false);
    const commit = () => api.commit(sanitizeCamera(readView()));
    clearTimeout(s.timer);
    if (s.moved) commit();
    else s.timer = setTimeout(commit, WHEEL_COMMIT_MS);
  }, [api, readView]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={false}
      enablePan={false}
      rotateSpeed={0.5}
      zoomSpeed={1}
      minAzimuthAngle={-Infinity}
      maxAzimuthAngle={Infinity}
      minPolarAngle={POLAR_LIMITS.minPolarAngle}
      maxPolarAngle={POLAR_LIMITS.maxPolarAngle}
      onStart={onStart}
      onChange={onChange}
      onEnd={onEnd}
    />
  );
}

/** Vertical field of view that keeps `deg` across the narrower side of the viewport. */
function fitFov(deg, aspect) {
  if (!(aspect > 0) || aspect >= 1) return deg;
  return Math.min(100, (2 * Math.atan(Math.tan((deg / 2) * DEG) / aspect)) / DEG);
}

function settleSpring(pose, velocity, goal, keys, epsilon, dt, skip = null) {
  const { stiffness, damping } = LENS_SPRING;
  let done = true;
  for (const key of keys) {
    if (skip?.has(key)) continue;
    [pose[key], velocity[key]] = stepSpring(pose[key], velocity[key], goal[key], dt, stiffness, damping);
    if (Math.abs(pose[key] - goal[key]) >= epsilon) done = false;
  }
  if (done) {
    for (const key of keys) {
      if (skip?.has(key)) continue;
      pose[key] = goal[key];
      velocity[key] = 0;
    }
  }
  return done;
}

function lensDirection(lens) {
  return lens.getWorldDirection(new Vector3());
}

const POSE_KEYS = ['x', 'y', 'z', 'heading', 'pitch', 'fov'];
const LOOK_KEYS = new Set(['heading', 'pitch']);
const GAIT_KEYS = new Set(['x', 'z', 'heading']);
const GAIT_LOOK_KEYS = new Set(['x', 'z', 'heading', 'pitch']);
const RESIDUAL_AXES = ['x', 'z', 'heading'];

/**
 * Inside-room lens: the observer stands at the walk stance with the eye at
 * 165 cm. Every wall plane faces the eye, so no section cut hides anything.
 * A pointer drag turns the head (the world follows the pointer) and writes
 * straight to the camera; the turn is committed once, on release. The wheel
 * swings the field of view the same way, committed after a short pause. A
 * stance change from a tapped key, step buttons or wall tabs glides in on a
 * spring.
 *
 * Held walk keys run a gait: once a key has been down WALK_HOLD_S, the stance
 * advances every frame at a ramped walking speed (stepContinuousWalk), the
 * camera and the scene-graph mirror are written straight from the frame
 * loop, and the stance commits once, where the walk comes to rest, when the
 * last key lifts. The gait starts from the stance the tap stride already
 * committed, so a hold never loses that first step; the camera, still
 * gliding toward it, eases onto the gait through a decaying residual.
 */
function WalkRig({ room, walk, insideFov, api }) {
  const lens = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const events = useThree((state) => state.events);
  const gl = useThree((state) => state.gl);
  const goal = useRef(walk);
  goal.current = walk;
  // A stance this rig has committed that React has not rendered yet: the
  // spring aims here meanwhile, never back at the stale stance.
  const pending = useRef(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const zone = useMemo(() => furnitureZone(room), [room]);
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const aspect = size.width / Math.max(1, size.height);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  // The live lens: the wheel writes here between commits. `committed` is the
  // last value this rig handed up, so the echo of its own commit is told apart
  // from a new value set elsewhere (keys, reset), which replaces the live one.
  const fovLens = useRef({ fov: insideFov, committed: insideFov, timer: 0 });
  const pose = useRef(null);
  const velocity = useRef(Object.fromEntries(POSE_KEYS.map((key) => [key, 0])));
  const look = useRef(null);
  const gait = useRef(null);

  const target = useCallback((p) => {
    const g = pending.current ?? goal.current;
    return {
      x: g.xCm,
      y: EYE_HEIGHT_CM,
      z: g.zCm,
      heading: p.heading + headingTurn(p.heading, g.headingDeg),
      pitch: g.pitchDeg,
      fov: fitFov(fovLens.current.fov, aspectRef.current),
    };
  }, []);

  const apply = useCallback(
    (p) => {
      lens.position.set(p.x * 0.01, p.y * 0.01, p.z * 0.01);
      const [dx, dy, dz] = lookDirection(p.heading, p.pitch);
      lens.lookAt(lens.position.x + dx, lens.position.y + dy, lens.position.z + dz);
      if (Math.abs(lens.fov - p.fov) > 1e-3) {
        lens.fov = p.fov;
        lens.updateProjectionMatrix();
      }
    },
    [lens],
  );

  useLayoutEffect(() => {
    const dir = lensDirection(lens);
    const p = {
      x: lens.position.x * 100,
      y: lens.position.y * 100,
      z: lens.position.z * 100,
      heading: Math.atan2(dir.x, -dir.z) / DEG,
      pitch: Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG,
      fov: lens.fov,
    };
    lens.near = 0.05;
    lens.far = 60;
    lens.updateProjectionMatrix();
    pose.current = prefersReducedMotion() ? target(p) : p;
    apply(pose.current);
    invalidate();
  }, [lens, target, apply, invalidate]);

  // A wheel tick that lands between a commit and its re-render must not be
  // pulled back to the older committed value.
  useLayoutEffect(() => {
    const state = fovLens.current;
    if (insideFov === state.committed) return;
    state.fov = insideFov;
    state.committed = insideFov;
  }, [insideFov]);

  useEffect(() => {
    if (prefersReducedMotion() && pose.current) {
      pose.current = target(pose.current);
      apply(pose.current);
    }
    invalidate();
  }, [walk, insideFov, aspect, target, apply, invalidate]);

  useEffect(() => {
    const el = events.connected ?? gl.domElement;
    const state = fovLens.current;
    const commit = () => {
      state.timer = 0;
      state.committed = state.fov;
      api.commitFov(state.fov);
    };
    const onWheel = (event) => {
      if (api.drag.isActive()) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
      const next = sanitizeInsideFov(state.fov + event.deltaY * scale * FOV_DEG_PER_WHEEL_PX);
      if (next === state.fov) return;
      state.fov = next;
      setData(api.walkMirror.current, 'fovDeg', next);
      invalidate();
      clearTimeout(state.timer);
      state.timer = setTimeout(commit, WHEEL_COMMIT_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // The mirror says when the inside lens actually takes input: the rig mounts
    // in the WebGL tree a beat after the lens switch commits.
    const mirror = api.walkMirror.current;
    setData(mirror, 'lensLive', 'inside');
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (mirror) delete mirror.dataset.lensLive;
      if (state.timer) {
        clearTimeout(state.timer);
        commit();
      }
    };
  }, [events.connected, gl, api, invalidate]);

  // React rendered a stance: whatever this rig committed has landed.
  useLayoutEffect(() => {
    pending.current = null;
  }, [walk]);

  // One commit per gesture; the spring aims at it from this frame on.
  const commitStance = useCallback(
    (patch) => {
      pending.current = placeWalk(pending.current ?? goal.current, roomRef.current, patch);
      api.commitWalk(patch);
      return pending.current;
    },
    [api],
  );

  // Live stance into the scene-graph mirror; React renders the committed one.
  const mirrorStance = useCallback(
    (stance) => {
      const mirror = api.walkMirror.current;
      if (!mirror) return;
      const headingDeg = normalizeHeading(stance.headingDeg);
      setData(mirror, 'xCm', Math.round(stance.xCm));
      setData(mirror, 'zCm', Math.round(stance.zCm));
      setData(mirror, 'headingDeg', headingDeg);
      setData(mirror, 'facingWall', facingWall({ xCm: stance.xCm, zCm: stance.zCm, headingDeg }, roomRef.current));
    },
    [api],
  );

  // A hold has outlasted the tap. The gait starts at rest from the stance the
  // tap stride committed; the camera's offset from that stance, and the glide
  // velocity it still carries, become a residual that decays on the lens
  // spring. Camera speed stays continuous and rises without a surge.
  const engageGait = useCallback(
    (g, p) => {
      const base = pending.current ?? goal.current;
      const v = velocity.current;
      const heading = p.heading + headingTurn(p.heading, base.headingDeg);
      g.engaged = true;
      g.stance = { xCm: base.xCm, zCm: base.zCm, headingDeg: heading };
      g.velocity = { forward: 0, strafe: 0, turn: 0 };
      g.residual = g.reduced
        ? { x: 0, z: 0, heading: 0 }
        : { x: p.x - base.xCm, z: p.z - base.zCm, heading: p.heading - heading };
      g.residualVelocity = g.reduced ? { x: 0, z: 0, heading: 0 } : { x: v.x, z: v.z, heading: v.heading };
      for (const key of RESIDUAL_AXES) v[key] = 0;
      api.locomotion.engaged = true;
      setData(api.walkMirror.current, 'locomotion', 'continuous');
    },
    [api],
  );

  // The last key lifted: the stance commits where the walk comes to rest and
  // the camera goes back to the spring at the gait's own velocity, which
  // traces the same exponential coast.
  const releaseGait = useCallback(
    (g, coast = true) => {
      const world = coast && !g.reduced ? g.world : { vx: 0, vz: 0, vh: 0 };
      const rest = coastWalk(g.stance, roomRef.current, world, zoneRef.current);
      const v = velocity.current;
      v.x = world.vx + g.residualVelocity.x;
      v.z = world.vz + g.residualVelocity.z;
      v.heading = world.vh + g.residualVelocity.heading;
      api.locomotion.engaged = false;
      const mirror = api.walkMirror.current;
      if (mirror) {
        delete mirror.dataset.locomotion;
        delete mirror.dataset.speedCms;
      }
      mirrorStance(commitStance({ xCm: rest.xCm, zCm: rest.zCm, headingDeg: rest.headingDeg }));
    },
    [api, commitStance, mirrorStance],
  );

  // One frame of the held-key gait; true while it needs the next frame.
  const stepGait = (p, dt) => {
    const keys = api.heldKeys;
    let g = gait.current;
    if (keys.size === 0) {
      gait.current = null;
      if (g?.engaged) releaseGait(g);
      return false;
    }
    if (!g) {
      g = { held: 0, engaged: false, reduced: prefersReducedMotion(), world: { vx: 0, vz: 0, vh: 0 } };
      gait.current = g;
    }
    g.held += dt;
    if (!g.engaged) {
      if (g.held < WALK_HOLD_S) return true;
      engageGait(g, p);
    }
    const wanted = walkTargetVelocity(walkIntent(keys), api.locomotion.run);
    g.velocity = g.reduced ? wanted : rampWalkVelocity(g.velocity, wanted, dt);
    const looking = Boolean(look.current?.moved);
    if (looking) {
      // The pointer owns the gaze; the walk follows it.
      g.stance = { ...g.stance, headingDeg: p.heading };
      g.velocity.turn = 0;
      g.residual.heading = 0;
      g.residualVelocity.heading = 0;
    }
    const from = g.stance;
    const next = stepContinuousWalk(from, roomRef.current, g.velocity, dt, zoneRef.current);
    if (dt > 0) {
      g.world = {
        vx: (next.xCm - from.xCm) / dt,
        vz: (next.zCm - from.zCm) / dt,
        vh: (next.headingDeg - from.headingDeg) / dt,
      };
    }
    g.stance = next;
    const { stiffness, damping } = LENS_SPRING;
    for (const key of RESIDUAL_AXES) {
      [g.residual[key], g.residualVelocity[key]] = stepSpring(g.residual[key], g.residualVelocity[key], 0, dt, stiffness, damping);
    }
    p.x = next.xCm + g.residual.x;
    p.z = next.zCm + g.residual.z;
    if (!looking) p.heading = next.headingDeg + g.residual.heading;
    mirrorStance(next);
    setData(api.walkMirror.current, 'speedCms', Math.round(Math.hypot(g.world.vx, g.world.vz)));
    return true;
  };

  useEffect(() => {
    const loco = api.locomotion;
    loco.rig = true;
    loco.wake = invalidate;
    // Keys held while the window loses focus never see their keyup.
    const drop = () => {
      if (api.heldKeys.size === 0) return;
      api.heldKeys.clear();
      invalidate();
    };
    window.addEventListener('blur', drop);
    return () => {
      window.removeEventListener('blur', drop);
      loco.rig = false;
      loco.wake = null;
      // A lens switch mid-walk keeps the ground covered so far.
      const g = gait.current;
      gait.current = null;
      if (g?.engaged) releaseGait(g, false);
      loco.engaged = false;
    };
  }, [api, invalidate, releaseGait]);

  useFrame((_, delta) => {
    const p = pose.current;
    if (!p) return;
    const dt = Math.min(Math.max(delta, 0), MAX_FRAME_DT);
    const walking = stepGait(p, dt);
    const looking = Boolean(look.current?.moved);
    const engaged = Boolean(gait.current?.engaged);
    const skip = engaged ? (looking ? GAIT_LOOK_KEYS : GAIT_KEYS) : looking ? LOOK_KEYS : null;
    const done = settleSpring(p, velocity.current, target(p), POSE_KEYS, 0.05, dt, skip);
    apply(p);
    if (!done || walking) invalidate();
  });

  // Head turns on a drag that starts anywhere but the selected module, which drags instead.
  useEffect(() => {
    const el = events.connected ?? gl.domElement;
    const onDown = (event) => {
      if (event.button !== 0 || api.drag.isActive() || !pose.current) return;
      look.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        heading: pose.current.heading,
        pitch: pose.current.pitch,
        moved: false,
      };
    };
    const onMove = (event) => {
      const l = look.current;
      if (!l || event.pointerId !== l.id || api.drag.isActive()) return;
      const dx = event.clientX - l.x;
      const dy = event.clientY - l.y;
      if (!l.moved) {
        if (Math.hypot(dx, dy) <= LOOK_THRESHOLD_PX) return;
        l.moved = true;
        api.setOrbiting(true);
      }
      const p = pose.current;
      p.heading = l.heading - dx * LOOK_DEG_PER_PX;
      p.pitch = Math.max(LOOK_PITCH.min, Math.min(LOOK_PITCH.max, l.pitch + dy * LOOK_DEG_PER_PX));
      velocity.current.heading = 0;
      velocity.current.pitch = 0;
      const mirror = api.walkMirror.current;
      if (mirror) {
        const heading = normalizeHeading(p.heading);
        const at = gait.current?.engaged ? gait.current.stance : (pending.current ?? goal.current);
        mirror.dataset.headingDeg = String(heading);
        mirror.dataset.pitchDeg = String(Math.round(p.pitch * 10) / 10);
        mirror.dataset.facingWall = facingWall({ xCm: at.xCm, zCm: at.zCm, headingDeg: heading }, roomRef.current);
      }
      invalidate();
    };
    const onUp = (event) => {
      const l = look.current;
      if (!l || event.pointerId !== l.id) return;
      look.current = null;
      if (!l.moved) return;
      api.setOrbiting(false);
      commitStance({ headingDeg: pose.current.heading, pitchDeg: pose.current.pitch });
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [events.connected, gl, api, invalidate, commitStance]);

  return null;
}

const ELEVATION_KEYS = ['x', 'y', 'z', 'tx', 'ty', 'tz', 'fov'];

/** Wall Elevation lens: level and dead-on with the middle of the active wall; switching walls swings round the room. */
function ElevationRig({ room, wall }) {
  const lens = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const aspect = size.width / Math.max(1, size.height);
  const { widthCm, depthCm, heightCm } = room;
  const goalPose = useMemo(() => {
    const e = elevationCamera({ widthCm, depthCm, heightCm }, wall, aspect);
    return {
      x: e.position[0],
      y: e.position[1],
      z: e.position[2],
      tx: e.target[0],
      ty: e.target[1],
      tz: e.target[2],
      fov: e.fov,
    };
  }, [widthCm, depthCm, heightCm, wall, aspect]);
  const goal = useRef(goalPose);
  goal.current = goalPose;
  const pose = useRef(null);
  const velocity = useRef(Object.fromEntries(ELEVATION_KEYS.map((key) => [key, 0])));

  const apply = useCallback(
    (p) => {
      lens.position.set(p.x * 0.01, p.y * 0.01, p.z * 0.01);
      lens.lookAt(p.tx * 0.01, p.ty * 0.01, p.tz * 0.01);
      if (Math.abs(lens.fov - p.fov) > 1e-3) {
        lens.fov = p.fov;
        lens.updateProjectionMatrix();
      }
    },
    [lens],
  );

  useLayoutEffect(() => {
    const g = goal.current;
    const dir = lensDirection(lens);
    const reach = Math.hypot(g.tx - lens.position.x * 100, g.ty - lens.position.y * 100, g.tz - lens.position.z * 100);
    const p = {
      x: lens.position.x * 100,
      y: lens.position.y * 100,
      z: lens.position.z * 100,
      tx: lens.position.x * 100 + dir.x * reach,
      ty: lens.position.y * 100 + dir.y * reach,
      tz: lens.position.z * 100 + dir.z * reach,
      fov: lens.fov,
    };
    lens.near = 0.05;
    lens.far = 60;
    pose.current = prefersReducedMotion() ? { ...g } : p;
    apply(pose.current);
    invalidate();
  }, [lens, apply, invalidate]);

  useEffect(() => {
    if (prefersReducedMotion() && pose.current) {
      pose.current = { ...goalPose };
      apply(pose.current);
    }
    invalidate();
  }, [goalPose, apply, invalidate]);

  useFrame((_, delta) => {
    const p = pose.current;
    if (!p) return;
    const dt = Math.min(Math.max(delta, 0), MAX_FRAME_DT);
    const done = settleSpring(p, velocity.current, goal.current, ELEVATION_KEYS, 0.05, dt);
    apply(p);
    if (!done) invalidate();
  });

  return null;
}

/* Direct manipulation bridge */

/**
 * Lends the drag controller the live camera: a screen point becomes a room
 * ray and a wall hit, and a live wall offset moves the module group without a
 * React render. Orbit is held off while a module is in hand.
 */
function DragBridge({ drag, room }) {
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);
  const roomRef = useRef(room);
  roomRef.current = room;

  useEffect(() => {
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    drag.bridge.rayHit = (clientX, clientY, wall, offsetCm) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, get().camera);
      const { origin, direction } = raycaster.ray;
      return intersectRayWithWall(
        [origin.x * 100, origin.y * 100, origin.z * 100],
        [direction.x, direction.y, direction.z],
        wall,
        roomRef.current,
        offsetCm,
      );
    };
    drag.bridge.onLive = (uid, offset) => {
      drag.groups.get(uid)?.position.set(offset[0], offset[1], offset[2]);
      invalidate();
    };
    drag.bridge.hold = () => {
      const controls = get().controls;
      if (controls) controls.enabled = false;
    };
    drag.bridge.release = () => {
      const controls = get().controls;
      if (controls) controls.enabled = true;
      invalidate();
    };
    return () => {
      drag.bridge.rayHit = null;
      drag.bridge.onLive = null;
      drag.bridge.hold = null;
      drag.bridge.release = null;
    };
  }, [drag, gl, get, invalidate]);

  return null;
}

/* Geometry helpers */

function Segments({ points, color, opacity = 1, depthTest = true }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(points.flat(), 3));
    return g;
  }, [points]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} raycast={noRaycast} renderOrder={depthTest ? 0 : 2}>
      <lineBasicMaterial color={color} transparent opacity={opacity} depthTest={depthTest} depthWrite={false} />
    </lineSegments>
  );
}

function inSection(cull, camera) {
  const value = camera.position.getComponent(cull.axis);
  return cull.below !== undefined ? value > cull.below : value < cull.above;
}

/** Hides a wall's poche and modules once the eye crosses its plane, like a section cut. `culls` needs every plane. */
function Cullable({ cull = null, culls = null, children }) {
  const ref = useRef(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    if (culls) ref.current.visible = culls.every((entry) => inSection(entry, camera));
    else if (cull) ref.current.visible = inSection(cull, camera);
  });
  return <group ref={ref}>{children}</group>;
}

function BoxEdges({ edges, ink, selected, conflict }) {
  return (
    <>
      {edges && <Edges color={ink.edge} transparent opacity={0.62} />}
      {edges && <Edges color={ink.hidden} transparent opacity={0.2} depthTest={false} renderOrder={2} />}
      {conflict && <Edges color={FAULT_COLOR} lineWidth={1.5} dashed dashSize={0.03} gapSize={0.02} />}
      {selected && <Edges color={SELECT_COLOR} lineWidth={2} />}
    </>
  );
}

function glass(wire) {
  return wire ? { transparent: true, opacity: 0.14, depthWrite: false } : {};
}

/* Procedural PBR library and world-scale geometry */

const PbrContext = createContext(null);

/**
 * One library per canvas: each material key is synthesised once into
 * DataTextures (albedo, normal, roughness), shared by every mesh that uses
 * it, and disposed with the canvas. Nothing is fetched.
 */
function createPbrLibrary(gl) {
  const cache = new Map();
  const textures = [];
  const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy?.() ?? 1);
  const texture = (data, width, height, repeat = true) => {
    const map = new DataTexture(data, width, height, RGBAFormat);
    map.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    map.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    map.magFilter = LinearFilter;
    map.minFilter = repeat ? LinearMipmapLinearFilter : LinearFilter;
    map.generateMipmaps = repeat;
    map.anisotropy = repeat ? anisotropy : 1;
    map.colorSpace = NoColorSpace;
    map.needsUpdate = true;
    textures.push(map);
    return map;
  };
  return {
    get(key) {
      if (cache.has(key)) return cache.get(key);
      const maps = synthesizeMaterial(key);
      const entry = maps
        ? {
            roughness: maps.roughness,
            map: texture(maps.albedoMap, maps.width, maps.height),
            normalMap: texture(maps.normalMap, maps.width, maps.height),
            roughnessMap: texture(maps.roughnessMap, maps.width, maps.height),
          }
        : null;
      cache.set(key, entry);
      return entry;
    },
    contact() {
      if (!cache.has('contact')) {
        const shadow = contactShadowMap(64);
        cache.set('contact', texture(shadow.data, shadow.width, shadow.height, false));
      }
      return cache.get('contact');
    },
    corner() {
      if (!cache.has('corner')) {
        const shade = cornerShadeMap(64);
        cache.set('corner', texture(shade.data, shade.width, shade.height, false));
      }
      return cache.get('corner');
    },
    /** The procedural studio environment, an sRGB equirectangular map three.js prefilters for IBL. */
    environment() {
      if (!cache.has('environment')) {
        const env = studioEnvironmentMap();
        const map = new DataTexture(env.data, env.width, env.height, RGBAFormat);
        map.mapping = EquirectangularReflectionMapping;
        map.colorSpace = SRGBColorSpace;
        map.magFilter = LinearFilter;
        map.minFilter = LinearFilter;
        map.generateMipmaps = false;
        map.needsUpdate = true;
        textures.push(map);
        cache.set('environment', { map, intensity: env.intensity });
      }
      return cache.get('environment');
    },
    dispose() {
      for (const map of textures) map.dispose();
      textures.length = 0;
      cache.clear();
    },
  };
}

function PbrProvider({ children }) {
  const gl = useThree((state) => state.gl);
  const library = useMemo(() => createPbrLibrary(gl), [gl]);
  useEffect(() => () => library.dispose(), [library]);
  return <PbrContext.Provider value={library}>{children}</PbrContext.Provider>;
}

/** The unmasked renderer string, read once per context; RENDERER first, the debug extension only where it is masked. */
function rendererName(gl) {
  const ctx = gl.getContext();
  const plain = String(ctx.getParameter(ctx.RENDERER) ?? '');
  if (plain && !/^webkit webgl$/i.test(plain)) return plain;
  const debug = ctx.getExtension('WEBGL_debug_renderer_info');
  return debug ? String(ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? plain) : plain;
}

/**
 * Image-based lighting from the procedural studio environment: timber,
 * steel, ceramic and glass pick up soft physical reflections of an overhead
 * softbox and a warm horizon bounce. A quality tier: on a software
 * rasteriser (SwiftShader, llvmpipe, WARP) per-pixel IBL costs several times
 * the frame, so the room keeps its direct rig there. The wireframe view keeps
 * plain smoked glass, so the environment comes off with it. The tier in use
 * is written straight to the scene graph mirror as data-ibl.
 */
function StudioEnvironment({ enabled, manifestRef }) {
  const pbr = useContext(PbrContext);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const tier = useMemo(() => iblTier(rendererName(gl)), [gl]);
  const active = enabled && tier === 'studio' && Boolean(pbr);
  useEffect(() => {
    setData(manifestRef?.current, 'ibl', active ? 'studio' : enabled ? tier : 'off');
    if (!active) return undefined;
    const env = pbr.environment();
    const previous = { map: scene.environment, intensity: scene.environmentIntensity };
    scene.environment = env.map;
    scene.environmentIntensity = env.intensity;
    invalidate();
    return () => {
      scene.environment = previous.map;
      scene.environmentIntensity = previous.intensity;
      invalidate();
    };
  }, [active, enabled, tier, pbr, scene, invalidate, manifestRef]);
  return null;
}

/** A geometry built once per shape and disposed when the shape changes or the mesh goes. */
function useGeometry(make, deps) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(make, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

const tileOf = (material) => (PBR_MATERIALS[material]?.tileCm ?? [40, 40]).map((cm) => cm * 0.01);

function longestAxis(size) {
  if (size[0] >= size[1] && size[0] >= size[2]) return 'x';
  return size[1] >= size[2] ? 'y' : 'z';
}

// BoxGeometry face order: +x, -x, +y, -y, +z, -z; the u and v axes of each face.
const BOX_FACES = Object.freeze([
  [2, 1, 'z', 'y'],
  [2, 1, 'z', 'y'],
  [0, 2, 'x', 'z'],
  [0, 2, 'x', 'z'],
  [0, 1, 'x', 'y'],
  [0, 1, 'x', 'y'],
]);

/** Box with UVs in metres: the map repeats every tile on every face and the grain runs along the given axis. */
function worldBoxGeometry(size, tileM, grain) {
  const geometry = new BoxGeometry(size[0], size[1], size[2]);
  const uv = geometry.attributes.uv;
  const along = grain ?? longestAxis(size);
  BOX_FACES.forEach(([ui, vi, uAxis, vAxis], face) => {
    const { swap, su, sv } = faceUvTransform(size[ui], size[vi], uAxis, vAxis, along, tileM);
    for (let i = face * 4; i < face * 4 + 4; i += 1) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (swap) uv.setXY(i, v * su, u * sv);
      else uv.setXY(i, u * su, v * sv);
    }
  });
  uv.needsUpdate = true;
  return geometry;
}

/** Cylinder with UVs in metres; grain 'y' runs the texture's u along the axis. */
function worldCylinderGeometry(radiusTop, radiusBottom, height, segments, tileM, grain, openEnded = false) {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, segments, 1, openEnded);
  const uv = geometry.attributes.uv;
  const torso = (segments + 1) * 2;
  const around = Math.PI * (radiusTop + radiusBottom);
  const across = 2 * Math.max(radiusTop, radiusBottom);
  for (let i = 0; i < uv.count; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (i >= torso) uv.setXY(i, (u * across) / tileM, (v * across) / tileM);
    else if (grain === 'y') uv.setXY(i, (v * height) / tileM, (u * around) / tileM);
    else uv.setXY(i, (u * around) / tileM, (v * height) / tileM);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Plane with UVs in metres; `vOffset` shifts the pattern, so floor planks land on the room's plank seams. */
function worldPlaneGeometry(width, height, tileU, tileV, vOffset = 0) {
  const geometry = new PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * width) / tileU, (uv.getY(i) * height) / tileV + vOffset);
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Standard material with the procedural maps of its family. The roughness
 * map holds absolute values, so a part's own roughness scales it; the
 * wireframe view drops the maps for smoked glass.
 */
function PbrMaterial({ material, color, roughness, metalness = 0, wire = false, emissive = null, emissiveIntensity = 0 }) {
  const pbr = useContext(PbrContext);
  const maps = !wire && pbr ? pbr.get(material) : null;
  return (
    <meshStandardMaterial
      key={wire ? 'glass' : maps ? `pbr-${material}` : 'flat'}
      color={color}
      roughness={maps ? Math.min(4, roughness / maps.roughness) : roughness}
      metalness={metalness}
      map={maps ? maps.map : null}
      normalMap={maps ? maps.normalMap : null}
      roughnessMap={maps ? maps.roughnessMap : null}
      emissive={emissive ?? '#000000'}
      emissiveIntensity={emissive ? emissiveIntensity : 0}
      {...glass(wire)}
    />
  );
}

/** One CAD sub-part of a module or a piece of furniture. Never picked: the part's hull takes the pointer. */
function Subpart({ part, wire }) {
  const [tile] = tileOf(part.material);
  const { geometry: shape, radius, radiusBottom, segments, grain } = part;
  const [sx, sy, sz] = part.size;
  const geometry = useGeometry(
    () =>
      shape === 'cylinder'
        ? worldCylinderGeometry(radius, radiusBottom, sy, segments ?? 24, tile, grain)
        : worldBoxGeometry([sx, sy, sz], tile, grain),
    [shape, radius, radiusBottom, segments, grain, sx, sy, sz, tile],
  );
  const [rx, ry, rz] = part.rotation;
  return (
    <mesh
      geometry={geometry}
      position={part.position}
      rotation={[rx, ry, rz, 'YXZ']}
      castShadow={!wire && part.shadow}
      receiveShadow
      raycast={noRaycast}
    >
      <PbrMaterial
        material={part.material}
        color={part.color}
        roughness={part.roughness}
        metalness={part.metalness}
        wire={wire}
        emissive={part.emissive}
        emissiveIntensity={part.emissiveIntensity}
      />
    </mesh>
  );
}

const bakeEuler = new Euler();
const bakeQuaternion = new Quaternion();
const bakePosition = new Vector3();
const bakeScale = new Vector3(1, 1, 1);
const bakeMatrix = new Matrix4();

/** A sub-part's geometry with world-scale UVs, baked into its place in the room. */
function bakedPartGeometry(part) {
  const [tile] = tileOf(part.material);
  const geometry =
    part.geometry === 'cylinder'
      ? worldCylinderGeometry(part.radius, part.radiusBottom, part.size[1], part.segments ?? 24, tile, part.grain)
      : worldBoxGeometry(part.size, tile, part.grain);
  const [rx, ry, rz] = part.rotation;
  bakeQuaternion.setFromEuler(bakeEuler.set(rx, ry, rz, 'YXZ'));
  geometry.applyMatrix4(bakeMatrix.compose(bakePosition.fromArray(part.position), bakeQuaternion, bakeScale));
  return geometry;
}

/**
 * Sub-parts that share a look (family, colour, surface, glow, shadow) are
 * merged into one geometry and drawn in one call: a frame's nine felt slats
 * are one mesh and its four timber members another. The scene graph still
 * lists every sub-part; only the draw calls are batched, which keeps a
 * furnished room's frame cost close to the plain-box engine's.
 */
function usePartBatches(parts) {
  const signature = JSON.stringify(parts);
  const batches = useMemo(() => {
    const groups = new Map();
    for (const part of parts) {
      const key = subpartLookKey(part);
      if (!groups.has(key)) groups.set(key, { key, look: part, geometries: [] });
      groups.get(key).geometries.push(bakedPartGeometry(part));
    }
    return [...groups.values()].flatMap(({ key, look, geometries }) => {
      if (geometries.length === 1) return [{ key, look, geometry: geometries[0] }];
      const merged = mergeGeometries(geometries, false);
      if (!merged) return geometries.map((geometry, i) => ({ key: `${key}|${i}`, look, geometry }));
      for (const geometry of geometries) geometry.dispose();
      return [{ key, look, geometry: merged }];
    });
    // The signature carries every value the batches are built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  useEffect(
    () => () => {
      for (const batch of batches) batch.geometry.dispose();
    },
    [batches],
  );
  return batches;
}

/** A set of CAD sub-parts, drawn as one mesh per shared look. Never picked: the hull takes the pointer. */
function PartBatches({ parts, wire }) {
  const batches = usePartBatches(parts);
  return batches.map(({ key, look, geometry }) => (
    <mesh key={key} geometry={geometry} castShadow={!wire && look.shadow} receiveShadow raycast={noRaycast}>
      <PbrMaterial
        material={look.material}
        color={look.color}
        roughness={look.roughness}
        metalness={look.metalness}
        wire={wire}
        emissive={look.emissive}
        emissiveIntensity={look.emissiveIntensity}
      />
    </mesh>
  ));
}

/** Soft contact occlusion laid on a wall or the floor. */
function ContactShadow({ plane }) {
  const pbr = useContext(PbrContext);
  const alpha = pbr ? pbr.contact() : null;
  if (!alpha) return null;
  return (
    <mesh position={plane.position} rotation={plane.rotation} raycast={noRaycast} renderOrder={1}>
      <planeGeometry args={plane.size} />
      <meshBasicMaterial
        color="#000000"
        alphaMap={alpha}
        transparent
        opacity={plane.opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        toneMapped={false}
      />
    </mesh>
  );
}

/* Volumetric light */

const BEAM_VERTEX = /* glsl */ `
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

// Bright at the source and fading along the beam (or toward both ends when
// symmetric). Cones soften at their silhouette by how squarely the surface
// faces the eye; sheets soften across their width. Drawn additively.
const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSheet;
uniform float uSymmetric;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  float along = uSymmetric > 0.5 ? 1.0 - abs(vUv.y * 2.0 - 1.0) : vUv.y;
  float fall = pow(clamp(along, 0.0, 1.0), 1.35);
  float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float edge = mix(pow(facing, 1.5), smoothstep(0.0, 0.55, across), uSheet);
  gl_FragColor = vec4(uColor, uOpacity * fall * edge);
  #include <colorspace_fragment>
}
`;

function useBeamMaterial(color, opacity, sheet, symmetric) {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color() },
          uOpacity: { value: 0 },
          uSheet: { value: 0 },
          uSymmetric: { value: 0 },
        },
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [],
  );
  useLayoutEffect(() => {
    material.uniforms.uColor.value.set(color);
    material.uniforms.uOpacity.value = opacity;
    material.uniforms.uSheet.value = sheet ? 1 : 0;
    material.uniforms.uSymmetric.value = symmetric ? 1 : 0;
  }, [material, color, opacity, sheet, symmetric]);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/**
 * Quads from a source edge (uv.y 1) to a far edge (uv.y 0), uv.x across each.
 * Each quad is [s0, s1, f0, f1].
 */
function quadsGeometry(quads) {
  const positions = [];
  const uvs = [];
  for (const [s0, s1, f0, f1] of quads) {
    positions.push(...s0, ...f0, ...s1, ...s1, ...f0, ...f1);
    uvs.push(0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** A light sheet in the wall frame: one quad, or a four-sided frustum when it has depth. */
function sheetGeometry(beam) {
  const { width0: w0, width1: w1, depth0: d0, depth1: d1, length, direction, reach, symmetric } = beam;
  const ys = symmetric ? length / 2 : 0;
  const yf = symmetric ? -length / 2 : direction * length;
  const zf = symmetric ? 0 : reach;
  if (!(d0 > 0 || d1 > 0)) {
    return quadsGeometry([[[-w0 / 2, ys, 0], [w0 / 2, ys, 0], [-w1 / 2, yf, zf], [w1 / 2, yf, zf]]]);
  }
  const s = (x, z) => [x, ys, z];
  const f = (x, z) => [x, yf, zf + z];
  return quadsGeometry([
    [s(-w0 / 2, d0 / 2), s(w0 / 2, d0 / 2), f(-w1 / 2, d1 / 2), f(w1 / 2, d1 / 2)],
    [s(-w0 / 2, -d0 / 2), s(w0 / 2, -d0 / 2), f(-w1 / 2, -d1 / 2), f(w1 / 2, -d1 / 2)],
    [s(-w0 / 2, -d0 / 2), s(-w0 / 2, d0 / 2), f(-w1 / 2, -d1 / 2), f(-w1 / 2, d1 / 2)],
    [s(w0 / 2, -d0 / 2), s(w0 / 2, d0 / 2), f(w1 / 2, -d1 / 2), f(w1 / 2, d1 / 2)],
  ]);
}

const BEAM_AXIS = new Vector3(0, -1, 0);

/** A volumetric light beam: a cone from its apex along its axis, or a sheet hung from its source. Never picked. */
function VolumetricCone({ beam }) {
  const cone = beam.geometry === 'cone';
  const material = useBeamMaterial(beam.color, beam.opacity, !cone, beam.symmetric);
  const { length, radiusTop, radiusBottom, width0, width1, depth0, depth1, reach, symmetric } = beam;
  // A sheet hangs up (+1), down (-1) or centred (0); a cone's axis is its own quaternion.
  const direction = cone ? 0 : beam.direction;
  const geometry = useGeometry(() => {
    if (!cone) return sheetGeometry({ width0, width1, depth0, depth1, length, direction, reach, symmetric });
    const g = new CylinderGeometry(radiusTop, radiusBottom, length, 32, 1, true);
    g.translate(0, -length / 2, 0);
    return g;
  }, [cone, length, radiusTop, radiusBottom, width0, width1, depth0, depth1, direction, reach, symmetric]);
  const [dx, dy, dz] = cone ? beam.direction : [0, -1, 0];
  const quaternion = useMemo(() => new Quaternion().setFromUnitVectors(BEAM_AXIS, new Vector3(dx, dy, dz)), [dx, dy, dz]);
  if (cone) {
    return <mesh geometry={geometry} material={material} position={beam.position} quaternion={quaternion} raycast={noRaycast} renderOrder={3} />;
  }
  return <mesh geometry={geometry} material={material} position={beam.position} rotation={beam.rotation} raycast={noRaycast} renderOrder={3} />;
}

/** A shaft of sunlight from a window pane to where it lands, in room metres. */
function SunShaft({ shaft }) {
  const material = useBeamMaterial(shaft.color, shaft.opacity, true, false);
  const key = JSON.stringify([shaft.from, shaft.to]);
  const geometry = useGeometry(
    () => quadsGeometry(shaft.from.map((s0, i) => [s0, shaft.from[(i + 1) % 4], shaft.to[i], shaft.to[(i + 1) % 4]])),
    [key],
  );
  return <mesh geometry={geometry} material={material} raycast={noRaycast} renderOrder={3} />;
}

/** A sunlit patch on the floor, mullion gaps and all. */
function SunPatch({ patch }) {
  const key = JSON.stringify(patch.points);
  const geometry = useGeometry(() => {
    const positions = [];
    for (let i = 1; i < patch.points.length - 1; i += 1) positions.push(...patch.points[0], ...patch.points[i], ...patch.points[i + 1]);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return g;
  }, [key]);
  return (
    <mesh geometry={geometry} raycast={noRaycast} renderOrder={2}>
      <meshBasicMaterial
        color={patch.color}
        transparent
        opacity={patch.opacity}
        blending={AdditiveBlending}
        side={DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-3}
        polygonOffsetUnits={-3}
        toneMapped={false}
      />
    </mesh>
  );
}

/**
 * One window: the glazing (a twilight sky at night, the sun's sky by day),
 * its plaster reveal, oak sill and steel bars, and the sun or moonlight it
 * lets in. Every member record carries its own look.
 */
function WindowLayer({ win, wire }) {
  const { glazing } = win;
  return (
    <group name={`window-${win.wall}`}>
      <Cullable cull={win.cull}>
        <mesh position={glazing.position} rotation={glazing.rotation} raycast={noRaycast}>
          <planeGeometry args={glazing.size} />
          <meshStandardMaterial
            color={glazing.base}
            emissive={glazing.color}
            emissiveIntensity={glazing.intensity}
            roughness={0.08}
            metalness={0.2}
            envMapIntensity={0.6}
            polygonOffset
            polygonOffsetFactor={-1}
            polygonOffsetUnits={-1}
            {...glass(wire)}
          />
        </mesh>
        <PartBatches parts={win.members} wire={wire} />
        {!wire && win.shafts.map((shaft) => <SunShaft key={shaft.id} shaft={shaft} />)}
      </Cullable>
      {!wire && win.patches.map((patch) => <SunPatch key={patch.id} patch={patch} />)}
    </group>
  );
}

/** True when the hit sits under a group the section cut has hidden. */
function culled(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return true;
  return false;
}

/* Scene parts */

/**
 * A wall, floor or ceiling plane under its procedural maps, the pattern laid
 * in room metres; the floor's planks land on the room's 18 cm plank seams.
 */
function ShellSurface({ surface, wire, name, onClick }) {
  const [tileU, tileV] = tileOf(surface.material);
  const [width, height] = surface.size;
  const floor = surface.id === 'floor';
  const geometry = useGeometry(
    () => worldPlaneGeometry(width, height, tileU, tileV, floor ? -height / tileV : 0),
    [width, height, tileU, tileV, floor],
  );
  return (
    <mesh geometry={geometry} position={surface.position} rotation={surface.rotation} receiveShadow name={name} onClick={onClick}>
      <PbrMaterial
        material={surface.material}
        color={surface.color}
        roughness={surface.roughness ?? 0.92}
        wire={wire}
        emissive={surface.glow ?? null}
        emissiveIntensity={surface.glow ? 1 : 0}
      />
    </mesh>
  );
}

function Shell({ shell, wire, onBackground }) {
  return (
    <group onClick={onBackground}>
      {shell.surfaces.map((surface) => (
        <ShellSurface key={surface.id} surface={surface} wire={wire} name={`surface-${surface.id}`} />
      ))}
      {shell.poche.map((slab) => (
        <Cullable key={slab.id} cull={slab.cull}>
          <mesh position={slab.position} raycast={noRaycast}>
            <boxGeometry args={slab.size} />
            <meshStandardMaterial color={slab.color} roughness={1} />
          </mesh>
        </Cullable>
      ))}
    </group>
  );
}

/** A soft vertical falloff at an inside corner, laid on one wall. */
function CornerShade({ shade }) {
  const pbr = useContext(PbrContext);
  const alpha = pbr ? pbr.corner() : null;
  if (!alpha) return null;
  return (
    <mesh position={shade.position} rotation={shade.rotation} raycast={noRaycast} renderOrder={1}>
      <planeGeometry args={shade.size} />
      <meshBasicMaterial
        color="#000000"
        alphaMap={alpha}
        transparent
        opacity={shade.opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Baseboards, the ceiling shadow-gap cove, corner depth and, at eye level only, the ceiling. */
function Envelope({ envelope, showCeiling, wire, onBackground }) {
  const { ceiling } = envelope;
  return (
    <group>
      {showCeiling && <ShellSurface surface={ceiling} wire={wire} name="surface-ceiling" onClick={onBackground} />}
      {envelope.coves.map((cove) => (
        <Cullable key={cove.id} cull={cove.cull}>
          <PartBatches parts={cove.parts} wire={wire} />
        </Cullable>
      ))}
      {!wire &&
        envelope.cornerShades.map((shade) => (
          <Cullable key={shade.id} culls={shade.culls}>
            <CornerShade shade={shade} />
          </Cullable>
        ))}
      {envelope.baseboards.map((board) => (
        <Cullable key={board.id} cull={board.cull}>
          <Subpart
            part={{
              id: board.id,
              geometry: 'box',
              size: board.size,
              position: board.position,
              rotation: [0, 0, 0],
              material: board.material,
              color: board.color,
              roughness: 0.7,
              metalness: 0,
              grain: null,
              shadow: false,
              emissive: null,
              emissiveIntensity: 0,
            }}
            wire={wire}
          />
        </Cullable>
      ))}
    </group>
  );
}

function Creases({ creases, color, opacity }) {
  return creases.map((crease) => (
    <Cullable key={crease.id} culls={crease.culls}>
      <Segments points={crease.points} color={color} opacity={opacity} />
    </Cullable>
  ));
}

function LedSpot({ light }) {
  const ref = useRef(null);
  const target = useMemo(() => new Object3D(), []);
  const [tx, ty, tz] = light.target;
  useLayoutEffect(() => {
    target.position.set(tx, ty, tz);
    target.updateMatrixWorld();
    if (ref.current) ref.current.target = target;
  }, [target, tx, ty, tz]);
  return (
    <>
      <spotLight
        ref={ref}
        position={light.position}
        color={light.color}
        intensity={light.intensity}
        angle={light.angle}
        penumbra={light.penumbra}
        distance={light.distance}
        decay={light.decay}
      />
      <primitive object={target} />
    </>
  );
}

function ModuleLight({ light }) {
  if (light.type === 'spot') return <LedSpot light={light} />;
  return (
    <pointLight
      position={light.position}
      color={light.color}
      intensity={light.intensity}
      distance={light.distance}
      decay={light.decay}
    />
  );
}

// Meshes sit in the wall's section cut; the lights stay outside it, so a
// wall hidden behind the eye still lights the room.
function ModuleMesh({ module, wire, edges, ink, drag, onSelect, onHover }) {
  const groupRef = useRef(null);
  const [px, py, pz] = module.position;
  const { uid } = module;
  const assembled = module.subparts.length > 0;

  useLayoutEffect(() => {
    const group = groupRef.current;
    drag.groups.set(uid, group);
    return () => {
      if (drag.groups.get(uid) === group) drag.groups.delete(uid);
    };
  }, [drag, uid]);

  // A committed drag lands in the record; the live offset goes back to zero in the same frame.
  useLayoutEffect(() => {
    groupRef.current?.position.set(0, 0, 0);
  }, [px, py, pz]);

  const onClick = (event) => {
    if (culled(event.object)) return;
    event.stopPropagation();
    if (event.delta <= DRAG_THRESHOLD_PX) onSelect(module.uid);
  };
  // Only the selected module drags; anywhere else a press still orbits or looks.
  const onPointerDown = (event) => {
    if (!module.selected || event.button !== 0 || culled(event.object)) return;
    const native = event.nativeEvent;
    const started = drag.beginPointer({
      source: 'mesh',
      clientX: native.clientX,
      clientY: native.clientY,
      pointerId: native.pointerId,
    });
    if (started) event.stopPropagation();
  };
  return (
    <group
      ref={groupRef}
      name={module.uid}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerOver={(event) => {
        if (culled(event.object)) return;
        event.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
    >
      <Cullable cull={module.cull}>
        {/* The hull: the module's bounding primitive. It takes the pointer and carries the
            selection and technical outlines; drawn only for a part without sub-assemblies. */}
        <mesh position={module.position} rotation={module.rotation} castShadow={!wire && !assembled} receiveShadow>
          {module.geometry === 'cylinder' ? (
            <cylinderGeometry args={[module.radius, module.radius, module.size[1], 32]} />
          ) : (
            <boxGeometry args={module.size} />
          )}
          {assembled ? (
            <meshBasicMaterial visible={false} />
          ) : (
            <PbrMaterial
              material={module.material}
              color={module.color}
              roughness={module.roughness}
              metalness={module.metalness}
              wire={wire}
            />
          )}
          <BoxEdges edges={edges} ink={ink} selected={module.selected} conflict={module.conflict} />
        </mesh>
        {assembled && <PartBatches parts={module.subparts} wire={wire} />}
        {!assembled && module.felt && (
          <mesh position={module.felt.position} rotation={module.rotation} receiveShadow>
            <boxGeometry args={module.felt.size} />
            <meshStandardMaterial color={module.felt.color} roughness={0.96} {...glass(wire)} />
          </mesh>
        )}
        {module.emitters.map((emitter) => (
          <mesh key={emitter.key} position={emitter.position} rotation={module.rotation} raycast={noRaycast}>
            <boxGeometry args={emitter.size} />
            <meshStandardMaterial color="#1a1916" emissive={emitter.color} emissiveIntensity={emitter.intensity} roughness={0.4} />
          </mesh>
        ))}
        {!wire && <ContactShadow plane={module.aoShadow} />}
        {!wire && module.aoFloor && <ContactShadow plane={module.aoFloor} />}
        {!wire && module.volumetrics.map((beam) => <VolumetricCone key={beam.id} beam={beam} />)}
      </Cullable>
      {module.lights.map((light) => (
        <ModuleLight key={light.id} light={light} />
      ))}
    </group>
  );
}

/**
 * A floor reference part: its collision box, drawn under its material
 * unless the detail replaces it, carrying the technical outline, and the
 * architectural detail (legs, cushions, headboard, objects) around it.
 */
function FurnitureMesh({ part, wire, edges, ink }) {
  const [tile] = tileOf(part.material);
  const [sx, sy, sz] = part.size;
  const geometry = useGeometry(() => worldBoxGeometry([sx, sy, sz], tile, null), [sx, sy, sz, tile]);
  return (
    <group>
      <mesh geometry={geometry} position={part.position} castShadow={!wire && part.body} receiveShadow name={`furniture-${part.part}`}>
        {part.body ? (
          <PbrMaterial material={part.material} color={part.color} roughness={part.roughness} metalness={part.metalness} wire={wire} />
        ) : (
          <meshBasicMaterial visible={false} />
        )}
        <BoxEdges edges={edges} ink={ink} selected={false} conflict={false} />
      </mesh>
      {part.subparts.length > 0 && <PartBatches parts={part.subparts} wire={wire} />}
    </group>
  );
}

function Sun({ rig, size, heading }) {
  const ref = useRef(null);
  const target = useMemo(() => new Object3D(), []);
  const [W, H, D] = size;
  const from = sunDirection(rig, heading);
  const length = Math.hypot(...from);
  const reach = 9;
  const position = [W / 2 + (from[0] / length) * reach, (from[1] / length) * reach, D / 2 + (from[2] / length) * reach];
  const span = Math.max(W, D, H) * 0.95;

  useLayoutEffect(() => {
    target.position.set(W / 2, 0, D / 2);
    target.updateMatrixWorld();
    const light = ref.current;
    if (!light) return;
    light.target = target;
    const cam = light.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.near = 0.5;
    cam.far = reach * 2.4;
    cam.updateProjectionMatrix();
  }, [target, W, D, span]);

  return (
    <>
      <directionalLight
        ref={ref}
        position={position}
        color={rig.sun.color}
        intensity={rig.sun.intensity}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <primitive object={target} />
    </>
  );
}

// Html overlays ignore 3D visibility, so a label on a culled wall hides
// itself with a direct style write, never a React state update.
function Label({ position, className, cull = null, children }) {
  const ref = useRef(null);
  useFrame(({ camera }) => {
    const el = ref.current;
    if (!cull || !el) return;
    const display = inSection(cull, camera) ? '' : 'none';
    if (el.style.display !== display) el.style.display = display;
  });
  return (
    <Html position={position} center pointerEvents="none" zIndexRange={[4, 0]} wrapperClass="room3d-label-host">
      <span ref={ref} className={className}>
        {children}
      </span>
    </Html>
  );
}

function TechnicalLayer({ scene }) {
  return (
    <group>
      <Segments points={scene.roomEdges} color={AXIS_COLORS.x} opacity={0.5} />
      {scene.axes.map((axis) => (
        <group key={axis.id}>
          <Segments points={axis.points} color={AXIS_COLORS[axis.id]} opacity={0.95} depthTest={false} />
          <Label position={axis.labelAt} className={`room3d-label room3d-label--axis room3d-label--${axis.id}`}>
            {axis.label}
          </Label>
        </group>
      ))}
      {scene.callouts.map((callout) => (
        <group key={callout.id}>
          <Segments points={callout.points} color={CALLOUT_COLORS[callout.tone]} depthTest={false} />
          <Label position={callout.labelAt} className={`room3d-label room3d-label--callout room3d-label--${callout.tone}`}>
            {callout.label}
          </Label>
        </group>
      ))}
      {scene.tags.map((tag) => (
        <Label key={tag.uid} position={tag.at} cull={tag.cull} className="room3d-label room3d-label--tag">
          {tag.sku}
        </Label>
      ))}
    </group>
  );
}

/** False-colour floor illuminance laid on the slab, with iso-lux contours and the hotspot. */
function FloorLuxLayer({ field }) {
  const texture = useMemo(() => {
    const image = fieldImage(field);
    const map = new DataTexture(new Uint8Array(image.data.buffer), image.width, image.height, RGBAFormat);
    map.colorSpace = SRGBColorSpace;
    map.magFilter = LinearFilter;
    map.minFilter = LinearFilter;
    map.needsUpdate = true;
    return map;
  }, [field]);
  useEffect(() => () => texture.dispose(), [texture]);

  const contours = useMemo(
    () =>
      isoLuxContours(field)
        .filter((contour) => contour.segments.length > 0)
        .map((contour) => ({
          lux: contour.lux,
          points: contour.segments.flatMap(([x1, y1, x2, y2]) => [
            [x1 * 0.01, FLOOR_LUX_LIFT + 0.002, y1 * 0.01],
            [x2 * 0.01, FLOOR_LUX_LIFT + 0.002, y2 * 0.01],
          ]),
        })),
    [field],
  );

  const W = field.widthCm * 0.01;
  const D = field.depthCm * 0.01;
  const { hotspot } = field;
  return (
    <group name="floor-lux-grid">
      <mesh position={[W / 2, FLOOR_LUX_LIFT, D / 2]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={1}>
        <planeGeometry args={[W, D]} />
        <meshBasicMaterial map={texture} transparent opacity={0.88} depthWrite={false} toneMapped={false} />
      </mesh>
      {contours.map((contour) => (
        <Segments key={contour.lux} points={contour.points} color={ISO_COLORS[contour.lux]} opacity={0.9} />
      ))}
      {hotspot && (
        <Label position={[hotspot.xCm * 0.01, 0.03, hotspot.yCm * 0.01]} className="room3d-label room3d-label--lux">
          Peak {formatInt(hotspot.lux)} lx
        </Label>
      )}
    </group>
  );
}

/**
 * Writes where each module centre lands on screen into the hidden scene
 * graph, so pointer picking can be exercised against real pixels.
 */
function ScreenProbe({ modules, manifestRef }) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    const root = manifestRef.current;
    if (!root) return;
    for (const module of modules) {
      const el = root.querySelector(`[data-testid="room-module"][data-uid="${CSS.escape(module.uid)}"]`);
      if (!el) continue;
      point.set(...module.position).project(camera);
      const x = String(Math.round(((point.x + 1) / 2) * size.width));
      const y = String(Math.round(((1 - point.y) / 2) * size.height));
      if (el.dataset.screenX !== x) el.dataset.screenX = x;
      if (el.dataset.screenY !== y) el.dataset.screenY = y;
    }
  });
  return null;
}

/**
 * Lends the page a synchronous frame grab for the studio render: advance()
 * draws one frame on demand and the caller reads the canvas in the same task,
 * before the buffer is presented and cleared, so no preserveDrawingBuffer
 * cost is paid on every frame.
 */
function SnapshotBridge({ captureRef }) {
  const gl = useThree((state) => state.gl);
  const advance = useThree((state) => state.advance);
  useEffect(() => {
    if (!captureRef) return undefined;
    const capture = () => {
      advance(performance.now());
      return gl.domElement;
    };
    captureRef.current = capture;
    return () => {
      if (captureRef.current === capture) captureRef.current = null;
    };
  }, [captureRef, gl, advance]);
  return null;
}

const tenthPx = (value) => Math.round(value * 10) / 10;

/**
 * Per-frame HUD writes, all straight to the DOM: the compass bearing, which
 * wall planes are in view, and the transform gizmo with its laser dimension
 * lines projected from the selected module's live wall position.
 */
function OverlayProbe({ drag, api, room, cameraMode, manifestRef }) {
  const point = useMemo(() => new Vector3(), []);
  const dir = useMemo(() => new Vector3(), []);
  const { widthCm, depthCm, heightCm } = room;
  const culls = useMemo(
    () => ROOM_WALLS.map((wall) => [wall, wallCull({ widthCm, depthCm, heightCm }, wall)]),
    [widthCm, depthCm, heightCm],
  );

  useFrame(({ camera, size }) => {
    camera.getWorldDirection(dir);
    const bearing = normalizeHeading(Math.atan2(dir.x, -dir.z) / DEG);
    const compass = api.hud.compass;
    if (compass && compass.dataset.azimuth !== String(Math.round(bearing))) {
      compass.dataset.azimuth = String(Math.round(bearing));
      compass.style.setProperty('--bearing', `${bearing}deg`);
      setText(compass.querySelector('[data-part="readout"]'), compassReadout(bearing));
    }

    const root = manifestRef.current;
    if (root) {
      for (const [wall, cull] of culls) {
        setData(root.querySelector(`[data-testid="room-wall"][data-wall="${wall}"]`), 'visible', inSection(cull, camera));
      }
      setData(root.querySelector('[data-testid="room-ceiling"]'), 'visible', cameraMode === 'inside');
    }

    const gizmo = drag.refs.gizmo;
    const anchor = gizmo ? drag.anchor() : null;
    if (!gizmo || !anchor) return;
    const toScreen = (cm) => {
      point.set(cm[0] * 0.01, cm[1] * 0.01, cm[2] * 0.01).project(camera);
      return {
        x: ((point.x + 1) / 2) * size.width,
        y: ((1 - point.y) / 2) * size.height,
        ahead: point.z > -1 && point.z < 1,
      };
    };
    const { wall, xCm, yCm, w, h, d, span, height } = anchor;
    const at = (a, b, c) => wallToRoom(anchor.room, wall, [a, b, c]);
    const cx = xCm + w / 2;
    const cy = yCm + h / 2;
    const front = at(cx, cy, d);
    const origin = toScreen(front);
    const shown = origin.ahead && inSection(wallCull(anchor.room, wall), camera);
    setData(gizmo, 'projected', shown);
    if (shown) {
      const u = wallDirToRoom(wall, [30, 0, 0]);
      const uEnd = toScreen([front[0] + u[0], front[1], front[2] + u[2]]);
      const vEnd = toScreen([front[0], front[1] + 30, front[2]]);
      const ua = Math.atan2(uEnd.y - origin.y, uEnd.x - origin.x);
      const va = Math.atan2(vEnd.y - origin.y, vEnd.x - origin.x);
      const transform = `translate3d(${tenthPx(origin.x)}px, ${tenthPx(origin.y)}px, 0)`;
      if (gizmo.style.transform !== transform) gizmo.style.transform = transform;
      gizmo.style.setProperty('--u-angle', `${ua.toFixed(4)}rad`);
      gizmo.style.setProperty('--v-angle', `${va.toFixed(4)}rad`);
      gizmo.style.setProperty('--p-x', `${tenthPx(22 * (Math.cos(ua) + Math.cos(va)))}px`);
      gizmo.style.setProperty('--p-y', `${tenthPx(22 * (Math.sin(ua) + Math.sin(va)))}px`);
      setData(gizmo, 'screenX', Math.round(origin.x));
      setData(gizmo, 'screenY', Math.round(origin.y));
    }

    const dims = drag.refs.dims;
    if (!dims) return;
    setData(dims, 'projected', shown);
    if (!shown) return;
    // Dimension lines leave from the module's corners, clear of the gizmo arms at its centre.
    const segments = {
      floor: [at(xCm, yCm, d), at(xCm, 0, d), yCm],
      left: [at(xCm, yCm, d), at(0, yCm, d), xCm],
      right: [at(xCm + w, yCm, d), at(span, yCm, d), span - xCm - w],
      ceiling: [at(xCm, yCm + h, d), at(xCm, height, d), height - yCm - h],
    };
    for (const [id, [from, to, length]] of Object.entries(segments)) {
      const line = dims.querySelector(`[data-line="${id}"]`);
      const label = dims.querySelector(`[data-dim="${id}"]`);
      const a = toScreen(from);
      const b = toScreen(to);
      const visible = length > 0 && a.ahead && b.ahead;
      setAttr(line, 'visibility', visible ? 'visible' : 'hidden');
      setData(label, 'visible', visible);
      if (!visible) continue;
      setAttr(line, 'x1', tenthPx(a.x));
      setAttr(line, 'y1', tenthPx(a.y));
      setAttr(line, 'x2', tenthPx(b.x));
      setAttr(line, 'y2', tenthPx(b.y));
      if (label) {
        const t = `translate3d(${tenthPx((a.x + b.x) / 2)}px, ${tenthPx((a.y + b.y) / 2)}px, 0) translate(-50%, -50%)`;
        if (label.style.transform !== t) label.style.transform = t;
      }
    }
  });
  return null;
}

const SceneGraph = memo(function SceneGraph({ scene, floorLux, heading, cameraMode, drag, onSelect, onHover }) {
  const ink = INK[scene.lighting] ?? INK.night;
  const wire = scene.wireframe;
  const onBackground = (event) => {
    if (event.delta <= DRAG_THRESHOLD_PX && !drag.isActive()) onSelect(null);
  };
  return (
    <>
      <ambientLight color={scene.rig.ambient.color} intensity={scene.rig.ambient.intensity} />
      <hemisphereLight
        color={scene.rig.hemisphere.sky}
        groundColor={scene.rig.hemisphere.ground}
        intensity={scene.rig.hemisphere.intensity}
      />
      <Sun rig={scene.rig} size={scene.size} heading={heading} />

      <Shell shell={scene.shell} wire={wire} onBackground={onBackground} />
      <Envelope envelope={scene.envelope} showCeiling={cameraMode === 'inside'} wire={wire} onBackground={onBackground} />
      {scene.windows.map((win) => (
        <WindowLayer key={win.id} win={win} wire={wire} />
      ))}
      {!wire && scene.furnitureAo && <ContactShadow plane={scene.furnitureAo} />}
      <Segments points={scene.planks} color={scene.rig.plank.color} opacity={scene.rig.plank.opacity} />
      <Segments points={scene.grid} color={scene.rig.grid.color} opacity={scene.technical ? 0.16 : scene.rig.grid.opacity} />
      <Segments points={scene.scaleTicks} color={scene.rig.trim.color} opacity={0.55} />
      <Segments points={scene.trim} color={scene.rig.trim.color} opacity={scene.rig.trim.opacity} />
      <Creases creases={scene.envelope.creases} color={scene.rig.crease.color} opacity={scene.rig.crease.opacity} />
      {floorLux && <FloorLuxLayer field={floorLux} />}

      {scene.furniture.map((part) => (
        <FurnitureMesh key={part.part} part={part} wire={wire} edges={scene.edges} ink={ink} />
      ))}
      {scene.furnitureVignette && (
        <group name={scene.furnitureVignette.id}>
          <PartBatches parts={scene.furnitureVignette.parts} wire={wire} />
        </group>
      )}
      {scene.modules.map((module) => (
        <ModuleMesh
          key={module.uid}
          module={module}
          wire={wire}
          edges={scene.edges}
          ink={ink}
          drag={drag}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}

      {wire && <Segments points={scene.roomEdges} color={ink.wire} opacity={0.4} />}
      {scene.technical && <TechnicalLayer scene={scene} />}
    </>
  );
});

/**
 * React Three Fiber viewport. Renders on demand: a frame is drawn only when
 * the scene, the camera or the canvas size changes. The canvas is
 * transparent; the stage behind it paints the horizon.
 */
function LensRig({ cameraMode, room, wall, camera, walk, insideFov, api }) {
  if (cameraMode === 'inside') return <WalkRig room={room} walk={walk} insideFov={insideFov} api={api} />;
  if (cameraMode === 'elevation') return <ElevationRig room={room} wall={wall} />;
  return <CameraRig room={room} wall={wall} camera={camera} api={api} />;
}

export default function RoomCanvas({
  scene,
  floorLux,
  room,
  wall,
  camera,
  cameraMode,
  walk,
  insideFov,
  api,
  drag,
  manifestRef,
  captureRef,
  onSelect,
  onHover,
  onReady,
}) {
  return (
    <Canvas
      className="room3d-canvas"
      data-testid="room-canvas"
      frameloop="demand"
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 38, near: 0.05, far: 60, position: [0, 2, 6] }}
      onCreated={({ gl }) => onReady(gl.capabilities.isWebGL2 ? 'webgl2' : 'webgl')}
      onPointerMissed={(event) => {
        if (event.type === 'click' && !drag.isActive()) onSelect(null);
      }}
    >
      <LensRig
        cameraMode={cameraMode}
        room={room}
        wall={wall}
        camera={camera}
        walk={walk}
        insideFov={insideFov}
        api={api}
      />
      <PbrProvider>
        <StudioEnvironment enabled={!scene.wireframe} manifestRef={manifestRef} />
        <SceneGraph
          scene={scene}
          floorLux={floorLux}
          heading={WALL_HEADING[wall] ?? 0}
          cameraMode={cameraMode}
          drag={drag}
          onSelect={onSelect}
          onHover={onHover}
        />
      </PbrProvider>
      <ScreenProbe modules={scene.modules} manifestRef={manifestRef} />
      <DragBridge drag={drag} room={room} />
      <OverlayProbe drag={drag} api={api} room={room} cameraMode={cameraMode} manifestRef={manifestRef} />
      <SnapshotBridge captureRef={captureRef} />
    </Canvas>
  );
}
