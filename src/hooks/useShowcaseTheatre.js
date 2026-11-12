import { useEffect, useRef } from 'react';
import { paintFrame } from '../lib/showcase-painter.js';
import {
  ACT_IDS,
  ACT_SECONDS,
  actCamera,
  actSpinRate,
  angleDelta,
  buildLuxField,
  busRuns,
  createView,
  easeInOut,
  EYE_FOV_DEG,
  EYE_HEIGHT_CM,
  eyeHeading,
  eyeIlluminance,
  floorUnder,
  gizmoPose,
  illuminance,
  isActId,
  nextAct,
  PENDANT,
  SHELF,
  shelfDimensions,
  wrap360,
} from '../lib/showcase-scene.js';
import { approach, frameDelta, stepSpring } from '../lib/spring.js';

// Near-critical (c = 2 * sqrt(k)): act changes glide without overshoot, and
// the closed-form step traces the same curve at 60, 120 and 240 Hz.
const CAMERA_SPRING = { stiffness: 14, damping: 7.6 };
const PARALLAX_SPRING = { stiffness: 90, damping: 19 };
const PARALLAX_DEG = { yaw: 9, pitch: 6 };
const PRESENCE_RATE = 5;
const LIGHT_RATE = 3;
const SHELF_RATE = 26;
const MAX_DPR = 2;
// Reduced motion shows one still per act, taken mid-choreography.
const STILL_T = 1.6;
const CAM_KEYS = ['yaw', 'pitch', 'dist', 'tx', 'ty', 'tz', 'fov'];
const UP = [0, 1, 0];
const PENDANT_FLOOR = [(PENDANT.x0 + PENDANT.x1) / 2, 0, PENDANT.z];

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

function lightLevel(act) {
  if (act === 'orbit') return 1;
  if (act === 'isolux') return 0.35;
  return 0.72;
}

function pad(n, width) {
  return String(Math.max(0, Math.round(n))).padStart(width, '0');
}

/**
 * The overview theatre engine. One rAF loop integrates every motion with the
 * frame's dt, paints the canvas and writes the HUD text straight into the DOM;
 * React only hears about act changes (every few seconds) through `onAct`.
 * The loop runs only while the stage is on screen, and never under reduced
 * motion, where each act is one still frame.
 *
 * Returns a ref to the controller: pick (click: hold or release an act),
 * preview / endPreview (hover).
 */
export function useShowcaseTheatre({ stageRef, canvasRef, onAct }) {
  const controller = useRef(null);
  const onActRef = useRef(onAct);
  useEffect(() => {
    onActRef.current = onAct;
  });

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!stage || !ctx) return undefined;

    const hud = {
      az: stage.querySelector('[data-hud="az"]'),
      pitch: stage.querySelector('[data-hud="pitch"]'),
      lux: stage.querySelector('[data-hud="lux"]'),
      line: stage.querySelector('[data-hud="line"]'),
    };
    const fills = {};
    for (const el of stage.querySelectorAll('[data-act-fill]')) fills[el.dataset.actFill] = el;
    const written = new Map();
    const write = (el, text) => {
      if (el && written.get(el) !== text) {
        written.set(el, text);
        el.textContent = text;
      }
    };

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const field = buildLuxField();
    const start = actCamera('orbit', 0, 0, -24);
    const s = {
      auto: 'orbit',
      locked: null,
      hover: null,
      act: 'orbit',
      age: 0,
      cycle: 0,
      time: 0,
      spin: start.yaw,
      cam: { ...start },
      vel: Object.fromEntries(CAM_KEYS.map((key) => [key, 0])),
      par: { x: 0, vx: 0, y: 0, vy: 0, tx: 0, ty: 0 },
      presence: Object.fromEntries(ACT_IDS.map((id) => [id, id === 'orbit' ? 1 : 0])),
      light: 1,
      shelf: { x: SHELF.home.x, y: SHELF.home.y, snapped: { ...SHELF.home } },
      pose: gizmoPose(0),
      pointer: null,
      width: 0,
      height: 0,
      dpr: 1,
      visible: false,
      reduced: reducedQuery.matches,
      frame: 0,
      last: 0,
      fill: { act: null, value: -1 },
    };

    const notify = () => onActRef.current?.({ act: s.act, locked: s.locked, preview: s.hover });

    const enter = (act) => {
      s.act = act;
      s.age = 0;
      s.cycle = 0;
      // The orbit picks up from wherever the camera stands, so the turn never jumps.
      if (actSpinRate(act) > 0) s.spin = s.cam.yaw;
      notify();
    };

    const settle = () => {
      const next = s.hover ?? s.locked ?? s.auto;
      if (next !== s.act) enter(next);
      else notify();
      if (s.reduced) drawStill();
    };

    const writeFill = (value) => {
      if (s.fill.act !== s.act) {
        for (const [id, el] of Object.entries(fills)) if (id !== s.act) el.style.transform = 'scaleX(0)';
        s.fill.act = s.act;
        s.fill.value = -1;
      }
      const el = fills[s.act];
      if (el && Math.abs(value - s.fill.value) > 0.002) {
        s.fill.value = value;
        el.style.transform = `scaleX(${value.toFixed(3)})`;
      }
    };

    const writeHud = (view, cam, probe) => {
      write(hud.az, pad(wrap360(cam.yaw) % 360, 3));
      write(hud.pitch, pad(cam.pitch, 2));
      const t = s.age % ACT_SECONDS;
      let key;
      let line;
      if (s.act === 'inside') {
        key = eyeIlluminance(eyeHeading(t));
        line = `Eye ${EYE_HEIGHT_CM} cm / FOV ${EYE_FOV_DEG} deg / ${Math.round(key)} lx`;
      } else if (s.act === 'gizmo') {
        const d = shelfDimensions(s.shelf.snapped);
        key = illuminance([s.shelf.x + SHELF.widthCm / 2, 0, 40], UP, s.shelf.snapped);
        line = `X: ${d.x} cm / Y: ${d.y} cm / R: ${d.r} cm / C: ${d.c} cm`;
      } else if (s.act === 'isolux') {
        key = field.surfaces[0].peak;
        line = `Iso-lux 100 / 250 / 500 lx / Floor peak ${Math.round(key)} lx`;
      } else {
        key = illuminance(PENDANT_FLOOR, UP);
        line = '24V DC daisy chain / 5 nodes / 2700K';
      }
      write(hud.lux, pad(probe ? illuminance(probe, UP, s.shelf.snapped) : key, 3));
      write(hud.line, line);
    };

    const render = (cam, bloom) => {
      if (s.width === 0 || s.height === 0) return;
      const view = createView(cam, s.width, s.height);
      const probe = s.pointer ? floorUnder(view, s.pointer.x, s.pointer.y) : null;
      const t = s.age % ACT_SECONDS;
      paintFrame(ctx, {
        view,
        dpr: s.dpr,
        width: s.width,
        height: s.height,
        time: s.time,
        presence: s.presence,
        light: s.light,
        shelf: s.shelf,
        pose: s.pose,
        runs: busRuns(s.shelf),
        heading: { now: eyeHeading(t), at: (lag) => eyeHeading(t - lag) },
        field,
        bloom,
        probe,
      });
      writeHud(view, cam, probe);
    };

    const viewCamera = () => ({
      ...s.cam,
      yaw: s.cam.yaw + s.par.x * PARALLAX_DEG.yaw,
      pitch: Math.max(5, Math.min(80, s.cam.pitch - s.par.y * PARALLAX_DEG.pitch)),
    });

    const step = (dt) => {
      s.time += dt;
      s.age += dt;
      const holding = s.locked !== null || s.hover !== null;
      if (!holding) {
        s.cycle += dt;
        if (s.cycle >= ACT_SECONDS) {
          s.auto = nextAct(s.act);
          enter(s.auto);
        }
      }
      const t = s.age % ACT_SECONDS;
      s.spin += actSpinRate(s.act) * dt;
      const goal = actCamera(s.act, t, s.age, s.spin);
      for (const key of CAM_KEYS) {
        const target = key === 'yaw' ? s.cam.yaw + angleDelta(s.cam.yaw, goal.yaw) : goal[key];
        [s.cam[key], s.vel[key]] = stepSpring(s.cam[key], s.vel[key], target, dt, CAMERA_SPRING.stiffness, CAMERA_SPRING.damping);
      }
      const { stiffness, damping } = PARALLAX_SPRING;
      [s.par.x, s.par.vx] = stepSpring(s.par.x, s.par.vx, s.par.tx, dt, stiffness, damping);
      [s.par.y, s.par.vy] = stepSpring(s.par.y, s.par.vy, s.par.ty, dt, stiffness, damping);
      for (const id of ACT_IDS) s.presence[id] = approach(s.presence[id], id === s.act ? 1 : 0, PRESENCE_RATE, dt);
      s.light = approach(s.light, lightLevel(s.act), LIGHT_RATE, dt);

      s.pose = s.act === 'gizmo' ? gizmoPose(t) : { ...SHELF.home, axis: null, lock: 0 };
      s.shelf.snapped = { x: s.pose.x, y: s.pose.y };
      s.shelf.x = approach(s.shelf.x, s.pose.x, SHELF_RATE, dt);
      s.shelf.y = approach(s.shelf.y, s.pose.y, SHELF_RATE, dt);

      writeFill(holding ? 1 : Math.min(1, s.cycle / ACT_SECONDS));
      render(viewCamera(), s.act === 'isolux' ? easeInOut(s.age / 1.6) : 1);
    };

    const loop = (now) => {
      const dt = frameDelta(now, s.last);
      s.last = now;
      step(dt);
      s.frame = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (s.frame || s.reduced || !s.visible) return;
      s.last = performance.now();
      s.frame = requestAnimationFrame(loop);
    };

    const stopLoop = () => {
      cancelAnimationFrame(s.frame);
      s.frame = 0;
    };

    /** Reduced motion: the act's still, camera and lights already settled. */
    function drawStill() {
      const cam = actCamera(s.act, STILL_T, 3, s.act === 'isolux' ? 32 : -24);
      for (const id of ACT_IDS) s.presence[id] = id === s.act ? 1 : 0;
      s.light = lightLevel(s.act);
      s.age = STILL_T;
      s.pose = s.act === 'gizmo' ? gizmoPose(STILL_T) : { ...SHELF.home, axis: null, lock: 0 };
      s.shelf = { x: s.pose.x, y: s.pose.y, snapped: { x: s.pose.x, y: s.pose.y } };
      s.cam = { ...cam };
      writeFill(1);
      render(cam, 1);
    }

    let stillFrame = 0;
    const requestStill = () => {
      if (stillFrame) return;
      stillFrame = requestAnimationFrame(() => {
        stillFrame = 0;
        drawStill();
      });
    };

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      if (width === s.width && height === s.height && dpr === s.dpr) return;
      s.width = width;
      s.height = height;
      s.dpr = dpr;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (s.reduced || !s.frame) {
        if (s.reduced) drawStill();
        else render(viewCamera(), 1);
      }
    };

    const onMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      s.pointer = { x, y };
      const tilt = event.pointerType !== 'touch' && !s.reduced;
      s.par.tx = tilt ? clampUnit((x / rect.width) * 2 - 1) : 0;
      s.par.ty = tilt ? clampUnit((y / rect.height) * 2 - 1) : 0;
      if (s.reduced) requestStill();
    };

    const onLeave = () => {
      s.pointer = null;
      s.par.tx = 0;
      s.par.ty = 0;
      if (s.reduced) requestStill();
    };

    const onReducedChange = () => {
      s.reduced = reducedQuery.matches;
      if (s.reduced) {
        stopLoop();
        s.par = { x: 0, vx: 0, y: 0, vy: 0, tx: 0, ty: 0 };
        drawStill();
      } else {
        startLoop();
      }
    };

    const visibility = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      if (s.visible) startLoop();
      else stopLoop();
    });
    const sizing = new ResizeObserver(resize);

    resize();
    sizing.observe(canvas);
    visibility.observe(canvas);
    canvas.addEventListener('pointermove', onMove, { passive: true });
    canvas.addEventListener('pointerleave', onLeave);
    reducedQuery.addEventListener('change', onReducedChange);
    if (s.reduced) drawStill();

    controller.current = {
      pick(act) {
        if (!isActId(act)) return;
        if (s.locked === act) {
          s.locked = null;
          s.auto = act;
          s.cycle = 0;
        } else {
          s.locked = act;
        }
        settle();
      },
      preview(act) {
        if (!isActId(act) || s.hover === act) return;
        s.hover = act;
        settle();
      },
      endPreview(act) {
        if (s.hover !== act) return;
        s.hover = null;
        settle();
      },
    };
    notify();

    return () => {
      stopLoop();
      cancelAnimationFrame(stillFrame);
      visibility.disconnect();
      sizing.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      reducedQuery.removeEventListener('change', onReducedChange);
      controller.current = null;
    };
  }, [stageRef, canvasRef]);

  return controller;
}
