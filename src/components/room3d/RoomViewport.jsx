import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getProduct } from '../../data/products.js';
import { activePreset, DEFAULT_CAMERA, sanitizeCamera } from '../../lib/room-3d.js';
import { buildScene } from '../../lib/room-scene.js';
import { CameraSettings } from './CameraSettings.jsx';

const RoomCanvas = lazy(() => import('./RoomCanvas.jsx'));

const KEY_YAW = 5;
const KEY_PITCH = 4;
const KEY_ZOOM = 0.1;

let webglSupport = null;

/** Probed once per page load; a throwaway context is enough to know. */
function hasWebgl() {
  if (webglSupport === null) {
    try {
      const probe = document.createElement('canvas');
      webglSupport = Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
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

/**
 * Hidden mirror of the rendered scene graph: one node per mesh group, light
 * and annotation, carrying the same data the WebGL layer draws. It keeps the
 * scene inspectable without reading pixels, and it is the whole viewport
 * when WebGL is unavailable.
 */
function SceneManifest({ scene, floorLux, renderer, manifestRef }) {
  const selected = scene.modules.find((module) => module.selected);
  return (
    <div
      hidden
      ref={manifestRef}
      data-testid="room-scene-graph"
      data-renderer={renderer}
      data-meshes={scene.stats.meshes}
      data-lights={scene.stats.lights}
    >
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
          data-dims={module.dims}
          data-led={module.led}
          data-lit={module.lit || undefined}
          data-dim-pct={module.dimPct}
          data-emissive={module.emitters[0]?.intensity ?? 0}
        />
      ))}
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

export function RoomViewport({
  state,
  conflicts,
  selectedUid,
  technical,
  wireframe,
  floorLux,
  toolbar,
  onSelect,
  onCameraCommit,
  onWireframe,
  onFloorLux,
}) {
  const { room, items, camera } = state;
  const hostRef = useRef(null);
  const manifestRef = useRef(null);
  const [supported] = useState(hasWebgl);
  const [renderer, setRenderer] = useState(supported ? 'loading' : 'unavailable');
  const [view, setView] = useState(camera);
  const [orbiting, setOrbiting] = useState(false);
  const viewRef = useRef(camera);
  const liveRef = useRef(false);
  const commitRef = useRef(onCameraCommit);
  commitRef.current = onCameraCommit;

  const api = useMemo(() => {
    const showView = (next) => {
      viewRef.current = next;
      setView(next);
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
    };
  }, []);

  // Without a live canvas there is no glide: the readout follows the commit.
  useEffect(() => {
    if (!liveRef.current) api.showView(camera);
  }, [camera, api]);

  const scene = useMemo(
    () => buildScene({ state, conflicts, selectedUid, technical, wireframe }),
    [state, conflicts, selectedUid, technical, wireframe],
  );

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

  const onKeyDown = (event) => {
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
    if (moves[event.key]) {
      event.preventDefault();
      commitRef.current(sanitizeCamera({ ...current, ...moves[event.key] }));
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      commitRef.current(DEFAULT_CAMERA);
    } else if (event.key === 'Escape') {
      onSelect(null);
    }
  };

  const selected = items.find((item) => item.uid === selectedUid) ?? null;
  const conflictCount = conflicts.size;
  const preset = activePreset(camera);

  return (
    <section
      className="workspace-frame room3d-stage"
      aria-label="Room viewport"
      data-active={selected ? true : undefined}
      data-orbiting={orbiting || undefined}
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
          className="room3d-stage__canvas"
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
          data-preset={preset ?? 'custom'}
          data-technical={technical || undefined}
          data-wireframe={wireframe || undefined}
          data-floor-lux={floorLux ? true : undefined}
          role="application"
          aria-roledescription="3D viewport"
          aria-label="Room viewport. Drag or use the arrow keys to orbit, scroll, plus and minus to zoom, Home to reset."
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
        >
          {supported ? (
            <CanvasBoundary fallback={UNAVAILABLE} onFail={onFail}>
              <Suspense fallback={<RendererNotice testId="room-webgl-loading">Loading WebGL engine</RendererNotice>}>
                <RoomCanvas
                  scene={scene}
                  floorLux={floorLux}
                  room={room}
                  camera={camera}
                  api={api}
                  manifestRef={manifestRef}
                  onSelect={onSelect}
                  onHover={onHover}
                  onReady={onReady}
                />
              </Suspense>
            </CanvasBoundary>
          ) : (
            UNAVAILABLE
          )}

          <SceneManifest scene={scene} floorLux={floorLux} renderer={renderer} manifestRef={manifestRef} />

          {items.length === 0 && (
            <p className="room3d-stage__empty mono">
              Empty wall. Mount a component, or load the composition from the 2D Wall Studio.
            </p>
          )}
        </div>

        <div className="room3d-hud">
          {toolbar}
          <CameraSettings
            camera={camera}
            view={view}
            wireframe={wireframe}
            floorLux={Boolean(floorLux)}
            onCamera={onCameraCommit}
            onWireframe={onWireframe}
            onFloorLux={onFloorLux}
          />
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
            : 'No module selected'}
        </span>
        <span className="tech-only" data-testid="room-polygons">
          {scene.stats.meshes} meshes / {scene.stats.lights} lights
        </span>
      </div>
    </section>
  );
}
