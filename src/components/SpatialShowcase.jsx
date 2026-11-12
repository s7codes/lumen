import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { useSectionSpy } from '../hooks/useSectionLink.js';
import { useShowcaseTheatre } from '../hooks/useShowcaseTheatre.js';
import { launchHref, LAUNCH_PATH } from '../lib/launch-presets.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { SHOWCASE_3D_ID } from '../lib/routes.js';
import { ACTS, STAGE_ROOM } from '../lib/showcase-scene.js';
import { ArrowRight, CubeGlyph, PresetEyeGlyph, PresetLoftGlyph, PresetOrbitGlyph } from './icons.jsx';

const STAGE_ID = 'showcase3d-stage';
const ENGINE_VERSION = __APP_VERSION__.split('.').slice(0, 2).join('.');
const ROOM_LABEL = `${STAGE_ROOM.label} / ${STAGE_ROOM.widthCm} x ${STAGE_ROOM.depthCm} x ${STAGE_ROOM.heightCm} cm`;

const PILLARS = Object.freeze([
  {
    act: 'orbit',
    index: '01',
    title: '360-Degree Four-Wall Envelope',
    body: 'Orbit every wall without a stop, from 5 deg above the floor to an 85 deg plan view. Envelopes run from a compact bedroom to a 900 x 900 cm loft.',
    spec: 'Yaw -180 / +180 deg / Pitch 5-85 deg',
  },
  {
    act: 'inside',
    index: '02',
    title: '165 cm Eye-Level Walkthrough',
    body: 'Stand where you will stand. A 78 deg architectural lens at eye height, widened to 92 deg on the wheel, with vertical illuminance read at the eye.',
    spec: 'Eye 165 cm / FOV 50-92 deg / lx at eye',
  },
  {
    act: 'gizmo',
    index: '03',
    title: 'Direct 3D Raycast & Gizmo',
    body: 'Take a module and slide it across the wall plane under the cursor. Transform gizmo, axis locks and laser dimensions to floor, ceiling and both corners.',
    spec: 'Ray to wall plane / 5 cm snap / X Y locks',
  },
]);

const LAUNCH_PRESETS = Object.freeze([
  {
    id: 'orbit',
    index: 'A',
    label: 'Launch 360-Degree Orbit Studio',
    spec: 'Orbit cutaway / yaw 360 / pitch 5-85 deg',
    to: launchHref({ lens: 'orbit' }),
    Glyph: PresetOrbitGlyph,
  },
  {
    id: 'inside',
    index: 'B',
    label: 'Launch 165 cm Eye-Level Walkthrough',
    spec: 'Inside lens / eye 165 cm / FOV 78 deg',
    to: launchHref({ lens: 'inside' }),
    Glyph: PresetEyeGlyph,
  },
  {
    id: 'loft',
    index: 'C',
    label: 'Launch Grand Loft (800 x 650 cm)',
    spec: '800 x 650 x 340 cm / eye level',
    to: launchHref({ scale: 'loft', lens: 'inside' }),
    Glyph: PresetLoftGlyph,
  },
]);

const warmPlanner = () => prefetchRoute(LAUNCH_PATH);

function hoverIntent(event) {
  return event.pointerType !== 'touch';
}

function Pillar({ pillar, active, held, theatre }) {
  const reveal = useScrollReveal();
  const cardRef = useRef(null);
  useCardTilt(cardRef);
  const { act } = pillar;
  return (
    <li ref={reveal} className="showcase3d__pillar-cell reveal-up">
      <article
        ref={cardRef}
        className="showcase3d__pillar"
        data-active={active || undefined}
        data-testid={`showcase-pillar-${act}`}
        onPointerEnter={(event) => hoverIntent(event) && theatre.current?.preview(act)}
        onPointerLeave={() => theatre.current?.endPreview(act)}
        onClick={() => theatre.current?.pick(act)}
      >
        <p className="index-label">
          <span className="index-label__num">{pillar.index}</span> / Capability
        </p>
        <h3 className="showcase3d__pillar-title">
          <button type="button" className="showcase3d__pillar-key" aria-pressed={held} aria-controls={STAGE_ID}>
            {pillar.title}
          </button>
        </h3>
        <p className="showcase3d__pillar-body">{pillar.body}</p>
        <p className="showcase3d__pillar-spec mono">{pillar.spec}</p>
      </article>
    </li>
  );
}

/** Registration marks for the stage corners, drawn in a 100 x 100 box stretched over the canvas. */
function StageFrame() {
  return (
    <svg className="theatre__frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M2 9V2h7M91 2h7v7M98 91v7h-7M9 98H2v-7" />
      <path d="M48.5 50h3M50 48.5v3" className="theatre__frame-centre" />
    </svg>
  );
}

function Theatre({ stage, setStageNode, canvasRef, theatre }) {
  const current = ACTS.find((act) => act.id === stage.act) ?? ACTS[0];
  return (
    <figure
      ref={setStageNode}
      id={STAGE_ID}
      className="showcase3d__stage bento reveal-cinematic"
      data-act={stage.act}
      data-held={stage.locked ? 'true' : undefined}
      data-testid="showcase-stage"
    >
      <div className="theatre">
        <canvas
          ref={canvasRef}
          className="theatre__canvas"
          data-testid="showcase-stage-canvas"
          data-act={stage.act}
          role="img"
          aria-label={`Animated cutaway of a ${STAGE_ROOM.widthCm} x ${STAGE_ROOM.depthCm} x ${STAGE_ROOM.heightCm} cm room with a lit shelf, linear pendant, corner column and acoustic frame on one 24V bus. ${current.caption}`}
        >
          {current.caption}
        </canvas>
        <div className="theatre__hud" aria-hidden="true">
          <StageFrame />
          <p className="theatre__bar mono">
            <span>{ROOM_LABEL}</span>
            <span className="theatre__act-name">
              Act {current.index} / {current.label}
            </span>
          </p>
          <p className="theatre__telemetry mono" data-testid="showcase-telemetry">
            <span>
              AZ <b data-hud="az" />
            </span>
            <span>
              Pitch <b data-hud="pitch" />
            </span>
            <span>
              Lux <b data-hud="lux" />
            </span>
          </p>
          <p className="theatre__readout mono" data-hud="line" data-testid="showcase-readout" />
        </div>
      </div>

      <div className="theatre__acts" role="group" aria-label="Stage acts">
        {ACTS.map((act) => (
          <button
            key={act.id}
            type="button"
            className="theatre__act"
            aria-pressed={stage.locked === act.id}
            aria-controls={STAGE_ID}
            data-active={stage.act === act.id || undefined}
            data-testid={`showcase-act-${act.id}`}
            onPointerEnter={(event) => hoverIntent(event) && theatre.current?.preview(act.id)}
            onPointerLeave={() => theatre.current?.endPreview(act.id)}
            onClick={() => theatre.current?.pick(act.id)}
          >
            <span className="theatre__act-index mono">{act.index}</span>
            <span className="theatre__act-label">{act.label}</span>
            <span className="theatre__act-track" aria-hidden="true">
              <span className="theatre__act-fill" data-act-fill={act.id} />
            </span>
          </button>
        ))}
      </div>
      <figcaption className="theatre__caption mono">
        {stage.locked ? 'Held' : 'Auto'} / {current.caption}
      </figcaption>
    </figure>
  );
}

function Launchpad() {
  const reveal = useScrollReveal();
  return (
    <div ref={reveal} className="launchpad reveal-cinematic" data-testid="showcase-launchpad">
      <div className="launchpad__main">
        <p className="launchpad__status mono">
          <span className="launchpad__status-rule" aria-hidden="true" />
          SPATIAL ENGINE v{ENGINE_VERSION} // INTERACTIVE WORKSTATION READY
        </p>
        <h3 className="launchpad__title">Step inside the 3D Spatial Workstation.</h3>
        <p className="launchpad__lede">
          Four walls, one 24V run, one bill of materials. The studio opens full screen with the engine warm and your
          last room in place.
        </p>
        <div className="launchpad__actions">
          <Link
            to={LAUNCH_PATH}
            className="button button--primary launchpad__cta"
            data-testid="launch-3d-studio-cta"
            onPointerEnter={warmPlanner}
            onFocus={warmPlanner}
          >
            <span className="launchpad__cta-glyph">
              <CubeGlyph />
            </span>
            <span className="launchpad__cta-copy">
              <span className="launchpad__cta-label">Launch 3D Spatial Studio</span>
              <span className="launchpad__cta-sub" aria-hidden="true">
                Full viewport / WebGL 2
              </span>
            </span>
            <ArrowRight className="launchpad__cta-arrow" />
          </Link>
          <p className="launchpad__spec mono">240-900 cm envelopes / 3 lenses / OBJ and Wall Studio bridge</p>
        </div>
      </div>

      <ul className="launchpad__presets" aria-label="Quick launch presets">
        {LAUNCH_PRESETS.map(({ id, index, label, spec, to, Glyph }) => (
          <li key={id}>
            <Link
              to={to}
              className="launchpad__preset"
              data-testid={`launch-preset-${id}`}
              onPointerEnter={warmPlanner}
              onFocus={warmPlanner}
            >
              <span className="launchpad__preset-glyph">
                <Glyph />
              </span>
              <span className="launchpad__preset-copy">
                <span className="launchpad__preset-index mono">Preset {index}</span>
                <span className="launchpad__preset-title">{label}</span>
                <span className="launchpad__preset-spec mono">{spec}</span>
              </span>
              <ArrowRight className="launchpad__preset-arrow" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Overview showcase for the 3D Spatial Studio. The stage is a canvas 2D
 * projection with an HTML and SVG HUD: the overview still downloads no WebGL
 * and no planner chunk until a launch key is pointed at.
 */
export function SpatialShowcase() {
  const sectionRef = useRef(null);
  useSectionSpy(sectionRef, SHOWCASE_3D_ID);
  const reveal = useScrollReveal();
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [stage, setStage] = useState({ act: ACTS[0].id, locked: null, preview: null });
  const theatre = useShowcaseTheatre({ stageRef, canvasRef, onAct: setStage });

  const setStageNode = useCallback(
    (node) => {
      stageRef.current = node;
      const release = reveal(node);
      return () => {
        stageRef.current = null;
        release?.();
      };
    },
    [reveal],
  );

  return (
    <section
      ref={sectionRef}
      id={SHOWCASE_3D_ID}
      className="showcase3d container"
      aria-labelledby="showcase3d-title"
      data-testid="home-3d-showcase"
      tabIndex={-1}
    >
      <header ref={reveal} className="section-head showcase3d__head reveal-up">
        <p className="index-label">
          <span className="index-label__num">04</span> / 3D Spatial Studio
        </p>
        <h2 id="showcase3d-title" className="section-head__title showcase3d__title">
          Step inside a four-walled room before a single hole is drilled.
        </h2>
        <p className="section-head__lede">
          The 3D Spatial Studio builds the room to the centimetre, lights it from fixture data and lets you stand in it.
          Plan all four walls, then walk the result at eye level.
        </p>
      </header>

      <div className="showcase3d__rig">
        <Theatre stage={stage} setStageNode={setStageNode} canvasRef={canvasRef} theatre={theatre} />
        <ul className="showcase3d__pillars reveal-stagger">
          {PILLARS.map((pillar) => (
            <Pillar
              key={pillar.index}
              pillar={pillar}
              active={stage.act === pillar.act}
              held={stage.locked === pillar.act}
              theatre={theatre}
            />
          ))}
        </ul>
      </div>

      <Launchpad />
    </section>
  );
}
