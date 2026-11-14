import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { useSectionSpy } from '../hooks/useSectionLink.js';
import { useShowcaseTheatre } from '../hooks/useShowcaseTheatre.js';
import { launchHref, LAUNCH_PATH } from '../lib/launch-presets.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { SHOWCASE_3D_ID } from '../lib/routes.js';
import { ACTS, STAGE_ROOM } from '../lib/showcase-scene.js';
import { ArrowRight, CubeGlyph, PresetEyeGlyph, PresetGizmoGlyph, PresetLoftGlyph, PresetOrbitGlyph } from './icons.jsx';

const STAGE_ID = 'showcase3d-stage';
const ROOM_LABEL = `${STAGE_ROOM.label} / ${STAGE_ROOM.widthCm} x ${STAGE_ROOM.depthCm} x ${STAGE_ROOM.heightCm} cm`;

const PILLARS = Object.freeze([
  {
    act: 'orbit',
    index: '01',
    title: '360-Degree Four-Wall Envelope',
    summary: 'Circle every wall of the room, from floor level up to plan view.',
    chips: ['Full 360-Degree Orbit', 'Up to 9 x 9 m Loft'],
    Glyph: PresetOrbitGlyph,
  },
  {
    act: 'inside',
    index: '02',
    title: '165 cm Eye-Level Walkthrough',
    summary: 'Stand where you will stand, and read the light at your eye.',
    chips: ['165 cm Eye Height', 'Live Eye Lux'],
    Glyph: PresetEyeGlyph,
  },
  {
    act: 'gizmo',
    index: '03',
    title: 'Direct 3D Raycast & Gizmo',
    summary: 'Take any module and slide it along the wall under your cursor.',
    chips: ['5 cm Grid Snap', 'X and Y Axis Locks'],
    Glyph: PresetGizmoGlyph,
  },
]);

// Compact quick-launch keys: the visible label stays short, the spec rides in the tooltip.
const LAUNCH_PRESETS = Object.freeze([
  {
    id: 'orbit',
    label: '360 Orbit',
    spec: 'Orbit cutaway / yaw 360 / pitch 5-85 deg',
    to: launchHref({ lens: 'orbit' }),
    Glyph: PresetOrbitGlyph,
  },
  {
    id: 'inside',
    label: '165 cm Eye Level',
    spec: 'Inside lens / eye 165 cm / FOV 78 deg',
    to: launchHref({ lens: 'inside' }),
    Glyph: PresetEyeGlyph,
  },
  {
    id: 'loft',
    label: 'Grand Loft',
    spec: 'Grand Loft 800 x 650 x 340 cm / eye level',
    to: launchHref({ scale: 'loft', lens: 'inside' }),
    Glyph: PresetLoftGlyph,
  },
]);

const warmPlanner = () => prefetchRoute(LAUNCH_PATH);

function hoverIntent(event) {
  return event.pointerType !== 'touch';
}

/** One row of the capability index: hovering previews its act, a click holds it. */
function Pillar({ pillar, active, held, theatre }) {
  const reveal = useScrollReveal();
  const { act, Glyph } = pillar;
  return (
    <li ref={reveal} className="showcase3d__pillar-cell reveal-up">
      <article
        className="showcase3d__pillar"
        data-active={active || undefined}
        data-testid={`showcase-pillar-${act}`}
        onPointerEnter={(event) => hoverIntent(event) && theatre.current?.preview(act)}
        onPointerLeave={() => theatre.current?.endPreview(act)}
        onClick={() => theatre.current?.pick(act)}
      >
        <div className="showcase3d__pillar-top" aria-hidden="true">
          <span className="showcase3d__pillar-index mono">{pillar.index}</span>
          <span className="showcase3d__pillar-badge">
            <Glyph />
          </span>
        </div>
        <h3 className="showcase3d__pillar-title">
          <button type="button" className="showcase3d__pillar-key" aria-pressed={held} aria-controls={STAGE_ID}>
            {pillar.title}
          </button>
        </h3>
        <p className="showcase3d__pillar-body" data-testid="showcase-pillar-summary">
          {pillar.summary}
        </p>
        <ul className="showcase3d__pillar-chips" aria-label={`${pillar.title} key figures`}>
          {pillar.chips.map((chip) => (
            <li key={chip} className="showcase3d__pillar-chip mono" data-testid="showcase-pillar-chip">
              {chip}
            </li>
          ))}
        </ul>
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
      className="showcase3d__stage optical reveal-cinematic"
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

/*
 * A light trace on the key's square perimeter. Each rect has pathLength 100,
 * so a dash is a share of the perimeter at any key width and the ribbon moves
 * at one even speed round the long and short edges alike; the trail and the
 * head share their leading edge, which tapers the ribbon toward its tail.
 */
function CtaBorderBeam() {
  return (
    <svg className="launchpad__cta-beam" data-testid="cta-border-beam" aria-hidden="true" focusable="false">
      <rect className="launchpad__cta-beam-trail" width="100%" height="100%" pathLength="100" />
      <rect className="launchpad__cta-beam-head" width="100%" height="100%" pathLength="100" />
    </svg>
  );
}

/*
 * The launch bar: one hairline footer bar under the theatre and its index
 * (headline, quick-launch keys, the studio key), so a single button never
 * sits in a cavernous box. Every key stays anchored on hover: the surface
 * deepens and only its arrow travels.
 */
function Launchpad() {
  const reveal = useScrollReveal();
  return (
    <div ref={reveal} className="launchpad reveal-up" data-testid="showcase-launchpad">
      <h3 className="launchpad__title">Step inside the 3D Spatial Workstation.</h3>

      <ul className="launchpad__presets" aria-label="Quick launch presets">
        {LAUNCH_PRESETS.map(({ id, label, spec, to, Glyph }) => (
          <li key={id}>
            <Link
              to={to}
              className="launchpad__preset"
              data-testid={`launch-preset-${id}`}
              title={spec}
              onPointerEnter={warmPlanner}
              onFocus={warmPlanner}
            >
              <span className="launchpad__preset-glyph">
                <Glyph />
              </span>
              <span className="launchpad__preset-title">
                <span className="visually-hidden">Launch </span>
                {label}
              </span>
              <ArrowRight className="launchpad__preset-arrow" />
            </Link>
          </li>
        ))}
      </ul>

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
        <CtaBorderBeam />
      </Link>
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
      className="showcase3d optical"
      aria-labelledby="showcase3d-title"
      data-testid="home-3d-showcase"
      tabIndex={-1}
    >
      {/* Nocturne: a full-bleed twilight band of slate wall and warm concrete
          wash. The theatre, its act keys and the launch bar sit on the grid. */}
      <div className="showcase3d__inner container">
        <header ref={reveal} className="section-head showcase3d__head reveal-up">
          <p className="index-label">
            <span className="index-label__num">03</span> / 3D Spatial Studio
          </p>
          <h2 id="showcase3d-title" className="section-head__title showcase3d__title">
            Step inside a four-walled room before a single hole is drilled.
          </h2>
          <p className="section-head__lede">
            The 3D Spatial Studio builds the room to the centimetre, lights it from fixture data and lets you stand in
            it. Plan all four walls, then walk the result at eye level.
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
      </div>
    </section>
  );
}
