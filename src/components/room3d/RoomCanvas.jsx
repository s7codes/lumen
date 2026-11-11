import { Edges, Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  Object3D,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { formatInt } from '../../lib/format.js';
import { fieldImage, isoLuxContours } from '../../lib/illuminance-field.js';
import { CAMERA_PITCH, CAMERA_YAW, sameCamera, sanitizeCamera, WALL_HEADING } from '../../lib/room-3d.js';
import {
  cameraFrame,
  cameraFromPosition,
  cameraPosition,
  headingDelta,
  orbitLimits,
  sunDirection,
} from '../../lib/room-scene.js';
import { MAX_FRAME_DT, stepSpring } from '../../lib/spring.js';

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
const noRaycast = () => null;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * Camera rig: OrbitControls drives the lens; committed yaw / pitch / zoom
 * drive OrbitControls. Yaw is relative to the heading of the wall in view,
 * so switching walls glides the heading and the orbit centre while the
 * relative view stays put.
 */

const GLIDE_KEYS = ['yaw', 'pitch', 'zoom', 'heading', 'tx', 'ty', 'tz'];
const GLIDE_EPSILON = { yaw: 0.05, pitch: 0.05, zoom: 0.002, heading: 0.05, tx: 0.0005, ty: 0.0005, tz: 0.0005 };

/** Azimuth limits around a heading; null frees the azimuth while a glide swings between walls. */
function setAzimuthLimits(controls, heading) {
  if (!controls) return;
  if (heading === null) {
    controls.minAzimuthAngle = -Infinity;
    controls.maxAzimuthAngle = Infinity;
    return;
  }
  const limits = orbitLimits(CAMERA_YAW, CAMERA_PITCH, heading);
  controls.minAzimuthAngle = limits.minAzimuthAngle;
  controls.maxAzimuthAngle = limits.maxAzimuthAngle;
}

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
    setAzimuthLimits(controls, frame.heading);
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
      setAzimuthLimits(controlsRef.current, f.heading);
      place(camera, f);
      return;
    }
    // Unwrap the start heading so the swing takes the short way round.
    const heading = f.heading - headingDelta(at.heading, f.heading);
    const [tx, ty, tz] = at.target;
    glide.current = {
      value: { yaw: from.yaw, pitch: from.pitch, zoom: from.zoom, heading, tx, ty, tz },
      velocity: Object.fromEntries(GLIDE_KEYS.map((key) => [key, 0])),
      view: camera,
    };
    setAzimuthLimits(controlsRef.current, null);
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
      setAzimuthLimits(controlsRef.current, f.heading);
      place(g.view, f);
      return;
    }
    const view = { yaw: g.value.yaw, pitch: g.value.pitch, zoom: g.value.zoom };
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
      minPolarAngle={POLAR_LIMITS.minPolarAngle}
      maxPolarAngle={POLAR_LIMITS.maxPolarAngle}
      onStart={onStart}
      onChange={onChange}
      onEnd={onEnd}
    />
  );
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

/** Hides a wall's poche and modules once the eye crosses its plane, like a section cut. */
function Cullable({ cull, children }) {
  const ref = useRef(null);
  useFrame(({ camera }) => {
    if (!cull || !ref.current) return;
    ref.current.visible = inSection(cull, camera);
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
function ModuleMesh({ module, wire, edges, ink, onSelect, onHover }) {
  const onClick = (event) => {
    if (culled(event.object)) return;
    event.stopPropagation();
    if (event.delta <= DRAG_THRESHOLD_PX) onSelect(module.uid);
  };
  return (
    <group
      name={module.uid}
      onClick={onClick}
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

const SceneGraph = memo(function SceneGraph({ scene, floorLux, heading, onSelect, onHover }) {
  const ink = INK[scene.lighting] ?? INK.night;
  const wire = scene.wireframe;
  const onBackground = (event) => {
    if (event.delta <= DRAG_THRESHOLD_PX) onSelect(null);
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
      <Segments points={scene.grid} color={scene.rig.grid.color} opacity={scene.technical ? 0.16 : scene.rig.grid.opacity} />
      <Segments points={scene.trim} color={scene.rig.trim.color} opacity={scene.rig.trim.opacity} />
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
export default function RoomCanvas({ scene, floorLux, room, wall, camera, api, manifestRef, onSelect, onHover, onReady }) {
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
        if (event.type === 'click') onSelect(null);
      }}
    >
      <CameraRig room={room} wall={wall} camera={camera} api={api} />
      <SceneGraph scene={scene} floorLux={floorLux} heading={WALL_HEADING[wall] ?? 0} onSelect={onSelect} onHover={onHover} />
      <ScreenProbe modules={scene.modules} manifestRef={manifestRef} />
    </Canvas>
  );
}
