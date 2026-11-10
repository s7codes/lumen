import { useId, useLayoutEffect, useRef, useState } from 'react';
import { getFinish, getProduct } from '../../data/products.js';
import { rgbTriplet } from '../../lib/photometry.js';
import { anchorPoints, PX_PER_CM, SLOPE_CM, snapStep, snapToWall } from '../../lib/wall-studio.js';

const RULER_PX = 36;
const FLOOR_OVERHANG_PX = 12;
const DRAG_THRESHOLD_PX = 3;
const MIN_TAG_PPCM = 1.5;

/**
 * Pixels per cm for the viewport: the 2.5 px/cm drawing scale, reduced only
 * as far as needed for the whole wall to fit the stage width and a height
 * budget derived from the window.
 */
function useFitScale(hostRef, wall) {
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const measure = () => {
      const w = host.clientWidth;
      const h = window.innerHeight;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [hostRef]);

  const availW = Math.max(120, box.w - RULER_PX - FLOOR_OVERHANG_PX);
  const availH = Math.min(Math.max(box.h * 0.62, 260), 820);
  const fit = Math.min(PX_PER_CM, availW / wall.widthCm, availH / wall.heightCm);
  return Math.floor(fit * 1000) / 1000;
}

function ticks(lengthCm, ppcm) {
  const major = ppcm >= 1.6 ? 50 : 100;
  const list = [];
  for (let cm = 0; cm <= lengthCm; cm += 10) {
    const isMajor = cm % major === 0;
    if (!isMajor && ppcm * 10 < 6) continue;
    list.push({ cm, major: isMajor });
  }
  return list;
}

function Rulers({ wall, ppcm }) {
  return (
    <>
      <span className="wall-grid__origin mono" aria-hidden="true">
        cm
      </span>
      <div className="wall-ruler wall-ruler--x mono" aria-hidden="true">
        {ticks(wall.widthCm, ppcm).map((tick) => (
          <span
            key={tick.cm}
            className="wall-ruler__tick"
            data-major={tick.major || undefined}
            style={{ left: tick.cm * ppcm }}
          >
            {tick.major && <span className="wall-ruler__label">{tick.cm}</span>}
          </span>
        ))}
      </div>
      <div className="wall-ruler wall-ruler--y mono" aria-hidden="true">
        {ticks(wall.heightCm, ppcm).map((tick) => (
          <span
            key={tick.cm}
            className="wall-ruler__tick"
            data-major={tick.major || undefined}
            style={{ bottom: tick.cm * ppcm }}
          >
            {tick.major && <span className="wall-ruler__label">{tick.cm}</span>}
          </span>
        ))}
      </div>
    </>
  );
}

function boxStyle(item, product, ppcm) {
  return {
    left: item.xCm * ppcm,
    bottom: item.yCm * ppcm,
    width: product.dimsCm.w * ppcm,
    height: product.dimsCm.h * ppcm,
  };
}

function LightLayer({ items, ppcm }) {
  return (
    <div className="wall__light" aria-hidden="true">
      {items.map((item) => {
        const product = getProduct(item.productId);
        if (!item.led || product.watts === 0) return null;
        return (
          <span
            key={item.uid}
            className="wall-glow"
            data-shape={product.shape}
            style={{ ...boxStyle(item, product, ppcm), '--light-rgb': rgbTriplet(product.kelvin) }}
          />
        );
      })}
    </div>
  );
}

function Guides({ items, active, wall, ppcm, showTags }) {
  return (
    <div className="wall__guides" aria-hidden="true" data-testid="technical-overlay">
      {items.map((item) => {
        const product = getProduct(item.productId);
        const isActive = item.uid === active?.uid;
        return (
          <div key={item.uid} className="wall-tech" data-active={isActive || undefined}>
            {(showTags || isActive) && (
              <span
                className="wall-tech__sku mono"
                data-testid="sku-tag"
                style={{ left: item.xCm * ppcm, bottom: (item.yCm + product.dimsCm.h) * ppcm }}
              >
                {product.sku}
              </span>
            )}
            {anchorPoints(item).map((point, i) => (
              <span
                key={`${point.xCm}-${point.yCm}`}
                className="wall-tech__anchor"
                style={{ left: point.xCm * ppcm, bottom: point.yCm * ppcm }}
              >
                {isActive && <span className="wall-tech__anchor-index mono">{i + 1}</span>}
              </span>
            ))}
          </div>
        );
      })}

      {active && <ActiveGuides item={active} wall={wall} ppcm={ppcm} />}
    </div>
  );
}

function ActiveGuides({ item, wall, ppcm }) {
  const { w, h } = getProduct(item.productId).dimsCm;
  const midY = (item.yCm + h / 2) * ppcm;
  const midX = (item.xCm + w / 2) * ppcm;
  const onRight = item.xCm + w / 2 > wall.widthCm / 2;
  const calloutX = onRight ? { right: (wall.widthCm - item.xCm) * ppcm + 10 } : { left: (item.xCm + w) * ppcm + 10 };
  const calloutY = Math.min((item.yCm + h) * ppcm, (wall.heightCm - 8) * ppcm);
  return (
    <div data-testid="dimension-guides">
      <dl className="wall-tech__callout mono" style={{ ...calloutX, bottom: calloutY }}>
        {anchorPoints(item).map((point, i) => (
          <div key={`${point.xCm}-${point.yCm}`} className="wall-tech__callout-row" data-testid="anchor-label">
            <dt>A{i + 1}</dt>
            <dd>
              {point.xCm}, {point.yCm}
            </dd>
          </div>
        ))}
      </dl>
      <span className="wall-guide wall-guide--h" style={{ left: 0, width: item.xCm * ppcm, bottom: midY }}>
        <span className="wall-guide__label mono">{item.xCm}</span>
      </span>
      <span className="wall-guide wall-guide--v" style={{ bottom: 0, height: item.yCm * ppcm, left: midX }}>
        <span className="wall-guide__label mono">{item.yCm}</span>
      </span>
      <span
        className="wall-guide wall-guide--dim-w"
        style={{ left: item.xCm * ppcm, width: w * ppcm, bottom: item.yCm * ppcm - 10 }}
      >
        <span className="wall-guide__label mono">{w}</span>
      </span>
      <span
        className="wall-guide wall-guide--dim-h"
        style={{ left: (item.xCm + w) * ppcm + 8, height: h * ppcm, bottom: item.yCm * ppcm }}
      >
        <span className="wall-guide__label mono">{h}</span>
      </span>
    </div>
  );
}

function Slope({ ppcm }) {
  const hatchId = `${useId().replace(/[^A-Za-z0-9_-]/g, '')}-hatch`;
  const size = SLOPE_CM * ppcm;
  const points = `0,0 ${SLOPE_CM},0 ${SLOPE_CM},${SLOPE_CM}`;
  return (
    <svg
      className="wall__slope"
      data-testid="attic-slope"
      viewBox={`0 0 ${SLOPE_CM} ${SLOPE_CM}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="wall__slope-hatch" x1="0" y1="0" x2="0" y2="5" />
        </pattern>
      </defs>
      <polygon className="wall__slope-fill" points={points} />
      <polygon points={points} fill={`url(#${hatchId})`} />
      <line className="wall__slope-edge" x1="0" y1="0" x2={SLOPE_CM} y2={SLOPE_CM} />
      <text className="wall__slope-label" x={SLOPE_CM - 3} y="9" textAnchor="end">
        Slope {SLOPE_CM} x {SLOPE_CM}
      </text>
    </svg>
  );
}

function describeConflict(conflict) {
  if (!conflict) return '';
  if (conflict.bounds) return ', exceeds wall';
  const parts = [];
  if (conflict.slope) parts.push('cuts attic slope');
  if (conflict.overlaps.length > 0) parts.push('overlaps');
  return parts.length ? `, conflict: ${parts.join(' and ')}` : '';
}

export function WallStage({
  layout,
  conflicts,
  selectedUid,
  dragUid,
  technical,
  toolbar,
  onSelect,
  onDragPreview,
  onDragCommit,
  onNudge,
  onRemove,
}) {
  const { wall, items } = layout;
  const hostRef = useRef(null);
  const cursorRef = useRef(null);
  const dragRef = useRef(null);
  const ppcm = useFitScale(hostRef, wall);
  const wallW = Math.round(wall.widthCm * ppcm);
  const wallH = Math.round(wall.heightCm * ppcm);
  const active = items.find((item) => item.uid === (dragUid ?? selectedUid)) ?? null;
  const conflictCount = conflicts.size;

  const resolveDrag = (drag) => {
    const dx = drag.lastX - drag.startX;
    const dy = drag.lastY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return null;
    drag.moved = true;
    return snapToWall(drag.product, drag.wall, drag.originX + dx / drag.ppcm, drag.originY - dy / drag.ppcm);
  };

  const flushDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    const spot = resolveDrag(drag);
    if (spot) onDragPreview({ uid: drag.uid, ...spot });
  };

  const endDrag = (event, commit) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    cancelAnimationFrame(drag.frame);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const spot = commit ? resolveDrag(drag) : null;
    onDragPreview(null);
    if (spot && (spot.xCm !== drag.originX || spot.yCm !== drag.originY)) {
      onDragCommit(drag.uid, spot.xCm, spot.yCm);
    }
  };

  const itemHandlers = (item, product) => ({
    onPointerDown: (event) => {
      if (event.button !== 0 || dragRef.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      onSelect(item.uid);
      if (item.locked) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        uid: item.uid,
        pointerId: event.pointerId,
        product,
        wall,
        ppcm,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        originX: item.xCm,
        originY: item.yCm,
        moved: false,
        frame: 0,
      };
    },
    onPointerMove: (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (!drag.frame) drag.frame = requestAnimationFrame(flushDrag);
    },
    onPointerUp: (event) => endDrag(event, true),
    onPointerCancel: (event) => endDrag(event, false),
    onKeyDown: (event) => {
      const step = snapStep(wall) * (event.shiftKey ? 10 : 1);
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[event.key]) {
        event.preventDefault();
        onNudge(item.uid, ...moves[event.key]);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onRemove(item.uid);
      } else if (event.key === 'Escape') {
        onSelect(null);
        event.currentTarget.blur();
      }
    },
  });

  const onWallPointerMove = (event) => {
    const readout = cursorRef.current;
    if (!readout) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) / ppcm);
    const y = Math.round((rect.bottom - event.clientY) / ppcm);
    readout.textContent = `Cursor X ${x} / Y ${y} cm`;
  };

  const onWallPointerLeave = () => {
    if (cursorRef.current) cursorRef.current.textContent = 'Cursor --';
  };

  return (
    <section className="workspace-frame studio-stage" aria-label="Wall elevation" data-active={active ? true : undefined}>
      <div className="workspace-frame__bar mono">
        <span data-testid="wall-label">
          Elevation / Wall A / {wall.widthCm} x {wall.heightCm} cm
        </span>
        <span
          className="workspace-frame__status studio-stage__status"
          data-conflicts={conflictCount > 0 || undefined}
          data-testid="conflict-count"
        >
          {conflictCount} {conflictCount === 1 ? 'conflict' : 'conflicts'}
        </span>
      </div>

      {toolbar}

      <div className="workspace-frame__viewport studio-stage__viewport" data-surface={wall.surface}>
        <div ref={hostRef} className="studio-stage__fit">
          <div
            className="wall-grid"
            style={{ gridTemplateColumns: `${RULER_PX}px ${wallW}px`, gridTemplateRows: `20px ${wallH}px` }}
          >
            <Rulers wall={wall} ppcm={ppcm} />
            <div
              className="wall"
              data-testid="wall-canvas"
              data-surface={wall.surface}
              data-snap={wall.snap || undefined}
              data-width-cm={wall.widthCm}
              data-height-cm={wall.heightCm}
              data-ppcm={ppcm}
              style={{ width: wallW, height: wallH, '--ppcm': ppcm }}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) onSelect(null);
              }}
              onPointerMove={onWallPointerMove}
              onPointerLeave={onWallPointerLeave}
            >
              <LightLayer items={items} ppcm={ppcm} />
              {wall.slope && <Slope ppcm={ppcm} />}

              {items.length === 0 && (
                <p className="wall__empty">
                  Select a component or a preset to mount it on the wall. Drag to place, arrow keys to nudge.
                </p>
              )}

              {items.map((item) => {
                const product = getProduct(item.productId);
                const finish = getFinish(item.finish);
                const conflict = conflicts.get(item.uid);
                const selected = item.uid === selectedUid;
                const dragging = item.uid === dragUid;
                return (
                  <button
                    key={item.uid}
                    type="button"
                    className="wall-module"
                    data-testid="wall-module"
                    data-uid={item.uid}
                    data-product={product.id}
                    data-shape={product.shape}
                    data-texture={finish.texture}
                    data-finish={finish.id}
                    data-x-cm={item.xCm}
                    data-y-cm={item.yCm}
                    data-led={product.watts > 0 ? String(item.led) : 'none'}
                    data-conflict={conflict ? 'true' : 'false'}
                    data-selected={selected || undefined}
                    data-locked={item.locked || undefined}
                    data-dragging={dragging || undefined}
                    aria-pressed={selected}
                    aria-label={`${product.name}, ${finish.label}, X ${item.xCm} cm, Y ${item.yCm} cm${describeConflict(conflict)}${item.locked ? ', locked' : ''}`}
                    style={{
                      ...boxStyle(item, product, ppcm),
                      '--finish-base': finish.hex,
                      '--finish-hi': finish.highlight,
                      '--finish-shade': finish.shade,
                      '--light-rgb': rgbTriplet(product.kelvin ?? 2700),
                    }}
                    {...itemHandlers(item, product)}
                  >
                    <span className="wall-module__detail" aria-hidden="true" />
                    {item.locked && <span className="wall-module__lock" aria-hidden="true" />}
                    {dragging && (
                      <span className="wall-module__readout mono" data-testid="drag-readout" aria-hidden="true">
                        X {item.xCm} / Y {item.yCm}
                      </span>
                    )}
                  </button>
                );
              })}

              {technical && (
                <Guides items={items} active={active} wall={wall} ppcm={ppcm} showTags={ppcm >= MIN_TAG_PPCM} />
              )}

              <span className="wall__floor" aria-hidden="true">
                <span className="wall__floor-label mono">FFL 0</span>
              </span>
            </div>
          </div>
        </div>

        <span className="workspace-frame__corner workspace-frame__corner--tl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--tr" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--bl" aria-hidden="true" />
        <span className="workspace-frame__corner workspace-frame__corner--br" aria-hidden="true" />
      </div>

      <div className="workspace-frame__bar workspace-frame__bar--bottom studio-stage__readouts mono">
        <span ref={cursorRef}>Cursor --</span>
        <span data-testid="item-readout">
          {active
            ? `${getProduct(active.productId).name} / X ${active.xCm} cm / Y ${active.yCm} cm`
            : 'No module selected'}
        </span>
        <span data-testid="view-scale">
          1 cm = {PX_PER_CM} px / View {Math.round((ppcm / PX_PER_CM) * 100)}%
        </span>
      </div>
    </section>
  );
}
