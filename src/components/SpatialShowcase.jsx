import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { useSectionSpy } from '../hooks/useSectionLink.js';
import { launchHref, LAUNCH_PATH } from '../lib/launch-presets.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { SHOWCASE_3D_ID } from '../lib/routes.js';
import { STUDIO_PILLARS } from '../lib/studio-capabilities.js';
import { ArrowRight, PresetEyeGlyph, PresetLoftGlyph, PresetOrbitGlyph } from './icons.jsx';
import { XrayStage } from './XrayStage.jsx';

// Quick-launch links: the visible label stays short, the spec rides in the tooltip.
const LAUNCH_PRESETS = Object.freeze([
  {
    id: 'orbit',
    label: '360 Orbit',
    spec: 'Orbit lens / yaw 360 / pitch 5 to 85 deg',
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

/**
 * One capability as a ledger column under the X-ray stage: its figures in
 * hairline rows, no picture. Pointing at a column previews its callouts in
 * the blueprint; choosing it (click, Enter or Space on its heading) pins the
 * highlight and opens the blueprint as far as those callouts.
 */
function LedgerColumn({ pillar, active, pinned, onPreview, onChoose }) {
  const reveal = useScrollReveal();
  const headingId = `studio-pillar-${pillar.id}-title`;
  return (
    <li ref={reveal} className="showcase3d__cell reveal-up">
      <article
        className="showcase3d__card"
        aria-labelledby={headingId}
        data-testid={`studio-pillar-${pillar.id}`}
        data-active={active ? 'true' : undefined}
        onPointerEnter={(event) => event.pointerType === 'mouse' && onPreview(pillar.id)}
        onPointerLeave={(event) => event.pointerType === 'mouse' && onPreview(null)}
        onClick={() => onChoose(pillar.id)}
      >
        <h3 id={headingId} className="showcase3d__name">
          <button
            type="button"
            className="showcase3d__toggle"
            aria-pressed={pinned}
            aria-describedby="studio-ledger-hint"
            data-testid={`studio-pillar-${pillar.id}-toggle`}
            onFocus={() => onPreview(pillar.id)}
            onBlur={() => onPreview(null)}
          >
            <span className="showcase3d__num">{pillar.index}</span> / {pillar.title}
          </button>
        </h3>
        <p className="showcase3d__summary">{pillar.summary}</p>
        <dl className="showcase3d__specs">
          {pillar.specs.map(({ label, value }) => (
            <div key={label} className="showcase3d__spec">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </article>
    </li>
  );
}

/**
 * Overview section for the 3D Spatial Studio, on the gallery paper: one
 * wide X-ray stage (the warm 2K photograph and its 1:20 blueprint in one
 * registration), the four capabilities as an image-free ledger coupled to
 * the blueprint's callouts, then one carbon rule with the launch presets and
 * the matte carbon key into the planner. A picture and SVG only: the
 * overview downloads no WebGL and no planner chunk until a launch key is
 * pointed at or focused.
 */
export function SpatialShowcase() {
  const sectionRef = useRef(null);
  useSectionSpy(sectionRef, SHOWCASE_3D_ID);
  const reveal = useScrollReveal();
  const revealStage = useScrollReveal();
  const xray = useRef(null);
  // A pointed or focused column previews its callouts; a chosen one stays pinned until chosen again.
  const [preview, setPreview] = useState(null);
  const [pinned, setPinned] = useState(null);
  const pinnedRef = useRef(null);
  const focus = preview ?? pinned;
  const choose = useCallback((id) => {
    const next = pinnedRef.current === id ? null : id;
    pinnedRef.current = next;
    setPinned(next);
    if (next) xray.current?.reveal(next);
  }, []);

  return (
    <section
      ref={sectionRef}
      id={SHOWCASE_3D_ID}
      className="showcase3d"
      aria-labelledby="showcase3d-title"
      data-testid="home-3d-showcase"
      tabIndex={-1}
    >
      <div className="container">
        <header ref={reveal} className="section-head reveal-up">
          <p className="index-label">
            <span className="index-label__num">03</span> / 3D Spatial Studio
          </p>
          {/* The compound stays whole, so no line of the title ends on its hyphen. */}
          <h2 id="showcase3d-title" className="section-head__title showcase3d__title">
            Step inside a <span className="showcase3d__keep">four-walled</span> room before a single hole is drilled.
          </h2>
          <p className="section-head__lede">
            The 3D Spatial Studio builds the room to the centimetre, lights it from fixture data and lets you stand in
            it. Plan all four walls, then walk the result at eye level.
          </p>
        </header>

        <div ref={revealStage} className="showcase3d__instrument reveal-up" data-testid="studio-instrument">
          <XrayStage focus={focus} apiRef={xray} />
        </div>
        <p id="studio-ledger-hint" className="visually-hidden">
          Highlights its callouts in the blueprint above.
        </p>
        <ol className="showcase3d__grid reveal-stagger" aria-label="3D Spatial Studio capabilities" data-testid="studio-pillars">
          {STUDIO_PILLARS.map((pillar) => (
            <LedgerColumn
              key={pillar.id}
              pillar={pillar}
              active={focus === pillar.id}
              pinned={pinned === pillar.id}
              onPreview={setPreview}
              onChoose={choose}
            />
          ))}
        </ol>

        <div ref={reveal} className="showcase3d__foot reveal-up" data-testid="showcase-launchpad">
          <div className="showcase3d__launch">
            <p className="index-label showcase3d__launch-label">Launch presets</p>
            <ul className="showcase3d__presets" aria-label="Quick launch presets">
              {LAUNCH_PRESETS.map(({ id, label, spec, to, Glyph }) => (
                <li key={id}>
                  <Link
                    to={to}
                    className="showcase3d__preset"
                    data-testid={`launch-preset-${id}`}
                    title={spec}
                    onPointerEnter={warmPlanner}
                    onFocus={warmPlanner}
                  >
                    <span className="showcase3d__preset-glyph">
                      <Glyph />
                    </span>
                    <span className="showcase3d__preset-label">
                      <span className="visually-hidden">Launch </span>
                      {label}
                    </span>
                    <ArrowRight className="showcase3d__preset-arrow" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <Link
            to={LAUNCH_PATH}
            className="button button--primary showcase3d__cta"
            data-testid="launch-3d-studio-cta"
            onPointerEnter={warmPlanner}
            onFocus={warmPlanner}
          >
            Open 3D Room Planner
            <ArrowRight />
          </Link>
        </div>
      </div>
    </section>
  );
}
