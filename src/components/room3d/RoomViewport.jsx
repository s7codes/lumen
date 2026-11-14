import { Component, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getProduct } from '../../data/products.js';
import {
  activePreset,
  DEFAULT_CAMERA,
  ROOM_WALLS,
  sanitizeCamera,
  WALL_HEADING,
  WALL_LABELS,
} from '../../lib/room-3d.js';
import { setText } from '../../lib/dom-writes.js';
import { iblTier } from '../../lib/pbr-materials.js';
import { buildScene, cameraFrame, cameraPosition, wallCull } from '../../lib/room-scene.js';
import {
  CAMERA_MODE_LABELS,
  elevationCamera,
  EYE_HEIGHT_CM,
  facingWall,
  INSIDE_FOV_STEP_DEG,
  normalizeHeading,
  sanitizeInsideFov,
  TURN_STEP_DEG,
  WALK_KEYS,
  walkKey,
  WALL_LOOK_HEADING,
} from '../../lib/room-walkthrough.js';
import { CameraSettings, formatCameraReadout } from './CameraSettings.jsx';
import { TransformGizmo } from './TransformGizmo.jsx';
import { ViewportCompass } from './ViewportCompass.jsx';
import { WalkControls } from './WalkControls.jsx';

const RoomCanvas = lazy(() => import('./RoomCanvas.jsx'));

const KEY_YAW = 5;
const KEY_PITCH = 4;
const KEY_ZOOM = 0.1;

const GRAB_STEPS = Object.freeze({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] });
// Plus narrows the inside lens (a closer look), minus widens it.
const LENS_KEYS = Object.freeze({ '+': -1, '=': -1, '-': 1, _: 1 });

let webglProbe = null;

/**
 * Probed once per page load; a throwaway context is enough to know whether
 * WebGL is there and which quality tier its renderer belongs to. The tier is
 * needed before the real context exists, because multisampling is fixed when
 * a context is created: a software rasteriser (SwiftShader, llvmpipe, WARP)
 * would pay for every MSAA sample on the CPU, so it renders without.
 */
function probeWebgl() {
  if (webglProbe === null) {
    try {
      const probe = document.createElement('canvas');
      const ctx = probe.getContext('webgl2') ?? probe.getContext('webgl');
      if (!ctx) {
        webglProbe = { supported: false, tier: 'studio' };
      } else {
        const plain = String(ctx.getParameter(ctx.RENDERER) ?? '');
        const debug = plain && !/^webkit webgl$/i.test(plain) ? null : ctx.getExtension('WEBGL_debug_renderer_info');
        const name = debug ? String(ctx.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? plain) : plain;
        webglProbe = { supported: true, tier: iblTier(name) };
      }
    } catch {
      webglProbe = { supported: false, tier: 'studio' };
    }
  }
  return webglProbe;
}

function hasWebgl() {
  return probeWebgl().supported;
}

class CanvasBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function RendererNotice({ children, testId }) {
  return (
    <div className="room3d-stage__fallback mono" data-testid={testId}>
      {children}
    </div>
  );
}

const UNAVAILABLE = (
  <RendererNotice testId="room-webgl-fallback">
    WebGL unavailable on this device. Scene state, inspector and the 2D bridge stay live; the render resumes on a
    WebGL 2 capable browser.
  </RendererNotice>
);

function inSectionAt(cull, eye) {
  const value = eye[cull.axis];
  return cull.below !== undefined ? value > cull.below : value < cull.above;
}

/**
 * Which wall planes face the eye for the committed view, so the mirror reads
 * right without a canvas. With WebGL the canvas overwrites it every frame.
 */
function staticWallVisibility(room, activeWall, camera, cameraMode) {
  if (cameraMode === 'inside') return Object.fromEntries(ROOM_WALLS.map((wall) => [wall, true]));
  const eye =
    cameraMode === 'elevation'
      ? elevationCamera(room, activeWall).position.map((c) => c * 0.01)
      : cameraPosition(cameraFrame(room, 1.6, activeWall), camera);
  return Object.fromEntries(ROOM_WALLS.map((wall) => [wall, inSectionAt(wallCull(room, wall), eye)]));
}

/**
 * Hidden mirror of the rendered scene graph: one node per mesh group, light
 * and annotation, carrying the same data the WebGL layer draws, plus the
 * camera lens, the walk stance and which planes are in view. It keeps the
 * scene inspectable without reading pixels, and it is the whole viewport
 * when WebGL is unavailable.
 */
function SceneManifest({
  scene,
  floorLux,
  renderer,
  heading,
  manifestRef,
  walls,
  cameraMode,
  walk,
  insideFov,
  facing,
  eyeLux,
  walkRef,
}) {
  const selected = scene.modules.find((module) => module.selected);
  const { solar, windows, window: daylightWindow, furniturePlacement: placement, furnitureVignette: vignette } = scene;
  const lightPatches = (source) => windows.reduce((sum, win) => sum + win.patches.filter((patch) => patch.light === source).length, 0);
  return (
    <div
      hidden
      ref={manifestRef}
      data-testid="room-scene-graph"
      data-renderer={renderer}
      data-meshes={scene.stats.meshes}
      data-lights={scene.stats.lights}
      data-submeshes={scene.stats.submeshes}
      data-volumetrics={scene.stats.volumetrics}
      data-heading={heading}
      data-walls={scene.shell.surfaces.filter((surface) => surface.wall).length}
      data-solar-hour={solar.hour}
      data-sun-azimuth={solar.azimuthDeg}
      data-sun-elevation={solar.elevationDeg}
      data-sun-kelvin={solar.kelvin}
      data-sun-direction={scene.rig.sun.fixed ? scene.rig.sun.from.join(' ') : undefined}
      data-window-wall={daylightWindow?.wall ?? 'none'}
      data-window-walls={windows.length > 0 ? windows.map((win) => win.wall).join(' ') : 'none'}
      data-window-count={windows.length}
      data-sunlit={windows.some((win) => win.sunlit) || undefined}
      data-sun-patches={lightPatches('sun')}
      data-sky-patches={lightPatches('sky')}
      data-moon-patches={lightPatches('moon')}
      data-portal-lights={windows.filter((win) => win.portalLight).length}
    >
      {windows.map((win) => (
        <span
          key={win.id}
          data-testid="room-window"
          data-wall={win.wall}
          data-glazing-color={win.glazing.color}
          data-glazing-base={win.glazing.base}
          data-glazing-intensity={win.glazing.intensity}
          data-members={win.members.length}
          data-handles={win.members.filter((member) => member.kind === 'handle').length}
          data-light={win.light}
          data-sunlit={win.sunlit || undefined}
          data-skylit={win.skylit || undefined}
          data-moonlit={win.moonlit || undefined}
          data-patches={win.patches.length}
          data-shafts={win.shafts.length}
          data-portal-source={win.portalLight?.source}
          data-portal-intensity={win.portalLight?.intensity}
          data-portal-color={win.portalLight?.color}
        />
      ))}
      {scene.modules.map((module) => (
        <span
          key={module.uid}
          data-testid="room-module"
          data-uid={module.uid}
          data-product={module.productId}
          data-finish={module.finish}
          data-color={module.color}
          data-geometry={module.geometry}
          data-x-cm={module.xCm}
          data-y-cm={module.yCm}
          data-wall={module.wall}
          data-world={module.position.join(' ')}
          data-rot-y={module.rotation[1].toFixed(4)}
          data-dims={module.dims}
          data-led={module.led}
          data-lit={module.lit || undefined}
          data-dim-pct={module.dimPct}
          data-emissive={module.emitters[0]?.intensity ?? 0}
          data-subparts={module.subparts.length}
          data-volumetrics={module.volumetrics.length}
          data-beam-opacity={module.volumetrics[0]?.opacity ?? 0}
        />
      ))}
      {placement && (
        <span
          data-testid="room-furniture-placement"
          data-wall={placement.wall}
          data-offset-cm={placement.offsetCm}
          data-bounds={[placement.bounds.x0, placement.bounds.x1, placement.bounds.z0, placement.bounds.z1].join(' ')}
        />
      )}
      {scene.lights.map((light) => (
        <span
          key={`${light.uid}-${light.id}`}
          data-testid="room-light"
          data-uid={light.uid}
          data-type={light.type}
          data-color={light.color}
          data-intensity={light.intensity}
        />
      ))}
      {scene.furniture.map((part) => (
        <span key={part.part} data-testid="room-furniture" data-part={part.part} data-color={part.color} />
      ))}
      {vignette && (
        <span
          data-testid="room-furniture-vignette"
          data-parts={vignette.parts.length}
          data-kinds={[...new Set(vignette.parts.map((part) => part.kind))].join(' ')}
        />
      )}
      {ROOM_WALLS.map((wall) => (
        <span key={wall} data-testid="room-wall" data-wall={wall} data-visible={walls[wall]} />
      ))}
      <span data-testid="room-ceiling" data-visible={cameraMode === 'inside'} />
      {scene.envelope.baseboards.map((board) => (
        <span key={board.id} data-testid="room-baseboard" data-wall={board.wall} data-height-cm={Math.round(board.size[1] * 100)} />
      ))}
      <span
        ref={walkRef}
        data-testid="room-walkthrough-state"
        data-camera-mode={cameraMode}
        data-x-cm={Math.round(walk.xCm)}
        data-z-cm={Math.round(walk.zCm)}
        data-eye-cm={EYE_HEIGHT_CM}
        data-heading-deg={walk.headingDeg}
        data-pitch-deg={walk.pitchDeg}
        data-fov-deg={insideFov}
        data-facing-wall={facing}
        data-eye-lux={eyeLux}
      />
      {floorLux && (
        <span
          data-testid="room-floor-lux"
          data-peak-lux={floorLux.peakLux}
          data-avg-lux={floorLux.avgLux}
          data-min-lux={floorLux.minLux}
          data-uniformity={floorLux.uniformityRatio.toFixed(2)}
          data-ambient-lux={floorLux.ambientLux}
          data-direct-peak-lux={floorLux.directPeakLux}
          data-cols={floorLux.cols}
          data-rows={floorLux.rows}
          data-sources={floorLux.sources}
          data-hotspot-x={floorLux.hotspot?.xCm}
          data-hotspot-y={floorLux.hotspot?.yCm}
          data-iso={floorLux.isoLux.map((level) => `${level.lux}:${level.areaPct}`).join(' ')}
        />
      )}
      {selected && <span data-testid="room-selection" data-uid={selected.uid} />}
      {scene.modules
        .filter((module) => module.conflict)
        .map((module) => (
          <span key={module.uid} data-testid="room-conflict" data-uid={module.uid} />
        ))}
      {scene.wireframe && <span data-testid="room-wireframe" data-edges={scene.modules.length + scene.furniture.length} />}
      {scene.technical && (
        <div data-testid="room-technical-overlay" data-edges={scene.modules.length + scene.furniture.length}>
          {scene.axes.map((axis) => (
            <span key={axis.id} data-testid="axis-label" data-axis={axis.id}>
              {axis.label}
            </span>
          ))}
          {scene.tags.map((tag) => (
            <span key={tag.uid} data-testid="room-sku-tag" data-uid={tag.uid}>
              {tag.sku}
            </span>
          ))}
          {scene.callouts.map((callout) => (
            <span
              key={callout.id}
              data-testid="clearance-callout"
              data-callout={callout.id}
              data-tone={callout.tone}
              data-value-cm={callout.valueCm}
            >
              {callout.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function lensReadout(cameraMode, walk, insideFov, eyeLux, activeWall, facing) {
  if (cameraMode === 'inside') {
    return `Eye ${EYE_HEIGHT_CM} cm / FOV ${Math.round(insideFov)} / X ${Math.round(walk.xCm)} Z ${Math.round(walk.zCm)} / ${WALL_LABELS[facing]} / ${eyeLux} lx`;
  }
  if (cameraMode === 'elevation') return `${CAMERA_MODE_LABELS.elevation} / ${WALL_LABELS[activeWall]}`;
  return CAMERA_MODE_LABELS.orbit;
}

export function RoomViewport({
  state,
  activeWall,
  counts,
  conflicts,
  selectedUid,
  technical,
  wireframe,
  floorLux,
  toolbar,
  cameraMode,
  walk,
  insideFov,
  eyeLux,
  drag,
  axisLock,
  onSelect,
  onCameraCommit,
  onWireframe,
  onFloorLux,
  onWall,
  onCameraMode,
  onWalkStep,
  onWalkTurn,
  onWalkReset,
  onWalkLook,
  onInsideFov,
  onEngineReady,
  onReplayBoot,
  captureRef,
}) {
  const { room, items, camera } = state;
  const hostRef = useRef(null);
  const manifestRef = useRef(null);
  const [supported] = useState(hasWebgl);
  const [renderer, setRenderer] = useState(supported ? 'loading' : 'unavailable');
  const [orbiting, setOrbiting] = useState(false);
  const viewRef = useRef(camera);
  const liveRef = useRef(false);
  const commitRef = useRef(onCameraCommit);
  commitRef.current = onCameraCommit;
  const lookRef = useRef(onWalkLook);
  lookRef.current = onWalkLook;
  const fovRef = useRef(onInsideFov);
  fovRef.current = onInsideFov;

  const api = useMemo(() => {
    const hud = { compass: null, readout: null };
    // The live lens of a glide or an orbit drag goes straight to the readout's
    // text node, never through React state: motion re-renders nothing.
    const showView = (next) => {
      viewRef.current = next;
      setText(hud.readout, formatCameraReadout(next));
    };
    return {
      viewRef,
      gliding: { current: false },
      pointerDown: { current: false },
      showView,
      setOrbiting,
      commit: (next) => {
        showView(next);
        commitRef.current(next);
      },
      drag,
      hud,
      walkMirror: { current: null },
      // Walk keys held down right now. WalkRig reads them every frame and
      // drives the stance while any is held; `rig` says one is mounted,
      // `engaged` that a hold has taken over from the tap stride.
      heldKeys: new Set(),
      locomotion: { run: false, rig: false, engaged: false, wake: null },
      commitWalk: (patch) => lookRef.current(patch),
      commitFov: (deg) => fovRef.current(sanitizeInsideFov(deg)),
    };
  }, [drag]);

  const readoutRef = useCallback(
    (el) => {
      api.hud.readout = el;
    },
    [api],
  );

  const stageRef = useCallback(
    (el) => {
      drag.refs.stage = el;
    },
    [drag],
  );

  useLayoutEffect(() => {
    drag.refs.manifest = manifestRef.current;
  }, [drag]);

  // A lens change or a lost selection drops whatever is in hand.
  useEffect(() => {
    drag.end(false);
  }, [cameraMode, drag]);

  // The page owns the full-screen engine boot; it only needs to hear when the renderer settles.
  useEffect(() => {
    if (renderer !== 'loading') onEngineReady?.(renderer);
  }, [renderer, onEngineReady]);

  // Without a live canvas there is no glide: the readout follows the commit.
  useEffect(() => {
    if (!liveRef.current) api.showView(camera);
  }, [camera, api]);

  const scene = useMemo(
    () => buildScene({ state, conflicts, selectedUid, technical, wireframe }),
    [state, conflicts, selectedUid, technical, wireframe],
  );

  const walls = useMemo(
    () => staticWallVisibility(room, activeWall, camera, cameraMode),
    [room, activeWall, camera, cameraMode],
  );
  const facing = facingWall(walk, room);

  const onHover = useCallback((on) => {
    const host = hostRef.current;
    if (!host) return;
    if (on) host.dataset.hover = 'true';
    else delete host.dataset.hover;
  }, []);

  const onReady = useCallback((kind) => {
    liveRef.current = true;
    setRenderer(kind);
  }, []);

  const onFail = useCallback(() => {
    liveRef.current = false;
    setRenderer('unavailable');
  }, []);

  const selected = items.find((item) => item.uid === selectedUid) ?? null;

  const onKeyDown = (event) => {
    const { key } = event;
    const lower = key.toLowerCase();
    if (drag.isGrabbing()) {
      if (GRAB_STEPS[key]) {
        event.preventDefault();
        drag.nudge(...GRAB_STEPS[key]);
      } else if (key === 'Enter' || lower === 'g') {
        event.preventDefault();
        drag.end(true);
      } else if (key === 'Escape') {
        event.preventDefault();
        drag.end(false);
      }
      return;
    }
    if (lower === 'g' && selected && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      drag.grab();
      return;
    }
    if (key === 'Escape') {
      onSelect(null);
      return;
    }
    if (cameraMode === 'inside') {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const loco = api.locomotion;
      loco.run = event.shiftKey;
      const walking = walkKey(key);
      if (walking) {
        event.preventDefault();
        // A held key is WalkRig's to drive: the OS repeat burst is ignored.
        // Without a WebGL rig each repeat still steps, as it always did.
        if (event.repeat && loco.rig) return;
        api.heldKeys.add(walking);
        // The first press steps or turns at once, so a tap is exact; once a
        // hold has engaged, further keys join the continuous walk instead.
        if (!loco.engaged) {
          const { forward = 0, strafe = 0, turn = 0 } = WALK_KEYS[walking];
          if (turn !== 0) onWalkTurn(turn * TURN_STEP_DEG);
          else onWalkStep({ forward, strafe });
        }
        loco.wake?.();
      } else if (key === 'Home') {
        event.preventDefault();
        onWalkReset();
      } else if (Object.hasOwn(LENS_KEYS, key)) {
        event.preventDefault();
        onInsideFov(sanitizeInsideFov(insideFov + LENS_KEYS[key] * INSIDE_FOV_STEP_DEG));
      }
      return;
    }
    if (cameraMode !== 'orbit') return;
    // Mid-glide, a key steps from where the camera is heading, not from the
    // in-between frame, so repeated presses land on whole steps.
    const current = api.gliding.current ? camera : sanitizeCamera(viewRef.current);
    const moves = {
      ArrowLeft: { yaw: current.yaw - KEY_YAW },
      ArrowRight: { yaw: current.yaw + KEY_YAW },
      ArrowUp: { pitch: current.pitch + KEY_PITCH },
      ArrowDown: { pitch: current.pitch - KEY_PITCH },
      '+': { zoom: current.zoom + KEY_ZOOM },
      '=': { zoom: current.zoom + KEY_ZOOM },
      '-': { zoom: current.zoom - KEY_ZOOM },
      _: { zoom: current.zoom - KEY_ZOOM },
    };
    if (moves[key]) {
      event.preventDefault();
      commitRef.current(sanitizeCamera({ ...current, ...moves[key] }));
    } else if (key === 'Home' || key === '0') {
      event.preventDefault();
      commitRef.current(DEFAULT_CAMERA);
    }
  };

  // Letting go of the last walk key, or focus leaving the stage, ends a held
  // walk; WalkRig commits where it comes to rest.
  const onKeyUp = (event) => {
    api.locomotion.run = event.shiftKey;
    const walking = walkKey(event.key);
    if (walking && api.heldKeys.delete(walking)) api.locomotion.wake?.();
  };

  const onBlur = () => {
    if (api.heldKeys.size === 0) return;
    api.heldKeys.clear();
    api.locomotion.wake?.();
  };

  const conflictCount = conflicts.size;
  const preset = activePreset(camera);
  const bearing =
    cameraMode === 'inside'
      ? walk.headingDeg
      : cameraMode === 'elevation'
        ? WALL_LOOK_HEADING[activeWall]
        : normalizeHeading(-(WALL_HEADING[activeWall] + camera.yaw));
  const ariaHelp =
    cameraMode === 'inside'
      ? 'Room viewport, inside at 165 cm. Drag to look around, W A S D to walk, Q and E to turn, hold a key to keep moving and Shift to stride, scroll, plus and minus to change the lens, Home to reset.'
      : 'Room viewport. Drag or use the arrow keys to orbit, scroll, plus and minus to zoom, Home to reset. G grabs the selected module.';

  return (
    <section
      ref={stageRef}
      className="workspace-frame room3d-stage"
      aria-label="Room viewport"
      data-active={selected ? true : undefined}
      data-orbiting={orbiting || undefined}
      data-camera-mode={cameraMode}
    >
      <div className="workspace-frame__bar mono">
        <span data-testid="room-label">
          Viewport / Room {room.widthCm} x {room.depthCm} x {room.heightCm} cm
        </span>
        <span
          className="workspace-frame__status studio-stage__status"
          data-conflicts={conflictCount > 0 || undefined}
          data-testid="room-conflict-count"
        >
          {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
        </span>
      </div>

      <div className="workspace-frame__viewport room3d-stage__viewport">
        <div
          ref={hostRef}
          className="room3d-stage__canvas optical"
          data-testid="room-viewport"
          data-renderer={renderer}
          data-lighting={room.lighting}
          data-furniture={room.furniture}
          data-room-width={room.widthCm}
          data-room-depth={room.depthCm}
          data-room-height={room.heightCm}
          data-camera-yaw={camera.yaw}
          data-camera-pitch={camera.pitch}
          data-camera-zoom={camera.zoom}
          data-camera-heading={WALL_HEADING[activeWall]}
          data-camera-mode={cameraMode}
          data-active-wall={activeWall}
          data-preset={preset ?? 'custom'}
          data-technical={technical || undefined}
          data-wireframe={wireframe || undefined}
          data-floor-lux={floorLux ? true : undefined}
          role="application"
          aria-roledescription="3D viewport"
          aria-label={ariaHelp}
          tabIndex={0}
          onPointerDown={() => {
            api.pointerDown.current = true;
          }}
          onPointerUp={() => {
            api.pointerDown.current = false;
          }}
          onPointerCancel={() => {
            api.pointerDown.current = false;
          }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={onBlur}
        >
          {supported ? (
            <CanvasBoundary fallback={UNAVAILABLE} onFail={onFail}>
              <Suspense fallback={<RendererNotice testId="room-webgl-loading">Loading WebGL engine</RendererNotice>}>
                <RoomCanvas
                  scene={scene}
                  floorLux={floorLux}
                  room={room}
                  wall={activeWall}
                  camera={camera}
                  cameraMode={cameraMode}
                  walk={walk}
                  insideFov={insideFov}
                  api={api}
                  drag={drag}
                  manifestRef={manifestRef}
                  captureRef={captureRef}
                  antialias={probeWebgl().tier !== 'software'}
                  onSelect={onSelect}
                  onHover={onHover}
                  onReady={onReady}
                />
              </Suspense>
            </CanvasBoundary>
          ) : (
            UNAVAILABLE
          )}

          <SceneManifest
            scene={scene}
            floorLux={floorLux}
            renderer={renderer}
            heading={WALL_HEADING[activeWall]}
            manifestRef={manifestRef}
            walls={walls}
            cameraMode={cameraMode}
            walk={walk}
            insideFov={insideFov}
            facing={facing}
            eyeLux={eyeLux}
            walkRef={api.walkMirror}
          />

          {selected && <TransformGizmo key={selected.uid} drag={drag} item={selected} room={room} axisLock={axisLock} />}

          {(counts[activeWall] ?? 0) === 0 && cameraMode !== 'inside' && (
            <p className="room3d-stage__empty">
              {items.length === 0
                ? `Empty room. Mount a component on the ${WALL_LABELS[activeWall]}, or load the 2D Wall Studio composition.`
                : `The ${WALL_LABELS[activeWall]} is empty. Mount a component to hang it here.`}
            </p>
          )}
        </div>

        <div className="room3d-hud" data-camera-mode={cameraMode}>
          {toolbar}
          <div className="room3d-hud__aside">
            <CameraSettings
              camera={camera}
              readoutRef={readoutRef}
              wireframe={wireframe}
              floorLux={Boolean(floorLux)}
              onCamera={onCameraCommit}
              onWireframe={onWireframe}
              onFloorLux={onFloorLux}
            />
            <ViewportCompass
              api={api}
              bearing={bearing}
              cameraMode={cameraMode}
              onWall={onWall}
              onIso={() => {
                onCameraMode('orbit');
                onCameraCommit({ yaw: 45, pitch: 35.3, zoom: 0.95 });
              }}
              onEye={() => onCameraMode('inside')}
            />
          </div>
          {cameraMode === 'inside' && <WalkControls onStep={onWalkStep} onTurn={onWalkTurn} onReset={onWalkReset} />}
        </div>

        <span className="workspace-frame__corner workspace-frame__corner--tl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--tr" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--bl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--br" aria-hidden="true" />
      </div>

      <div className="workspace-frame__bar workspace-frame__bar--bottom studio-stage__readouts mono">
        <span data-testid="room-item-readout">
          {selected
            ? `${getProduct(selected.productId).name} / X ${selected.xCm} / Y ${selected.yCm} cm`
            : `Facing the ${WALL_LABELS[cameraMode === 'inside' ? facing : activeWall]}`}
        </span>
        <span className="room3d-stage__lens" data-testid="room-lens-readout">
          {lensReadout(cameraMode, walk, insideFov, eyeLux, activeWall, facing)}
        </span>
        <span
          className="tech-only room3d-stage__telemetry"
          data-testid="room-polygons"
          title="WebGL2 engine telemetry: drawn meshes, CAD sub-parts, volumetric beams and light sources"
        >
          {scene.stats.meshes} meshes / {scene.stats.submeshes} CAD sub-parts / {scene.stats.volumetrics} volumetric beams /{' '}
          {scene.stats.lights} lights
        </span>
        <button
          type="button"
          className="room3d-stage__replay"
          data-testid="replay-studio-boot"
          title="Replay the Lumen Spatial Engine boot sequence"
          onClick={onReplayBoot}
        >
          Replay Engine Boot
        </button>
      </div>
    </section>
  );
}
