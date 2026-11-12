import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const BOOT_HOLD_MS = 950;
const REPLAY_MS = 1400;
// rAF stalls in a hidden tab; the overlay must still clear itself.
const SAFETY_MS = 900;
const ENGINE_LABEL = `LUMEN SPATIAL ENGINE v${__APP_VERSION__.split('.').slice(0, 2).join('.')}`;

const STEPS = Object.freeze(['01 / WebGL2 Shader Pipeline', '02 / 4-Wall Raycast & Gizmo Solver', '03 / 24V Photometric Kernel']);

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function stepOf(progress) {
  if (progress < 0.34) return 0;
  if (progress < 0.68) return 1;
  return 2;
}

function Monogram() {
  return (
    <svg className="studio-boot__mark" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="4" height="18" fill="currentColor" />
      <rect x="3" y="17" width="18" height="4" fill="currentColor" />
      <rect x="10" y="3" width="11" height="3.5" fill="currentColor" />
      <rect className="studio-boot__aperture" x="14.25" y="8.5" width="2" height="6.5" />
    </svg>
  );
}

/**
 * Full-screen engine boot while the WebGL chunk loads and the first frame
 * compiles. It is portaled to the body, so no transformed ancestor can trap
 * its fixed position, and it covers the navbar and every dock. The layer never
 * takes the pointer, only its skip key does; it clears 950 ms after the canvas
 * reports ready, at once under reduced motion, and on Enter Studio Now. The
 * bar and percentage are written per frame straight to the DOM; React only
 * hears about the three step changes. The phase is mirrored onto `revealRef`
 * as `data-boot`, which settles the workstation in as the overlay lifts.
 */
export function StudioBootOverlay({ ready, replay = 0, revealRef = null }) {
  const [phase, setPhase] = useState(() => (reducedMotion() ? 'done' : 'booting'));
  const [run, setRun] = useState({ id: 0, replay: false });
  const [step, setStep] = useState(0);
  const fillRef = useRef(null);
  const pctRef = useRef(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (replay === 0 || reducedMotion()) return;
    setStep(0);
    setRun((current) => ({ id: current.id + 1, replay: true }));
    setPhase('booting');
  }, [replay]);

  useLayoutEffect(() => {
    const el = revealRef?.current;
    if (!el) return undefined;
    el.dataset.boot = phase;
    if (phase !== 'done') return undefined;
    // The settle scale skews getBoundingClientRect while it runs; anything that
    // measured the stage meanwhile (the WebGL canvas on a scroll) re-reads it
    // once the workstation lands at full size.
    const onEnd = (event) => {
      if (event.target === el) window.dispatchEvent(new Event('resize'));
    };
    el.addEventListener('animationend', onEnd);
    return () => el.removeEventListener('animationend', onEnd);
  }, [phase, revealRef]);

  useEffect(() => {
    if (phase !== 'booting') return undefined;
    let frame = 0;
    let last = performance.now();
    const startedAt = last;
    let readyAt = null;
    let progress = 0;
    let shown = 0;
    const paint = (value) => {
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${value.toFixed(4)})`;
      if (pctRef.current) pctRef.current.textContent = `${String(Math.round(value * 100)).padStart(3, '0')}%`;
    };
    paint(0);
    const tick = (now) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (readyRef.current && readyAt === null) readyAt = now;
      const goal = run.replay ? Math.min(1, (now - startedAt) / REPLAY_MS) : readyAt !== null ? 1 : 0.9;
      const rate = run.replay ? 14 : readyAt !== null ? 6 : 2.2;
      progress += (goal - progress) * (1 - Math.exp(-dt * rate));
      paint(progress);
      const next = stepOf(progress);
      if (next !== shown) {
        shown = next;
        setStep(next);
      }
      const held = readyAt !== null && now - readyAt >= BOOT_HOLD_MS;
      if (held && (!run.replay || now - startedAt >= REPLAY_MS)) {
        paint(1);
        setStep(STEPS.length);
        setPhase('done');
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, run]);

  useEffect(() => {
    if (phase !== 'booting' || !ready) return undefined;
    const timer = setTimeout(() => setPhase('done'), (run.replay ? REPLAY_MS : BOOT_HOLD_MS) + SAFETY_MS);
    return () => clearTimeout(timer);
  }, [phase, ready, run]);

  const booting = phase === 'booting';

  return createPortal(
    <div
      className="studio-boot"
      data-testid="studio-boot-overlay"
      data-state={phase}
      data-step={Math.min(step, STEPS.length)}
      role="status"
      aria-label="Lumen Spatial Engine"
    >
      <div key={run.id} className="studio-boot__panel" aria-hidden="true">
        <Monogram />
        <p className="studio-boot__title mono">{ENGINE_LABEL}</p>
        <div className="studio-boot__meter">
          <div className="studio-boot__bar">
            <span ref={fillRef} className="studio-boot__fill" />
          </div>
          <span ref={pctRef} className="studio-boot__pct mono">
            000%
          </span>
        </div>
        <ol className="studio-boot__steps mono">
          {STEPS.map((label, i) => (
            <li key={label} className="studio-boot__step" data-state={i < step ? 'done' : i === step ? 'active' : 'pending'}>
              <span className="studio-boot__tick" />
              {label}
            </li>
          ))}
        </ol>
      </div>
      <span className="visually-hidden">{booting ? STEPS[Math.min(step, STEPS.length - 1)] : 'Studio ready'}</span>
      <button
        type="button"
        className="studio-boot__skip mono"
        data-testid="skip-studio-boot"
        tabIndex={booting ? 0 : -1}
        aria-hidden={!booting}
        onClick={() => setPhase('done')}
      >
        Enter Studio Now
      </button>
    </div>,
    document.body,
  );
}
