import { useCallback } from 'react';
import { getProduct } from '../../data/products.js';
import { AXIS_LOCK_LABELS, liveDimensions } from '../../lib/room-raycast.js';
import { roomWall, WALL_LABELS, wallOf } from '../../lib/room-3d.js';

const KEY_STEPS = Object.freeze({
  x: { ArrowLeft: [-1, 0], ArrowRight: [1, 0] },
  y: { ArrowUp: [0, 1], ArrowDown: [0, -1] },
  free: { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] },
});

const HANDLES = Object.freeze([
  { lock: 'x', testId: 'gizmo-axis-x', className: 'room3d-gizmo__axis room3d-gizmo__axis--x', tag: 'X' },
  { lock: 'y', testId: 'gizmo-axis-y', className: 'room3d-gizmo__axis room3d-gizmo__axis--y', tag: 'Y' },
  { lock: 'free', testId: 'gizmo-axis-xy', className: 'room3d-gizmo__plane', tag: null },
]);

function handleLabel(lock, wallLabel) {
  if (lock === 'x') return `X axis: slide along the ${wallLabel}`;
  if (lock === 'y') return 'Y axis: raise or lower on the wall';
  return 'XY plane: move freely on the wall';
}

/**
 * Blender-style move gizmo over the WebGL stage: an X arrow along the wall,
 * a Y arrow up it and a planar square between them, plus laser dimensions to
 * the floor, both corners and the ceiling. React renders the markup once per
 * selection; the canvas projects it every frame and the drag controller
 * writes the live figures, both straight to the DOM.
 */
export function TransformGizmo({ drag, item, room, axisLock }) {
  const wall = wallOf(item);
  const wallLabel = WALL_LABELS[wall];
  const { w, h } = getProduct(item.productId).dimsCm;
  const surface = roomWall(room, wall);
  const dims = liveDimensions({
    item: { ...item, wCm: w, hCm: h },
    wallSpanCm: surface.widthCm,
    wallHeightCm: surface.heightCm,
  });

  const gizmoRef = useCallback(
    (el) => {
      drag.refs.gizmo = el;
    },
    [drag],
  );
  const dimsRef = useCallback(
    (el) => {
      drag.refs.dims = el;
    },
    [drag],
  );

  const onPointerDown = (lock) => (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const started = drag.beginPointer({
      source: 'gizmo',
      lock,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    });
    if (!started) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onKeyDown = (lock) => (event) => {
    const steps = KEY_STEPS[lock][event.key];
    if (!steps) return;
    event.preventDefault();
    event.stopPropagation();
    drag.nudgeCommit(steps[0], steps[1]);
  };

  return (
    <>
      <div
        ref={dimsRef}
        className="room3d-dims"
        data-testid="room-live-dimensions"
        data-uid={item.uid}
        data-floor-cm={dims.floorCm}
        data-left-cm={dims.leftCm}
        data-right-cm={dims.rightCm}
        data-ceiling-cm={dims.ceilingCm}
        data-projected="false"
        aria-hidden="true"
      >
        <svg className="room3d-dims__lines" focusable="false">
          <line data-line="floor" visibility="hidden" />
          <line data-line="left" visibility="hidden" />
          <line data-line="right" visibility="hidden" />
          <line data-line="ceiling" visibility="hidden" />
        </svg>
        <span className="room3d-dims__label mono" data-dim="floor">{`Y: ${dims.floorCm} cm`}</span>
        <span className="room3d-dims__label mono" data-dim="left">{`X: ${dims.leftCm} cm`}</span>
        <span className="room3d-dims__label mono" data-dim="right">{`R: ${dims.rightCm} cm`}</span>
        <span className="room3d-dims__label mono" data-dim="ceiling">{`C: ${dims.ceilingCm} cm`}</span>
      </div>

      <div
        ref={gizmoRef}
        className="room3d-gizmo"
        data-testid="room-transform-gizmo"
        data-module-uid={item.uid}
        data-wall={wall}
        data-x-cm={item.xCm}
        data-y-cm={item.yCm}
        data-axis-lock={axisLock}
        data-projected="false"
        title={`Move on the ${wallLabel}. ${AXIS_LOCK_LABELS[axisLock]}. Press G to grab with the keyboard.`}
      >
        <span className="room3d-gizmo__origin" aria-hidden="true" />
        {HANDLES.map((handle) => (
          <button
            key={handle.testId}
            type="button"
            className={handle.className}
            data-testid={handle.testId}
            data-lock={handle.lock}
            aria-label={handleLabel(handle.lock, wallLabel)}
            title={handleLabel(handle.lock, wallLabel)}
            onPointerDown={onPointerDown(handle.lock)}
            onKeyDown={onKeyDown(handle.lock)}
          >
            {handle.tag && (
              <>
                <span className="room3d-gizmo__shaft" aria-hidden="true" />
                <span className="room3d-gizmo__head" aria-hidden="true" />
                <span className="room3d-gizmo__tag mono" aria-hidden="true">
                  {handle.tag}
                </span>
              </>
            )}
          </button>
        ))}
      </div>
    </>
  );
}
