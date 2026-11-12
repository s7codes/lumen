import { Edges, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  Object3D,
  Raycaster,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { formatInt } from '../../lib/format.js';
import { fieldImage, isoLuxContours } from '../../lib/illuminance-field.js';
import { CAMERA_PITCH, CAMERA_YAW, ROOM_WALLS, sameCamera, sanitizeCamera, WALL_HEADING, wrapYaw } from '../../lib/room-3d.js';
import { intersectRayWithWall } from '../../lib/room-raycast.js';
import {
  cameraFrame,
  cameraFromPosition,
  cameraPosition,
  headingDelta,
  orbitLimits,
  sunDirection,
  wallCull,
} from '../../lib/room-scene.js';
import { wallDirToRoom, wallToRoom } from '../../lib/room-walls.js';
import {
  compassReadout,
  elevationCamera,
  EYE_HEIGHT_CM,
  facingWall,
  headingTurn,
  LOOK_PITCH,
  lookDirection,
  normalizeHeading,
  sanitizeInsideFov,
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
const FLOOR_LUX_LIFT = 0.004;
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

const WALK_KEYS = ['x', 'y', 'z', 'heading', 'pitch', 'fov'];
const LOOK_KEYS = new Set(['heading', 'pitch']);

/**
 * Inside-room lens: the observer stands at the walk stance with the eye at
 * 165 cm. Every wall plane faces the eye, so no section cut hides anything.
 * A pointer drag turns the head (the world follows the pointer) and writes
 * straight to the camera; the turn is committed once, on release. The wheel
 * swings the field of view the same way, committed after a short pause. A
 * stance change from keys, step buttons or wall tabs glides in on a spring.
 */
function WalkRig({ room, walk, insideFov, api }) {
  const lens = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const events = useThree((state) => state.events);
  const gl = useThree((state) => state.gl);
  const goal = useRef(walk);
  goal.current = walk;
  const roomRef = useRef(room);
  roomRef.current = room;
  const aspect = size.width / Math.max(1, size.height);
  const aspectRef = useRef(aspect);
  aspectRef.current = aspect;
  // The live lens: the wheel writes here between commits. `committed` is the
  // last value this rig handed up, so the echo of its own commit is told apart
  // from a new value set elsewhere (keys, reset), which replaces the live one.
  const fovLens = useRef({ fov: insideFov, committed: insideFov, timer: 0 });
  const pose = useRef(null);
  const velocity = useRef(Object.fromEntries(WALK_KEYS.map((key) => [key, 0])));
  const look = useRef(null);

  const target = useCallback((p) => {
    const g = goal.current;
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

  useFrame((_, delta) => {
    const p = pose.current;
    if (!p) return;
    const dt = Math.min(Math.max(delta, 0), MAX_FRAME_DT);
    const looking = look.current?.moved ? LOOK_KEYS : null;
    const done = settleSpring(p, velocity.current, target(p), WALK_KEYS, 0.05, dt, looking);
    apply(p);
    if (!done) invalidate();
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
        mirror.dataset.headingDeg = String(heading);
        mirror.dataset.pitchDeg = String(Math.round(p.pitch * 10) / 10);
        mirror.dataset.facingWall = facingWall({ ...goal.current, headingDeg: heading }, roomRef.current);
      }
      invalidate();
    };
    const onUp = (event) => {
      const l = look.current;
      if (!l || event.pointerId !== l.id) return;
      look.current = null;
      if (!l.moved) return;
      api.setOrbiting(false);
      api.commitWalk({ headingDeg: pose.current.heading, pitchDeg: pose.current.pitch });
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
  }, [events.connected, gl, api, invalidate]);

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

/** True when the hit sits under a group the section cut has hidden. */
function culled(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return true;
  return false;
}

/* Scene parts */

function Shell({ shell, onBackground }) {
  return (
    <group onClick={onBackground}>
      {shell.surfaces.map((surface) => (
        <mesh key={surface.id} position={surface.position} rotation={surface.rotation} receiveShadow name={`surface-${surface.id}`}>
          <planeGeometry args={surface.size} />
          <meshStandardMaterial
            color={surface.color}
            emissive={surface.glow ?? '#000000'}
            emissiveIntensity={surface.glow ? 1 : 0}
            roughness={0.92}
            metalness={0}
          />
        </mesh>
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

/** Baseboards and, at eye level only, the ceiling. */
function Envelope({ envelope, showCeiling, onBackground }) {
  const { ceiling } = envelope;
  return (
    <group>
      {showCeiling && (
        <mesh position={ceiling.position} rotation={ceiling.rotation} onClick={onBackground} name="surface-ceiling">
          <planeGeometry args={ceiling.size} />
          <meshStandardMaterial
            color={ceiling.color}
            emissive={ceiling.glow ?? '#000000'}
            emissiveIntensity={ceiling.glow ? 1 : 0}
            roughness={0.95}
            metalness={0}
          />
        </mesh>
      )}
      {envelope.baseboards.map((board) => (
        <Cullable key={board.id} cull={board.cull}>
          <mesh position={board.position} raycast={noRaycast} receiveShadow>
            <boxGeometry args={board.size} />
            <meshStandardMaterial color={board.color} roughness={0.7} />
          </mesh>
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
        <mesh position={module.position} rotation={module.rotation} castShadow={!wire} receiveShadow>
          {module.geometry === 'cylinder' ? (
            <cylinderGeometry args={[module.radius, module.radius, module.size[1], 32]} />
          ) : (
            <boxGeometry args={module.size} />
          )}
          <meshStandardMaterial
            key={wire ? 'glass' : 'solid'}
            color={module.color}
            roughness={module.roughness}
            metalness={module.metalness}
            {...glass(wire)}
          />
          <BoxEdges edges={edges} ink={ink} selected={module.selected} conflict={module.conflict} />
        </mesh>
        {module.felt && (
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
      </Cullable>
      {module.lights.map((light) => (
        <ModuleLight key={light.id} light={light} />
      ))}
    </group>
  );
}

function FurnitureMesh({ part, wire, edges, ink }) {
  return (
    <mesh position={part.position} castShadow={!wire} receiveShadow name={`furniture-${part.part}`}>
      <boxGeometry args={part.size} />
      <meshStandardMaterial key={wire ? 'glass' : 'solid'} color={part.color} roughness={0.88} {...glass(wire)} />
      <BoxEdges edges={edges} ink={ink} selected={false} conflict={false} />
    </mesh>
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

      <Shell shell={scene.shell} onBackground={onBackground} />
      <Envelope envelope={scene.envelope} showCeiling={cameraMode === 'inside'} onBackground={onBackground} />
      <Segments points={scene.planks} color={scene.rig.plank.color} opacity={scene.rig.plank.opacity} />
      <Segments points={scene.grid} color={scene.rig.grid.color} opacity={scene.technical ? 0.16 : scene.rig.grid.opacity} />
      <Segments points={scene.scaleTicks} color={scene.rig.trim.color} opacity={0.55} />
      <Segments points={scene.trim} color={scene.rig.trim.color} opacity={scene.rig.trim.opacity} />
      <Creases creases={scene.envelope.creases} color={scene.rig.crease.color} opacity={scene.rig.crease.opacity} />
      {floorLux && <FloorLuxLayer field={floorLux} />}

      {scene.furniture.map((part) => (
        <FurnitureMesh key={part.part} part={part} wire={wire} edges={scene.edges} ink={ink} />
      ))}
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
      <SceneGraph
        scene={scene}
        floorLux={floorLux}
        heading={WALL_HEADING[wall] ?? 0}
        cameraMode={cameraMode}
        drag={drag}
        onSelect={onSelect}
        onHover={onHover}
      />
      <ScreenProbe modules={scene.modules} manifestRef={manifestRef} />
      <DragBridge drag={drag} room={room} />
      <OverlayProbe drag={drag} api={api} room={room} cameraMode={cameraMode} manifestRef={manifestRef} />
      <SnapshotBridge captureRef={captureRef} />
    </Canvas>
  );
}
