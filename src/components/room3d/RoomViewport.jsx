import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getProduct } from '../../data/products.js';
import {
  activePreset,
  CAMERA_PITCH,
  CAMERA_YAW,
  CAMERA_ZOOM,
  DEFAULT_CAMERA,
  sameCamera,
  sanitizeCamera,
} from '../../lib/room-3d.js';
import { buildScene, labelWidth } from '../../lib/room-scene.js';
import { frameDelta, stepSpring } from '../../lib/spring.js';

const FALLBACK_SIZE = { w: 960, h: 600 };
const DRAG_THRESHOLD_PX = 4;
const YAW_PER_PX = 0.3;
const PITCH_PER_PX = 0.22;
const WHEEL_ZOOM_RATE = 0.0012;
const WHEEL_COMMIT_MS = 220;
const KEY_YAW = 5;
const KEY_PITCH = 4;
const KEY_ZOOM = 0.1;

// Critically damped (c = 2 sqrt(k)): presets glide in without overshoot and
// settle in about 0.4 s at any refresh rate.
const CAMERA_SPRING = { stiffness: 140, damping: 2 * Math.sqrt(140) };

function clamp(value, range) {
  return Math.min(range.max, Math.max(range.min, value));
}

function useElementSize(ref) {
  const [size, setSize] = useState(FALLBACK_SIZE);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const measure = () => {
      const w = Math.round(host.clientWidth);
      const h = Math.round(host.clientHeight);
      if (w > 0 && h > 0) setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Gradient({ id, patch }) {
  const color = `rgb(${patch.color})`;
  const stops = (
    <>
      <stop offset="0" stopColor={color} stopOpacity={patch.peak} />
      <stop offset="0.38" stopColor={color} stopOpacity={patch.peak * 0.42} />
      <stop offset="1" stopColor={color} stopOpacity="0" />
    </>
  );
  if (patch.type === 'linear') {
    return (
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={patch.x1} y1={patch.y1} x2={patch.x2} y2={patch.y2}>
        {stops}
      </linearGradient>
    );
  }
  return (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={patch.cx} cy={patch.cy} r={patch.r}>
      {stops}
    </radialGradient>
  );
}

function Line({ line, className }) {
  return <line className={className} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />;
}

function Label({ x, y, text, className, testId }) {
  const width = labelWidth(text);
  return (
    <g className={className} data-testid={testId}>
      <rect x={x - width / 2} y={y - 8} width={width} height={16} rx="1" />
      <text x={x} y={y + 3.5} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

function TechnicalOverlay({ technical, solids }) {
  return (
    <g className="room3d-tech" data-testid="room-technical-overlay">
      <g className="room3d-tech__room">
        {technical.roomEdges.map((edge) => (
          <Line key={edge.key} line={edge} />
        ))}
      </g>
      <g className="room3d-tech__edges">
        {solids.map((solid) =>
          solid.edges.map((edge, i) => (
            <Line key={`${solid.key}-${i}`} line={edge} className={edge.hidden ? 'is-hidden' : undefined} />
          )),
        )}
      </g>
      {technical.axes.map((axis) => (
        <g key={axis.id} className={`room3d-axis room3d-axis--${axis.id}`}>
          <Line line={axis.line} />
          {axis.ticks.map((tick) => (
            <Line key={tick.key} line={tick} />
          ))}
          <Label x={axis.lx} y={axis.ly} text={axis.label} className="room3d-axis__label" testId="axis-label" />
        </g>
      ))}
      {technical.tags.map((tag) => (
        <Label key={tag.uid} x={tag.lx} y={tag.ly} text={tag.sku} className="room3d-tag" testId="room-sku-tag" />
      ))}
      {technical.callouts.map((callout) => (
        <g
          key={callout.id}
          className="room3d-callout"
          data-testid="clearance-callout"
          data-callout={callout.id}
          data-tone={callout.tone}
          data-value-cm={callout.valueCm}
        >
          <Line line={callout} />
          {callout.ticks.map((tick, i) => (
            <Line key={i} line={tick} />
          ))}
          <Label x={callout.lx} y={callout.ly} text={callout.label} className="room3d-callout__label" />
        </g>
      ))}
    </g>
  );
}

function Scene({ scene, gradientPrefix }) {
  return (
    <>
      <defs>
        {scene.patches.map((patch) => (
          <Gradient key={patch.key} id={`${gradientPrefix}-${patch.key}`} patch={patch} />
        ))}
      </defs>

      <g className="room3d-shell">
        {scene.shell.map((polygon) => (
          <polygon
            key={polygon.key}
            points={polygon.points}
            fill={polygon.fill}
            data-surface={polygon.surface ?? undefined}
          />
        ))}
      </g>

      <g className="room3d-grid">
        {scene.grid.map((line) => (
          <Line key={line.key} line={line} />
        ))}
      </g>

      <g className="room3d-shadows">
        {scene.shadows.map((shadow) => (
          <polygon key={shadow.key} points={shadow.points} fill={shadow.fill} />
        ))}
      </g>

      <g className="room3d-light">
        {scene.patches.map((patch) => (
          <polygon
            key={patch.key}
            points={patch.points}
            fill={`url(#${gradientPrefix}-${patch.key})`}
            data-testid="light-patch"
            data-uid={patch.uid}
          />
        ))}
      </g>

      <g className="room3d-solids">
        {scene.solids.map((solid) =>
          solid.kind === 'module' ? (
            <g
              key={solid.key}
              className="room3d-module"
              data-testid="room-module"
              data-uid={solid.uid}
              data-product={solid.product.id}
              data-finish={solid.item.finish}
              data-x-cm={solid.item.xCm}
              data-y-cm={solid.item.yCm}
              data-dims={`${solid.product.dimsCm.w}x${solid.product.dimsCm.h}x${solid.product.dimsCm.d}`}
              data-led={solid.product.watts > 0 ? String(solid.item.led) : 'none'}
              data-faces={solid.faces.length}
            >
              {solid.faces.map((face) => (
                <polygon key={face.key} points={face.points} fill={face.fill} />
              ))}
              {solid.details.map((detail) => (
                <polygon
                  key={detail.key}
                  className={`room3d-detail room3d-detail--${detail.kind}`}
                  data-lit={detail.lit || undefined}
                  points={detail.points}
                  fill={detail.fill}
                />
              ))}
            </g>
          ) : (
            <g key={solid.key} className="room3d-furniture" data-testid="room-furniture" data-part={solid.part}>
              {solid.faces.map((face) => (
                <polygon key={face.key} points={face.points} fill={face.fill} />
              ))}
            </g>
          ),
        )}
      </g>

      {scene.conflicts.map((conflict) => (
        <g key={conflict.uid} className="room3d-conflict" data-testid="room-conflict" data-uid={conflict.uid}>
          {conflict.faces.map((face) => (
            <polygon key={face.key} points={face.points} />
          ))}
        </g>
      ))}

      {scene.selection && (
        <g className="room3d-selection" data-testid="room-selection">
          {scene.selection.map((face) => (
            <polygon key={face.key} points={face.points} />
          ))}
        </g>
      )}

      {scene.technical && <TechnicalOverlay technical={scene.technical} solids={scene.solids} />}
    </>
  );
}

export function RoomViewport({ state, conflicts, selectedUid, technical, toolbar, onSelect, onCameraCommit }) {
  const { room, items, camera } = state;
  const hostRef = useRef(null);
  const size = useElementSize(hostRef);
  const gradientPrefix = `${useId().replace(/[^A-Za-z0-9_-]/g, '')}-light`;

  const [view, setView] = useState(camera);
  const viewRef = useRef(camera);
  const animRef = useRef(0);
  const gliding = useRef(false);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const commitRef = useRef(onCameraCommit);
  commitRef.current = onCameraCommit;

  const showView = (next) => {
    viewRef.current = next;
    setView(next);
  };

  const commitView = () => {
    const committed = sanitizeCamera(viewRef.current);
    showView(committed);
    commitRef.current(committed);
  };

  // A committed camera that differs from the view (preset, reset, reload)
  // glides in on a spring; the echo of our own drag commit is already shown.
  useEffect(() => {
    const target = camera;
    if (sameCamera(target, viewRef.current)) return undefined;
    if (prefersReducedMotion()) {
      showView(target);
      return undefined;
    }

    const s = { ...viewRef.current, vYaw: 0, vPitch: 0, vZoom: 0 };
    let last = performance.now();
    const { stiffness, damping } = CAMERA_SPRING;
    const step = (now) => {
      const dt = frameDelta(now, last);
      last = now;
      [s.yaw, s.vYaw] = stepSpring(s.yaw, s.vYaw, target.yaw, dt, stiffness, damping);
      [s.pitch, s.vPitch] = stepSpring(s.pitch, s.vPitch, target.pitch, dt, stiffness, damping);
      [s.zoom, s.vZoom] = stepSpring(s.zoom, s.vZoom, target.zoom, dt, stiffness, damping);
      const settled =
        Math.abs(s.yaw - target.yaw) < 0.05 &&
        Math.abs(s.pitch - target.pitch) < 0.05 &&
        Math.abs(s.zoom - target.zoom) < 0.002;
      if (settled) {
        gliding.current = false;
        showView(target);
        return;
      }
      showView({ yaw: s.yaw, pitch: s.pitch, zoom: s.zoom });
      animRef.current = requestAnimationFrame(step);
    };
    gliding.current = true;
    animRef.current = requestAnimationFrame(step);
    return () => {
      gliding.current = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [camera]);

  const stopGlide = () => {
    gliding.current = false;
    cancelAnimationFrame(animRef.current);
  };

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  // At either zoom limit the event passes through and the page scrolls.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let timer = 0;
    const onWheel = (event) => {
      const current = viewRef.current;
      const zoom = clamp(current.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE), CAMERA_ZOOM);
      if (Math.abs(zoom - current.zoom) < 1e-4) return;
      event.preventDefault();
      stopGlide();
      showView({ ...current, zoom });
      clearTimeout(timer);
      timer = setTimeout(commitView, WHEEL_COMMIT_MS);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('wheel', onWheel);
      clearTimeout(timer);
    };
  }, []);

  const scene = useMemo(
    () => buildScene({ state, camera: view, viewport: size, conflicts, selectedUid, technical }),
    [state, view, size, conflicts, selectedUid, technical],
  );

  const flushDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    const pointers = [...pointersRef.current.values()];
    if (drag.pinch && pointers.length >= 2) {
      const distance = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
      const zoom = clamp(drag.pinch.zoom * (distance / drag.pinch.distance), CAMERA_ZOOM);
      showView({ ...viewRef.current, zoom });
      return;
    }
    const dx = drag.lastX - drag.startX;
    const dy = drag.lastY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    showView({
      yaw: clamp(drag.origin.yaw - dx * YAW_PER_PX, CAMERA_YAW),
      pitch: clamp(drag.origin.pitch + dy * PITCH_PER_PX, CAMERA_PITCH),
      zoom: drag.origin.zoom,
    });
  };

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const pointers = pointersRef.current;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    stopGlide();

    if (pointers.size === 1) {
      const hit = event.target instanceof Element ? event.target.closest('[data-uid]') : null;
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        origin: viewRef.current,
        uid: hit?.getAttribute('data-uid') ?? null,
        moved: false,
        pinch: null,
        frame: 0,
      };
    } else if (pointers.size === 2 && dragRef.current) {
      const [a, b] = [...pointers.values()];
      dragRef.current.moved = true;
      dragRef.current.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: viewRef.current.zoom };
    }
  };

  const onPointerMove = (event) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.pinch) {
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
    }
    if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag);
  };

  const endPointer = (event, cancelled) => {
    const pointers = pointersRef.current;
    if (!pointers.delete(event.pointerId)) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    if (!drag || pointers.size > 0) return;
    dragRef.current = null;
    cancelAnimationFrame(drag.frame);
    if (!drag.pinch) {
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      dragRef.current = drag;
      flushDrag();
      dragRef.current = null;
    }
    if (drag.moved) commitView();
    else if (!cancelled) onSelect(drag.uid);
  };

  const onKeyDown = (event) => {
    // Mid-glide, a key steps from where the camera is heading, not from the
    // in-between frame, so repeated presses land on whole steps.
    const current = gliding.current ? camera : sanitizeCamera(viewRef.current);
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
  const polygons =
    scene.shell.length +
    scene.patches.length +
    scene.solids.reduce((sum, solid) => sum + solid.faces.length + solid.details.length, 0);

  return (
    <section className="workspace-frame room3d-stage" aria-label="Room viewport">
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

      {toolbar}

      <div className="workspace-frame__viewport room3d-stage__viewport">
        <div
          ref={hostRef}
          className="room3d-stage__canvas"
          data-testid="room-viewport"
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
          role="application"
          aria-roledescription="3D viewport"
          aria-label="Room viewport. Drag or use the arrow keys to orbit, plus and minus to zoom, Home to reset."
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => endPointer(event, false)}
          onPointerCancel={(event) => endPointer(event, true)}
          onKeyDown={onKeyDown}
        >
          <svg
            className="room3d-canvas"
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            aria-hidden="true"
            focusable="false"
            data-testid="room-canvas"
          >
            <Scene scene={scene} gradientPrefix={gradientPrefix} />
          </svg>

          {items.length === 0 && (
            <p className="room3d-stage__empty mono">
              Empty wall. Mount a component, or load the composition from the 2D Wall Studio.
            </p>
          )}
        </div>

        <span className="workspace-frame__corner workspace-frame__corner--tl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--tr" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--bl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--br" aria-hidden="true" />
      </div>

      <div className="workspace-frame__bar workspace-frame__bar--bottom studio-stage__readouts mono">
        <span data-testid="camera-readout">
          Yaw {view.yaw.toFixed(1)} / Pitch {view.pitch.toFixed(1)} / Zoom {view.zoom.toFixed(2)}x
        </span>
        <span data-testid="room-item-readout">
          {selected
            ? `${getProduct(selected.productId).name} / X ${selected.xCm} / Y ${selected.yCm} cm`
            : 'No module selected'}
        </span>
        <span className="tech-only" data-testid="room-polygons">
          {polygons} polys
        </span>
      </div>
    </section>
  );
}
