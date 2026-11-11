import { useId, useLayoutEffect, useRef, useState } from 'react';
import { getFinish, getProduct } from '../../data/products.js';
import { formatInt } from '../../lib/format.js';
import { rgbTriplet } from '../../lib/photometry.js';
import {
  anchorPoints,
  boundsOf,
  clampGroupDelta,
  computeSmartGuides,
  itemRect,
  modulesInRect,
  PX_PER_CM,
  SLOPE_CM,
  snapStep,
  snapToWall,
} from '../../lib/wall-studio.js';
import { LuxHeatmap } from './LuxHeatmap.jsx';

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

function longestLeg(segments, order) {
  let best = null;
  let bestLen = 0;
  for (const s of segments) {
    if (s.order !== order) continue;
    const len = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
    if (len > bestLen) {
      best = s;
      bestLen = len;
    }
  }
  return best;
}

function BusOverlay({ topology, wall, ppcm }) {
  const { origin, nodes, segments } = topology;
  const H = wall.heightCm;
  return (
    <div
      className="wall-bus"
      data-testid="bus-topology-overlay"
      data-tone={topology.withinSpec ? 'ok' : 'fault'}
      data-nodes={nodes.length}
      data-run-m={topology.totalRunM}
      data-current-a={topology.currentA}
      data-drop-v={topology.voltageDropV}
      data-drop-pct={topology.voltageDropPct}
      data-within-spec={String(topology.withinSpec)}
      aria-hidden="true"
    >
      <svg
        className="wall-bus__paths"
        viewBox={`0 0 ${wall.widthCm} ${H}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        {segments.map((s, i) => (
          <line
            key={`${s.toUid}-${i}`}
            className="wall-bus__segment"
            data-testid="bus-segment"
            data-order={s.order}
            data-to-uid={s.toUid}
            x1={s.x1}
            y1={H - s.y1}
            x2={s.x2}
            y2={H - s.y2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <span
        className="wall-bus__origin"
        data-testid="bus-psu-origin"
        data-kind={origin.kind}
        style={{ left: origin.xCm * ppcm, bottom: origin.yCm * ppcm }}
      >
        <span className="wall-bus__origin-label mono">PSU 24V FEED</span>
      </span>

      {nodes.map((node) => {
        const leg = longestLeg(segments, node.order);
        return (
          <div key={node.uid} className="wall-bus__hop">
            <span
              className="wall-bus__node"
              data-testid="bus-node"
              data-uid={node.uid}
              data-order={node.order}
              style={{ left: node.xCm * ppcm, bottom: node.yCm * ppcm }}
            >
              <span className="wall-bus__node-label mono">{node.label}</span>
            </span>
            {leg && (
              <span
                className="wall-bus__callout mono"
                data-testid="bus-run-callout"
                data-order={node.order}
                data-axis={leg.y1 === leg.y2 ? 'h' : 'v'}
                style={{ left: ((leg.x1 + leg.x2) / 2) * ppcm, bottom: ((leg.y1 + leg.y2) / 2) * ppcm }}
              >
                {node.hopM.toFixed(2)} m
              </span>
            )}
          </div>
        );
      })}

      <p className="wall-bus__legend mono" data-testid="bus-overlay-legend">
        <span>24V DC / {topology.conductor} Cu</span>
        <span>
          {topology.totalRunM.toFixed(2)} m / {topology.voltageDropPct.toFixed(1)}% drop
        </span>
      </p>
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

const GUIDE_LABELS = { 'wall-centre': 'CL', 'eye-level': 'EYE', module: 'ALN' };
const TICK_PX = 4;

function SmartGuides({ guides, wall, ppcm }) {
  const W = wall.widthCm * ppcm;
  const H = wall.heightCm * ppcm;
  return (
    <svg
      className="wall-smart"
      data-testid="smart-alignment-guides"
      data-count={guides.length}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      focusable="false"
    >
      {guides.map((g) => {
        const vertical = g.axis === 'x';
        const at = vertical ? g.at * ppcm : H - g.at * ppcm;
        const a = vertical ? H - g.to * ppcm : g.from * ppcm;
        const b = vertical ? H - g.from * ppcm : g.to * ppcm;
        const line = vertical ? { x1: at, x2: at, y1: a, y2: b } : { x1: a, x2: b, y1: at, y2: at };
        const tick = (p) =>
          vertical
            ? { x1: at - TICK_PX, x2: at + TICK_PX, y1: p, y2: p }
            : { x1: p, x2: p, y1: at - TICK_PX, y2: at + TICK_PX };
        const label = `${GUIDE_LABELS[g.kind]} ${g.at} / ${g.delta === 0 ? '0' : Math.abs(g.delta)} cm`;
        const labelAt = vertical ? { x: at + 5, y: Math.max(12, a + 12) } : { x: Math.max(4, a + 4), y: at - 5 };
        return (
          <g
            key={`${g.axis}-${g.at}`}
            className="wall-smart__guide"
            data-testid="smart-guide"
            data-axis={g.axis}
            data-kind={g.kind}
            data-edge={g.edge}
            data-at={g.at}
            data-delta={g.delta}
            data-exact={g.delta === 0 || undefined}
          >
            <line className="wall-smart__line" {...line} />
            <line className="wall-smart__tick" {...tick(a)} />
            <line className="wall-smart__tick" {...tick(b)} />
            <text className="wall-smart__label" {...labelAt}>
              {label}
            </text>
          </g>
        );
      })}
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
  selectedUids = selectedUid ? [selectedUid] : [],
  dragUid,
  dragUids = dragUid ? [dragUid] : [],
  technical,
  busTopology,
  luxMap,
  toolbar,
  onSelect,
  onToggleSelect,
  onSelectMany,
  onSelectAll,
  onDragPreview,
  onDragCommit,
  onGroupCommit,
  onNudge,
  onRemove,
}) {
  const { wall, items } = layout;
  const hostRef = useRef(null);
  const cursorRef = useRef(null);
  const dragRef = useRef(null);
  const marqueeRef = useRef(null);
  const marqueeBoxRef = useRef(null);
  const probeRef = useRef(null);
  const reticleRef = useRef(null);
  const pointerCmRef = useRef(null);
  const ppcm = useFitScale(hostRef, wall);

  // Written to the DOM directly: the probe tracks the pointer at display rate.
  const writeProbe = (probe, at) => {
    const readout = probeRef.current;
    const reticle = reticleRef.current;
    if (!readout) return;
    const lux = probe && at ? probe(at.x, at.y) : null;
    if (lux === null) {
      readout.textContent = readout.dataset.dark ? 'No lit modules / probe --' : 'Probe --';
      delete readout.dataset.lux;
      delete readout.dataset.xCm;
      delete readout.dataset.yCm;
      if (reticle) reticle.dataset.on = 'false';
      return;
    }
    readout.textContent = `Probe ${formatInt(lux)} lx @ X ${at.x} / Y ${at.y}`;
    readout.dataset.lux = String(lux);
    readout.dataset.xCm = String(at.x);
    readout.dataset.yCm = String(at.y);
    if (reticle) {
      reticle.dataset.on = 'true';
      reticle.style.left = `${at.x * ppcm}px`;
      reticle.style.bottom = `${at.y * ppcm}px`;
    }
  };

  const luxProbe = luxMap?.probe ?? null;
  useLayoutEffect(() => {
    if (luxProbe) writeProbe(luxProbe, pointerCmRef.current);
  });
  const wallW = Math.round(wall.widthCm * ppcm);
  const wallH = Math.round(wall.heightCm * ppcm);
  const active = items.find((item) => item.uid === (dragUid ?? selectedUid)) ?? null;
  const conflictCount = conflicts.size;
  const selectedSet = new Set(selectedUids);
  const draggingSet = new Set(dragUids);
  const multi = selectedUids.length > 1;
  const multiBox = multi ? boundsOf(items.filter((item) => selectedSet.has(item.uid)).map(itemRect)) : null;
  const smartGuides = dragUids.length > 0 ? computeSmartGuides(wall, items, dragUids) : [];

  // A single module snaps its own position to the grid; a group snaps the
  // shared translation, so the members keep their relative offsets.
  const resolveDrag = (drag) => {
    const dxPx = drag.lastX - drag.startX;
    const dyPx = drag.lastY - drag.startY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return null;
    drag.moved = true;
    if (!drag.group) {
      const spot = snapToWall(drag.product, drag.wall, drag.originX + dxPx / drag.ppcm, drag.originY - dyPx / drag.ppcm);
      return { spots: new Map([[drag.uid, spot]]), dx: spot.xCm - drag.originX, dy: spot.yCm - drag.originY };
    }
    const step = snapStep(drag.wall);
    const quantize = (cm) => Math.round(cm / step) * step;
    const { dx, dy } = clampGroupDelta(
      drag.wall,
      drag.members.map((m) => m.rect),
      quantize(dxPx / drag.ppcm),
      quantize(-dyPx / drag.ppcm),
    );
    const spots = new Map(drag.members.map((m) => [m.uid, { xCm: m.rect.x + dx, yCm: m.rect.y + dy }]));
    return { spots, dx, dy };
  };

  const flushDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.frame = 0;
    const result = resolveDrag(drag);
    if (result) onDragPreview({ uid: drag.uid, spots: result.spots });
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
    const result = commit ? resolveDrag(drag) : null;
    onDragPreview(null);
    if (!result) {
      // A plain click on a member of a multi-selection narrows it to that module.
      if (commit && drag.group) onSelect(drag.uid);
      return;
    }
    if (result.dx === 0 && result.dy === 0) return;
    if (drag.group) onGroupCommit(drag.members.map((m) => m.uid), result.dx, result.dy);
    else onDragCommit(drag.uid, drag.originX + result.dx, drag.originY + result.dy);
  };

  const itemHandlers = (item, product) => ({
    onPointerDown: (event) => {
      if (event.button !== 0 || dragRef.current || marqueeRef.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      if (event.shiftKey) {
        onToggleSelect(item.uid);
        return;
      }
      const group = multi && selectedSet.has(item.uid);
      if (!group) onSelect(item.uid);
      if (item.locked) return;
      const members = group ? items.filter((entry) => selectedSet.has(entry.uid) && !entry.locked) : [item];
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        uid: item.uid,
        group,
        members: members.map((entry) => ({ uid: entry.uid, rect: itemRect(entry) })),
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
  });

  // One handler for the wall and every module in it. A focused module acts on
  // itself (or on the group it belongs to); the bare wall acts on the selection.
  const onWallKeyDown = (event) => {
    const uid = event.target instanceof HTMLElement && event.target !== event.currentTarget ? event.target.dataset.uid : null;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectAll();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (!uid && selectedUids.length === 0) return;
    const step = snapStep(wall) * (event.shiftKey ? 10 : 1);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[event.key]) {
      event.preventDefault();
      onNudge(uid ?? null, ...moves[event.key]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove(uid ?? null);
    } else if (event.key === 'Escape') {
      onSelect(null);
      event.target.blur();
    }
  };

  const paintMarquee = () => {
    const m = marqueeRef.current;
    const box = marqueeBoxRef.current;
    if (!m || !box) return;
    m.frame = 0;
    box.hidden = !m.moved;
    box.style.left = `${Math.min(m.x0, m.x1)}px`;
    box.style.top = `${Math.min(m.y0, m.y1)}px`;
    box.style.width = `${Math.abs(m.x1 - m.x0)}px`;
    box.style.height = `${Math.abs(m.y1 - m.y0)}px`;
  };

  const onWallPointerDown = (event) => {
    if (event.button !== 0 || dragRef.current || marqueeRef.current) return;
    if (!(event.target instanceof Element) || event.target.closest('[data-testid="wall-module"]')) return;
    event.preventDefault();
    const canvas = event.currentTarget;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    marqueeRef.current = {
      pointerId: event.pointerId,
      originLeft: rect.left,
      originTop: rect.top,
      heightPx: rect.height,
      x0: x,
      y0: y,
      x1: x,
      y1: y,
      additive: event.shiftKey,
      moved: false,
      frame: 0,
    };
  };

  const endMarquee = (event, commit) => {
    const m = marqueeRef.current;
    if (!m || m.pointerId !== event.pointerId) return;
    marqueeRef.current = null;
    cancelAnimationFrame(m.frame);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (marqueeBoxRef.current) marqueeBoxRef.current.hidden = true;
    if (!commit) return;
    if (!m.moved) {
      if (!m.additive) onSelect(null);
      return;
    }
    const rect = {
      x: Math.min(m.x0, m.x1) / ppcm,
      y: (m.heightPx - Math.max(m.y0, m.y1)) / ppcm,
      w: Math.abs(m.x1 - m.x0) / ppcm,
      h: Math.abs(m.y1 - m.y0) / ppcm,
    };
    onSelectMany(modulesInRect(items, rect), m.additive);
  };

  const onWallPointerMove = (event) => {
    const m = marqueeRef.current;
    if (m && m.pointerId === event.pointerId) {
      m.x1 = Math.min(Math.max(event.clientX - m.originLeft, 0), wallW);
      m.y1 = Math.min(Math.max(event.clientY - m.originTop, 0), wallH);
      if (!m.moved && Math.hypot(m.x1 - m.x0, m.y1 - m.y0) >= DRAG_THRESHOLD_PX) m.moved = true;
      if (m.moved && !m.frame) m.frame = requestAnimationFrame(paintMarquee);
    }
    const readout = cursorRef.current;
    if (!readout) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round((event.clientX - rect.left) / ppcm);
    const y = Math.round((rect.bottom - event.clientY) / ppcm);
    readout.textContent = `Cursor X ${x} / Y ${y} cm`;
    pointerCmRef.current = { x, y };
    if (luxProbe) writeProbe(luxProbe, pointerCmRef.current);
  };

  const onWallPointerLeave = () => {
    if (cursorRef.current) cursorRef.current.textContent = 'Cursor --';
    pointerCmRef.current = null;
    if (luxProbe) writeProbe(luxProbe, null);
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
              data-slope={wall.slope}
              data-ppcm={ppcm}
              data-lux-map={luxMap ? true : undefined}
              data-selection={selectedUids.length || undefined}
              tabIndex={-1}
              style={{ width: wallW, height: wallH, '--ppcm': ppcm }}
              onPointerDown={onWallPointerDown}
              onPointerMove={onWallPointerMove}
              onPointerUp={(event) => endMarquee(event, true)}
              onPointerCancel={(event) => endMarquee(event, false)}
              onPointerLeave={onWallPointerLeave}
              onKeyDown={onWallKeyDown}
            >
              <LightLayer items={items} ppcm={ppcm} />
              {wall.slope && <Slope ppcm={ppcm} />}
              {luxMap && (
                <LuxHeatmap field={luxMap.field} wall={wall} ppcm={ppcm} probeRef={probeRef} reticleRef={reticleRef} />
              )}

              {items.length === 0 && (
                <p className="wall__empty">
                  Select a component or a preset to mount it on the wall. Drag to place, arrow keys to nudge.
                </p>
              )}

              {items.map((item) => {
                const product = getProduct(item.productId);
                const finish = getFinish(item.finish);
                const conflict = conflicts.get(item.uid);
                const selected = selectedSet.has(item.uid);
                const dragging = draggingSet.has(item.uid);
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
                    {item.uid === dragUid && (
                      <span className="wall-module__readout mono" data-testid="drag-readout" aria-hidden="true">
                        X {item.xCm} / Y {item.yCm}
                      </span>
                    )}
                  </button>
                );
              })}

              {busTopology && <BusOverlay topology={busTopology} wall={wall} ppcm={ppcm} />}

              {technical && (
                <Guides items={items} active={active} wall={wall} ppcm={ppcm} showTags={ppcm >= MIN_TAG_PPCM} />
              )}

              {smartGuides.length > 0 && <SmartGuides guides={smartGuides} wall={wall} ppcm={ppcm} />}

              <span
                ref={marqueeBoxRef}
                className="wall-marquee"
                data-testid="marquee-selection-box"
                aria-hidden="true"
                hidden
              />

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
          {multiBox
            ? `${selectedUids.length} modules / X ${multiBox.x} cm / Y ${multiBox.y} cm / ${multiBox.w} x ${multiBox.h} cm`
            : active
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
