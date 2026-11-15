import { useEffect, useRef, useState } from 'react';
import { HERO_MEDIA } from '../lib/media-manifest.js';
import { frameDelta, stepSpring } from '../lib/spring.js';
import { XRAY_ACOUSTICS, XRAY_BUS, XRAY_FRAME, XRAY_ROOM } from '../lib/xray-figures.js';
import {
  clampSplit,
  focusSplit,
  splitForKey,
  splitFromPointer,
  splitMode,
  splitReadout,
  splitValueText,
  viewAt,
  XRAY_FOCUS_FRAME_X,
  XRAY_MODE_LABELS,
  XRAY_SETTLE,
  XRAY_SPLIT,
  XRAY_SPRING,
  XRAY_VIEWS,
} from '../lib/xray-slider.js';

const PHOTO_ALT =
  'The limestone north wall at dusk under 2700K light: the Linear Suspension Pendant 150 over a travertine console, three track grazers, the Floating Shelf 110 and the Corner Floor Column 140';
// The frame is the stage width on screens above 640 px and 16:9 of a square stage below.
const PHOTO_SIZES = '(max-width: 640px) 170vw, (max-width: 1440px) 94vw, 1344px';
// The blueprint is drawn once the stage comes within this margin of the viewport.
const DRAW_MARGIN = '900px 0px';
const MAX_GLIDE_DT = 0.1;
// Sideways travel that turns a touch on the picture into a drag of the divider.
const TOUCH_SLOP_PX = 8;
const MASK_ID = 'xray-wall-mask';
const { width: FRAME_W, height: FRAME_H } = XRAY_FRAME;

const CAPTION = `A 1:20 elevation of the north wall drawn in register with the photograph: limestone ${XRAY_ROOM.widthCm} x ${XRAY_ROOM.heightCm} cm, the pendant 122 cm above the floor on a 165.5 cm drop, three 24 degree grazers with their 100, 250 and 500 lux contours, the 165 cm eye level, and the 24V SELV run from a ${XRAY_BUS.driverW} W DALI-2 driver node at ${XRAY_BUS.dropPct.toFixed(2)} percent voltage drop. Reverberation ${XRAY_ACOUSTICS.rt60Sec.toFixed(2)} s at 500 Hz.`;

/** A note set in type over the drawing at its frame point; CSS turns the anchor and baseline into an offset. */
function BlueprintLabel({ label }) {
  return (
    <span
      className="xray__label"
      data-label={label.id}
      data-group={label.group ?? undefined}
      data-tier={label.tier}
      data-phone={label.phone ? 'true' : undefined}
      data-anchor={label.anchor}
      data-baseline={label.baseline}
      data-rotate={label.rotate ? 'vertical' : undefined}
      style={{ left: `${label.x}%`, top: `${label.y}%` }}
    >
      {label.text}
    </span>
  );
}

/**
 * The drawing's title block: the sheet and its scale stamp, the 24V run and
 * the room's reverberation (the acoustic badge, one bar per octave), then the
 * drafting office.
 */
function TitleBlock() {
  const peak = Math.max(...XRAY_ACOUSTICS.octaves.map((octave) => octave.rt60));
  const rows = [
    ['bus', '24V SELV', `${XRAY_BUS.driverW} W DALI-2 / ${XRAY_BUS.loadW} W`],
    ['drop', 'DROP', `${XRAY_BUS.dropPct.toFixed(2)}% / RUN ${XRAY_BUS.runM.toFixed(1)} M`],
    ['rt60', 'RT60', `${XRAY_ACOUSTICS.rt60Sec.toFixed(2)} S AT 500 HZ`],
    ['sti', 'STI', XRAY_ACOUSTICS.sti.toFixed(2)],
  ];
  return (
    <div className="xray__sheet" data-group="exports" data-testid="xray-title-block" aria-hidden="true">
      <p className="xray__sheet-title">NORTH WALL ELEVATION</p>
      <p className="xray__sheet-stamp" data-testid="xray-scale-stamp">
        <span>SCALE 1:20</span>
        <span>ISO A3</span>
        <span>UNITS: CM</span>
      </p>
      <dl className="xray__sheet-rows">
        {rows.map(([id, term, value]) => (
          <div key={id} className="xray__sheet-row" data-group="bus" data-testid={`xray-sheet-${id}`}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="xray__octaves" data-group="bus" data-testid="xray-octaves">
        {XRAY_ACOUSTICS.octaves.map((octave) => (
          <span key={octave.hz} className="xray__octave" data-hz={octave.hz} data-rt60={octave.rt60}>
            <span className="xray__octave-bar" style={{ height: `${Math.round((octave.rt60 / peak) * 100)}%` }} />
            <span className="xray__octave-label">{octave.label}</span>
          </span>
        ))}
      </div>
      <p className="xray__sheet-firm">
        LUMEN SPATIAL STUDIO KFT.
        <br />
        1052 BUDAPEST // LMN-XR-03
      </p>
    </div>
  );
}

function Blueprint({ blueprint }) {
  return (
    <>
      <svg className="xray__svg" viewBox={blueprint.viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false" data-testid="xray-svg">
        <defs>
          <mask id={MASK_ID} maskUnits="userSpaceOnUse" x="0" y="0" width={FRAME_W} height={FRAME_H}>
            <rect width={FRAME_W} height={FRAME_H} fill="#fff" />
            <path d={blueprint.mask} fill="#000" />
          </mask>
        </defs>
        <rect className="xray__paper" width={FRAME_W} height={FRAME_H} />
        {blueprint.layers.map((layer) => (
          <path
            key={layer.id}
            className={`xr xr--${layer.kind}`}
            d={layer.d}
            data-layer={layer.id}
            data-group={layer.group ?? undefined}
            data-level={layer.level}
            data-tone={layer.tone}
            mask={layer.masked ? `url(#${MASK_ID})` : undefined}
          />
        ))}
      </svg>
      <div className="xray__labels" aria-hidden="true">
        {blueprint.labels.map((label) => (
          <BlueprintLabel key={label.id} label={label} />
        ))}
      </div>
    </>
  );
}

function SplitGlyph() {
  return (
    <svg className="xray__glyph" viewBox="0 0 40 14" aria-hidden="true" focusable="false">
      <path d="M8 2 3 7l5 5M32 2l5 5-5 5M20 0v14" />
    </svg>
  );
}

/**
 * The X-ray stage: the warm 2K photograph under its 1:20 blueprint, one
 * frame for both so a line of the drawing sits on its own photographed
 * edge. The divider never goes through React state while it moves: pointer
 * drags and quick-view glides write `--xray-split`, the handle's ARIA value
 * and its readout straight to the DOM inside requestAnimationFrame, and the
 * position is committed once, when the gesture or the glide settles.
 * `data-motion` reads idle, drag or glide. `apiRef.current.reveal(id)`
 * opens the blueprint to a capability's callouts.
 */
export function XrayStage({ focus = null, apiRef = null }) {
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const handleRef = useRef(null);
  const readoutRef = useRef(null);
  const controlRef = useRef(null);
  const [split, setSplit] = useState(XRAY_SPLIT.initial);
  const [blueprint, setBlueprint] = useState(null);
  const photo = HERO_MEDIA.warm;

  // The blueprint is a few thousand projected points and an iso-lux grid: its module loads as its
  // own chunk and draws once, when the stage comes near the viewport. Until then (or offline) the
  // photograph fills the stage.
  useEffect(() => {
    let live = true;
    const draw = () =>
      import('../lib/xray-blueprint.js')
        .then(({ buildXrayBlueprint }) => {
          if (live) setBlueprint(buildXrayBlueprint());
        })
        .catch(() => {});
    if (!('IntersectionObserver' in window)) {
      draw();
      return () => {
        live = false;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        draw();
      },
      { rootMargin: DRAW_MARGIN },
    );
    observer.observe(stageRef.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    const handle = handleRef.current;
    const readout = readoutRef.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const m = { value: XRAY_SPLIT.initial, velocity: 0, target: XRAY_SPLIT.initial, frame: 0, last: 0, pointer: null, pendingX: null, armed: false, startX: 0, startY: 0 };

    const paint = (value) => {
      const mode = splitMode(value);
      stage.style.setProperty('--xray-split', value.toFixed(2));
      stage.dataset.mode = mode;
      handle.setAttribute('aria-valuenow', String(Math.round(value)));
      handle.setAttribute('aria-valuetext', splitValueText(value));
      readout.textContent = `${splitReadout(value)} ${XRAY_MODE_LABELS[mode]}`;
    };
    const halt = () => {
      cancelAnimationFrame(m.frame);
      m.frame = 0;
      m.velocity = 0;
    };
    // One React commit per gesture: the quick-view keys and the data-split read it.
    const land = (value) => {
      halt();
      m.value = clampSplit(value);
      m.target = m.value;
      paint(m.value);
      stage.dataset.motion = 'idle';
      setSplit(m.value);
    };

    const glide = (now) => {
      const dt = frameDelta(now, m.last, MAX_GLIDE_DT);
      m.last = now;
      [m.value, m.velocity] = stepSpring(m.value, m.velocity, m.target, dt, XRAY_SPRING.stiffness, XRAY_SPRING.damping);
      if (Math.abs(m.value - m.target) < XRAY_SETTLE.distance && Math.abs(m.velocity) < XRAY_SETTLE.speed) {
        land(m.target);
        return;
      }
      paint(m.value);
      m.frame = requestAnimationFrame(glide);
    };

    const aim = (target) => {
      if (m.pointer !== null) return;
      m.target = clampSplit(target);
      if (reduced.matches || Math.abs(m.target - m.value) < XRAY_SETTLE.distance) {
        land(m.target);
        return;
      }
      stage.dataset.motion = 'glide';
      if (!m.frame) {
        m.last = performance.now();
        m.frame = requestAnimationFrame(glide);
      }
    };

    const fromPointer = (clientX) => {
      const box = stage.getBoundingClientRect();
      return splitFromPointer(clientX, box.left, box.width);
    };
    const follow = () => {
      m.frame = 0;
      if (m.pendingX === null) return;
      m.value = fromPointer(m.pendingX);
      m.target = m.value;
      m.pendingX = null;
      paint(m.value);
    };

    // The drag proper: the divider jumps under the pointer and follows it frame by frame.
    const begin = (event) => {
      halt();
      m.armed = false;
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks: the drag still follows its events over the stage.
      }
      stage.dataset.motion = 'drag';
      stage.dataset.input = 'pointer';
      if (event.pointerType !== 'touch') handle.focus({ preventScroll: true });
      m.value = fromPointer(event.clientX);
      m.target = m.value;
      paint(m.value);
    };
    const onDown = (event) => {
      if (event.button !== 0 || m.pointer !== null) return;
      m.pointer = event.pointerId;
      m.startX = event.clientX;
      m.startY = event.clientY;
      // A finger on the picture may be starting a page scroll: it takes the divider only once it
      // travels sideways (touch-action: pan-y leaves vertical travel to the browser). The handle and
      // mouse or pen presses take it at once.
      m.armed = event.pointerType === 'touch' && !handle.contains(event.target);
      if (m.armed) return;
      begin(event);
      event.preventDefault();
    };
    const onMove = (event) => {
      if (event.pointerId !== m.pointer) return;
      if (m.armed) {
        const dx = Math.abs(event.clientX - m.startX);
        if (dx >= TOUCH_SLOP_PX && dx > Math.abs(event.clientY - m.startY)) begin(event);
        return;
      }
      m.pendingX = event.clientX;
      if (!m.frame) m.frame = requestAnimationFrame(follow);
    };
    const onUp = (event) => {
      if (event.pointerId !== m.pointer) return;
      m.pointer = null;
      if (m.armed) {
        // A tap that stayed put sets the divider where it landed; a swipe or a cancel was the page's.
        m.armed = false;
        const travel = Math.hypot(event.clientX - m.startX, event.clientY - m.startY);
        if (event.type === 'pointerup' && travel < TOUCH_SLOP_PX) aim(fromPointer(event.clientX));
        return;
      }
      const value = m.pendingX === null ? m.value : fromPointer(m.pendingX);
      m.pendingX = null;
      land(value);
    };
    // Only the stage's own capture ending closes a drag. Chrome captures a touch to the element it
    // lands on (an SVG rect, the photograph), and when the drag takes the capture for the stage
    // that element's lostpointercapture bubbles up here too: it must not end the gesture.
    const onLost = (event) => {
      if (event.target === stage) onUp(event);
    };
    const onKey = (event) => {
      const next = splitForKey(event.key, m.value, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      stage.dataset.input = 'keyboard';
      land(next);
    };
    const onBlur = () => {
      delete stage.dataset.input;
    };

    // Opens the blueprint as far as a capability's callouts, measured where its frame point falls on this stage.
    const reveal = (id) => {
      const x = XRAY_FOCUS_FRAME_X[id];
      const frame = frameRef.current;
      if (x === undefined || !frame) return;
      const f = frame.getBoundingClientRect();
      const box = stage.getBoundingClientRect();
      if (!(box.width > 0)) return;
      const target = focusSplit(m.value, ((f.left + (x / FRAME_W) * f.width - box.left) / box.width) * 100);
      if (target !== null) aim(target);
    };

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('lostpointercapture', onLost);
    handle.addEventListener('keydown', onKey);
    handle.addEventListener('blur', onBlur);
    paint(m.value);
    controlRef.current = { aim };
    if (apiRef) apiRef.current = { reveal };

    return () => {
      stage.removeEventListener('pointerdown', onDown);
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp);
      stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('lostpointercapture', onLost);
      handle.removeEventListener('keydown', onKey);
      handle.removeEventListener('blur', onBlur);
      halt();
      controlRef.current = null;
      if (apiRef) apiRef.current = null;
    };
  }, [apiRef]);

  const active = viewAt(split);

  return (
    <figure className="xray" data-testid="xray-stage" data-focus={focus ?? 'none'} data-split={split} aria-labelledby="xray-title" aria-describedby="xray-caption">
      <div className="xray__bar">
        <p id="xray-title" className="xray__title">
          <span className="xray__title-key">X-Ray</span> North Wall Elevation
        </p>
        <div className="xray__views" role="group" aria-label="X-ray views">
          {XRAY_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className="xray__view"
              data-testid={`xray-view-${view.id}`}
              aria-pressed={active?.id === view.id}
              onClick={() => controlRef.current?.aim(view.split)}
            >
              <span className="xray__view-long">{view.label}</span>
              <span className="xray__view-short">{view.short}</span>
            </button>
          ))}
        </div>
      </div>

      <div ref={stageRef} className="xray__stage" data-testid="xray-canvas" data-motion="idle">
        <div className="xray__layer xray__layer--photo" data-testid="xray-photo-layer">
          <div ref={frameRef} className="xray__frame">
            <img
              className="xray__photo"
              src={photo.still[2560]}
              srcSet={photo.srcSet}
              sizes={PHOTO_SIZES}
              width={FRAME_W}
              height={FRAME_H}
              alt={PHOTO_ALT}
              loading="lazy"
              decoding="async"
              draggable="false"
              data-testid="xray-photo"
            />
          </div>
          <p className="xray__badge xray__badge--photo" data-testid="xray-badge-photo">
            <span className="xray__badge-long">OPTICAL // 2700K CRI 97</span>
            <span className="xray__badge-short">OPTICAL // 2700K</span>
          </p>
        </div>

        <div className="xray__layer xray__layer--cad" data-testid="xray-blueprint" data-blueprint={blueprint ? 'ready' : 'pending'}>
          <div className="xray__frame">
            {blueprint ? <Blueprint blueprint={blueprint} /> : null}
            <TitleBlock />
          </div>
          <p className="xray__badge xray__badge--cad" data-testid="xray-badge-cad">
            <span className="xray__badge-long">CAD // 1:20 ELEVATION &amp; 24V BUS</span>
            <span className="xray__badge-short">CAD // 1:20</span>
          </p>
        </div>

        <div className="xray__divider" data-testid="xray-divider">
          <div
            ref={handleRef}
            className="xray__handle"
            role="slider"
            tabIndex={0}
            aria-label="Compare 2K architectural photograph and 1:20 CAD blueprint"
            aria-valuemin={XRAY_SPLIT.min}
            aria-valuemax={XRAY_SPLIT.max}
            aria-valuenow={Math.round(split)}
            aria-valuetext={splitValueText(split)}
            aria-orientation="horizontal"
            data-testid="xray-handle"
          >
            <SplitGlyph />
            <span ref={readoutRef} className="xray__readout" aria-hidden="true" />
          </div>
        </div>
      </div>
      <figcaption id="xray-caption" className="visually-hidden">
        {CAPTION}
      </figcaption>
    </figure>
  );
}
