import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { useSectionSpy } from '../hooks/useSectionLink.js';
import { launchHref, LAUNCH_PATH } from '../lib/launch-presets.js';
import { productPhoto } from '../lib/media-manifest.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { SHOWCASE_3D_ID } from '../lib/routes.js';
import { STUDIO_PILLARS } from '../lib/studio-capabilities.js';
import { ArrowRight, PresetEyeGlyph, PresetLoftGlyph, PresetOrbitGlyph } from './icons.jsx';

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

/*
 * The exports pillar shows what the planner exports: a 1:20 elevation of a
 * 320 x 250 cm wall (bench, linear pendant on its wires, floating shelf,
 * corner column, three track spots) with its dimension chains and an ISO
 * title block, drawn in carbon hairlines on the stone sheet. Decorative: the
 * card's own heading and specification carry the words.
 */
function ElevationDrawing() {
  return (
    <svg className="showcase3d__drawing elev" viewBox="0 0 400 300" aria-hidden="true" focusable="false" data-testid="studio-elevation">
      <defs>
        <pattern id="studio-elevation-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="elev__hatch" x1="0" y1="0" x2="0" y2="5" />
        </pattern>
      </defs>
      <rect className="elev__frame" x="12" y="12" width="376" height="276" />
      <text className="elev__label" x="24" y="31">
        NORTH ELEVATION
      </text>
      <text className="elev__note" x="24" y="41">
        WALL 320 x 250 cm / 24V BUS
      </text>

      <rect className="elev__slab-fill" x="52" y="65" width="222" height="8" />
      <rect className="elev__slab-fill" x="52" y="228" width="222" height="8" />
      <path className="elev__slab" d="M52 73H274M52 228H274" />
      <path className="elev__wall" d="M64 73V228M262.4 73V228" />

      <path className="elev__part" d="M105.2 73h4.4v8h-4.4zM161 73h4.4v8H161zM216.8 73h4.4v8h-4.4z" />
      <path className="elev__wire" d="M91.9 73v58.3M172.5 73v58.3" />
      <rect className="elev__lamp" x="85.7" y="131.3" width="93" height="3.7" />
      <path className="elev__beam" d="M85.7 135l-9.3 65.1M178.7 135l9.3 65.1" />
      <rect className="elev__part" x="76.4" y="200.1" width="111.6" height="27.9" />
      <path className="elev__part" d="M104 200.1c1.5-4 14.5-4 16 0zM157 200.1c-3-3-3-11 0-14h4c3 3 3 11 0 14z" />
      <rect className="elev__part" x="184.9" y="123.8" width="68.2" height="5" />
      <path className="elev__part" d="M192 110.5h3.2v13.3H192zM196 112.5h3.2v11.3H196zM239 123.8c-2.5-2-2.5-8 0-10h3c2.5 2 2.5 8 0 10z" />
      <rect className="elev__part" x="254.3" y="141.2" width="7.4" height="86.8" />
      <path className="elev__beam" d="M258 146v78" />

      <path className="elev__dim" d="M64 238v16M262.4 238v16M64 250h198.4M61 253l6-6M259.4 253l6-6" />
      <path className="elev__dim" d="M42 73h8M42 228h8M46 73v155M43 76l6-6M43 231l6-6" />
      <path className="elev__dim" d="M256 128.8h24M270 228h10M276 128.8v99.2M273 131.8l6-6M273 231l6-6" />
      <text className="elev__figure" x="163.2" y="246" textAnchor="middle">
        320
      </text>
      <text className="elev__figure" transform="translate(40 150.5) rotate(-90)" textAnchor="middle">
        250
      </text>
      <text className="elev__figure" transform="translate(286 178.4) rotate(-90)" textAnchor="middle">
        160
      </text>

      <path className="elev__frame" d="M280 246h108v42H280zM280 260h108M280 274h108M334 260v28" />
      <text className="elev__note" x="285" y="255.6">
        LUMEN SPATIAL STUDIO
      </text>
      <text className="elev__note" x="285" y="269.6">
        LMN-BP-01
      </text>
      <text className="elev__note" x="339" y="269.6">
        A3
      </text>
      <text className="elev__note" x="285" y="283.6">
        SCALE 1:20
      </text>
      <text className="elev__note" x="339" y="283.6">
        ISO 7200
      </text>
    </svg>
  );
}

/** One capability: a 4:3 studio picture over its specification, straight on the paper. */
function Pillar({ pillar }) {
  const reveal = useScrollReveal();
  const headingId = `studio-pillar-${pillar.id}-title`;
  const photo = pillar.photo ? productPhoto(pillar.photo.product, pillar.photo.finish) : null;
  return (
    <li ref={reveal} className="showcase3d__cell reveal-up">
      <article className="showcase3d__card" aria-labelledby={headingId} data-testid={`studio-pillar-${pillar.id}`}>
        <div className="showcase3d__figure" data-kind={photo ? 'photo' : 'drawing'}>
          {photo ? (
            <img
              className="showcase3d__photo"
              src={photo.src}
              width={photo.width}
              height={photo.height}
              alt={pillar.photo.alt}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <ElevationDrawing />
          )}
        </div>
        <div className="showcase3d__body">
          <h3 id={headingId} className="showcase3d__name">
            <span className="showcase3d__num">{pillar.index}</span> / {pillar.title}
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
        </div>
      </article>
    </li>
  );
}

/**
 * Overview section for the 3D Spatial Studio: an editorial specification
 * grid on the gallery paper, set like the core modules beneath it. Four
 * capabilities with their figures, then one carbon rule with the launch
 * presets and the matte carbon key into the planner. Plain pictures and SVG:
 * the overview downloads no WebGL and no planner chunk until a launch key is
 * pointed at or focused.
 */
export function SpatialShowcase() {
  const sectionRef = useRef(null);
  useSectionSpy(sectionRef, SHOWCASE_3D_ID);
  const reveal = useScrollReveal();

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

        <ol className="showcase3d__grid reveal-stagger" aria-label="3D Spatial Studio capabilities" data-testid="studio-pillars">
          {STUDIO_PILLARS.map((pillar) => (
            <Pillar key={pillar.id} pillar={pillar} />
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
