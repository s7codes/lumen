import { useEffect, useMemo, useRef } from 'react';
import { getProduct } from '../data/products.js';
import {
  grabOffset,
  liveDimensions,
  nudgeWallPosition,
  sanitizeAxisLock,
  solveWallDragPosition,
} from '../lib/room-raycast.js';
import { setData, setText } from '../lib/dom-writes.js';
import { wallDirToRoom, wallOf, wallSpanCm, wallToRoom } from '../lib/room-walls.js';

const DRAG_THRESHOLD_PX = 4;
const m = (cm) => Number((cm * 0.01).toFixed(4));

/** Wall frame of an item: span, height, size and, for a drag, the other rects on the same wall. */
function frameOf(state, item, withObstacles = true) {
  const { room } = state;
  const wall = wallOf(item);
  const { w, h, d } = getProduct(item.productId).dimsCm;
  if (!withObstacles) return { room, wall, w, h, d, span: wallSpanCm(room, wall), height: room.heightCm, obstacles: [] };
  const obstacles = state.items
    .filter((other) => other.uid !== item.uid && wallOf(other) === wall)
    .map((other) => {
      const dims = getProduct(other.productId).dimsCm;
      return { xCm: other.xCm, yCm: other.yCm, w: dims.w, h: dims.h };
    });
  return { room, wall, w, h, d, span: wallSpanCm(room, wall), height: room.heightCm, obstacles };
}

/** World centre of a module box in metres, the same rounding the scene description uses. */
export function moduleWorld(frame, xCm, yCm) {
  return wallToRoom(frame.room, frame.wall, [xCm + frame.w / 2, yCm + frame.h / 2, frame.d / 2]).map(m);
}

/**
 * Direct manipulation of the selected module on its wall. Pointer moves only
 * store coordinates; one requestAnimationFrame per frame casts the ray, solves
 * the wall position and writes it straight to the 3D group, the gizmo, the
 * laser dimensions and the scene-graph mirror. React state changes once, on
 * release, as one undoable commit.
 *
 * The canvas registers `bridge.rayHit` (screen point to wall hit) and
 * `bridge.onLive` (moves the mesh group); without WebGL only keyboard grab and
 * the nudge keys work.
 */
function createController(propsRef) {
  const refs = { gizmo: null, dims: null, manifest: null, stage: null };
  const bridge = { rayHit: null, onLive: null, hold: null, release: null };
  const groups = new Map();
  let session = null;
  let frame = 0;

  const selectedItem = () => {
    const { state, selectedUid } = propsRef.current;
    return state.items.find((item) => item.uid === selectedUid) ?? null;
  };

  const manifestNode = (uid) =>
    refs.manifest?.querySelector(`[data-testid="room-module"][data-uid="${CSS.escape(uid)}"]`) ?? null;

  function writeLive(s) {
    const { xCm, yCm, collides } = s.live;
    const f = s.frame;
    setData(refs.gizmo, 'xCm', xCm);
    setData(refs.gizmo, 'yCm', yCm);
    setData(refs.gizmo, 'collides', collides);
    const node = manifestNode(s.uid);
    setData(node, 'xCm', xCm);
    setData(node, 'yCm', yCm);
    setData(node, 'world', moduleWorld(f, xCm, yCm).join(' '));
    writeDimensions(f, s.item, xCm, yCm);
    const dx = xCm - s.item.xCm;
    const dy = yCm - s.item.yCm;
    bridge.onLive?.(s.uid, wallDirToRoom(f.wall, [dx, dy, 0]).map((c) => c * 0.01));
  }

  function writeDimensions(f, item, xCm, yCm) {
    const dims = refs.dims;
    if (!dims) return;
    const values = liveDimensions({ item: { ...item, wCm: f.w, hCm: f.h }, xCm, yCm, wallSpanCm: f.span, wallHeightCm: f.height });
    setData(dims, 'floorCm', values.floorCm);
    setData(dims, 'leftCm', values.leftCm);
    setData(dims, 'rightCm', values.rightCm);
    setData(dims, 'ceilingCm', values.ceilingCm);
    setText(dims.querySelector('[data-dim="floor"]'), `Y: ${values.floorCm} cm`);
    setText(dims.querySelector('[data-dim="left"]'), `X: ${values.leftCm} cm`);
    setText(dims.querySelector('[data-dim="right"]'), `R: ${values.rightCm} cm`);
    setText(dims.querySelector('[data-dim="ceiling"]'), `C: ${values.ceilingCm} cm`);
  }

  function markDragging(on) {
    for (const el of [refs.stage, refs.gizmo]) {
      if (!el) continue;
      if (on) el.dataset.dragging = 'true';
      else delete el.dataset.dragging;
    }
  }

  function apply(result) {
    const s = session;
    if (!s) return;
    if (s.live.xCm === result.xCm && s.live.yCm === result.yCm && s.live.collides === result.collides) return;
    s.live = { xCm: result.xCm, yCm: result.yCm, collides: result.collides };
    writeLive(s);
  }

  function process() {
    frame = 0;
    const s = session;
    if (!s?.active || s.source === 'keyboard') return;
    const hit = bridge.rayHit?.(s.x, s.y, s.frame.wall, s.frame.d);
    if (!hit) return;
    const f = s.frame;
    apply(
      solveWallDragPosition({
        hitUCm: hit.uCm,
        hitVCm: hit.vCm,
        ...s.grab,
        item: { ...s.item, wCm: f.w, hCm: f.h },
        wallSpanCm: f.span,
        wallHeightCm: f.height,
        snapCm: propsRef.current.snapCm,
        axisLock: s.lock,
        obstacles: f.obstacles,
      }),
    );
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(process);
  }

  function onMove(event) {
    const s = session;
    if (!s || event.pointerId !== s.pointerId) return;
    s.x = event.clientX;
    s.y = event.clientY;
    if (!s.active) {
      if (Math.hypot(s.x - s.startX, s.y - s.startY) <= DRAG_THRESHOLD_PX) return;
      s.active = true;
      markDragging(true);
    }
    event.preventDefault();
    schedule();
  }

  function onUp(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    if (session.active) process();
    end(event.type === 'pointerup');
  }

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', onMove, { passive: false });
    window[method]('pointerup', onUp);
    window[method]('pointercancel', onUp);
  }

  function start(source, lock, extra) {
    const item = selectedItem();
    if (!item) return false;
    if (session) end(false);
    session = {
      uid: item.uid,
      item,
      frame: frameOf(propsRef.current.state, item),
      source,
      lock: sanitizeAxisLock(lock ?? propsRef.current.axisLock),
      live: { xCm: item.xCm, yCm: item.yCm, collides: false },
      grab: { grabOffsetUCm: 0, grabOffsetVCm: 0 },
      active: false,
      ...extra,
    };
    setData(refs.gizmo, 'axisLock', session.lock);
    return true;
  }

  /** Pointer drag from the module mesh ('mesh', after a 4 px threshold) or a gizmo handle ('gizmo', at once). */
  function beginPointer({ source, lock, clientX, clientY, pointerId }) {
    if (!bridge.rayHit) return false;
    if (!start(source, lock, { pointerId, startX: clientX, startY: clientY, x: clientX, y: clientY })) return false;
    const s = session;
    const hit = bridge.rayHit(clientX, clientY, s.frame.wall, s.frame.d);
    if (!hit) {
      session = null;
      return false;
    }
    s.grab = grabOffset(hit, s.item);
    if (source !== 'mesh') {
      s.active = true;
      markDragging(true);
    }
    bridge.hold?.();
    listen(true);
    return true;
  }

  function end(commit) {
    const s = session;
    if (!s) return;
    session = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (s.source !== 'keyboard') listen(false);
    markDragging(false);
    if (refs.gizmo) delete refs.gizmo.dataset.grab;
    setData(refs.gizmo, 'axisLock', propsRef.current.axisLock);
    const moved = s.live.xCm !== s.item.xCm || s.live.yCm !== s.item.yCm;
    if (s.active && commit && moved) {
      propsRef.current.onCommit(s.uid, { xCm: s.live.xCm, yCm: s.live.yCm }, s.source);
    } else if (moved || s.active) {
      s.live = { xCm: s.item.xCm, yCm: s.item.yCm, collides: false };
      writeLive(s);
      setData(refs.gizmo, 'collides', false);
    }
    bridge.release?.();
  }

  /** Blender-style G: arrows move the module by one snap step, Enter confirms, Escape restores. */
  function grab() {
    if (session?.source === 'keyboard') return true;
    if (!start('keyboard', 'free')) return false;
    session.active = true;
    if (refs.gizmo) refs.gizmo.dataset.grab = 'true';
    markDragging(true);
    return true;
  }

  function nudge(dxSteps, dySteps) {
    const s = session;
    if (s?.source !== 'keyboard') return;
    const f = s.frame;
    apply(
      nudgeWallPosition({
        item: { xCm: s.live.xCm, yCm: s.live.yCm, wCm: f.w, hCm: f.h },
        dxSteps,
        dySteps,
        wallSpanCm: f.span,
        wallHeightCm: f.height,
        snapCm: propsRef.current.snapCm,
      }),
    );
  }

  /** A nudge key outside grab mode: one snap step, committed at once. */
  function nudgeCommit(dxSteps, dySteps) {
    const item = selectedItem();
    if (!item) return;
    const f = frameOf(propsRef.current.state, item);
    const next = nudgeWallPosition({
      item: { xCm: item.xCm, yCm: item.yCm, wCm: f.w, hCm: f.h },
      dxSteps,
      dySteps,
      wallSpanCm: f.span,
      wallHeightCm: f.height,
      snapCm: propsRef.current.snapCm,
    });
    if (next.moved) propsRef.current.onCommit(item.uid, { xCm: next.xCm, yCm: next.yCm }, 'nudge');
  }

  /** The anchor the gizmo and laser lines follow: the live drag position, else the committed one. */
  function anchor() {
    const item = selectedItem();
    if (!item) return null;
    const f = session?.uid === item.uid ? session.frame : frameOf(propsRef.current.state, item, false);
    const live = session?.uid === item.uid ? session.live : item;
    return { ...f, xCm: live.xCm, yCm: live.yCm };
  }

  return {
    refs,
    bridge,
    groups,
    beginPointer,
    end,
    grab,
    nudge,
    nudgeCommit,
    anchor,
    isActive: () => Boolean(session),
    isGrabbing: () => session?.source === 'keyboard',
    sessionUid: () => session?.uid ?? null,
    dispose: () => end(false),
  };
}

export function useWallDrag({ state, selectedUid, snapCm, axisLock, onCommit }) {
  const propsRef = useRef(null);
  propsRef.current = { state, selectedUid, snapCm, axisLock, onCommit };
  const controller = useMemo(() => createController(propsRef), []);

  // A selection change or an edit from elsewhere cancels a drag in flight.
  useEffect(() => {
    const uid = controller.sessionUid();
    if (uid !== null && uid !== selectedUid) controller.end(false);
  }, [selectedUid, controller]);

  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}
