import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/icons.jsx';
import { InteriorPortrait } from '../components/InteriorPortrait.jsx';
import { MeetOurIconsCinema } from '../components/MeetOurIconsCinema.jsx';
import { ProductCard } from '../components/ProductCard.jsx';
import { SpatialShowcase } from '../components/SpatialShowcase.jsx';
import { SurfaceLab } from '../components/SurfaceLab.jsx';
import { CATEGORIES, PRODUCTS } from '../data/products.js';
import { useAmbientLight } from '../hooks/useAmbientLight.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useOffscreenPause } from '../hooks/useOffscreenPause.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { useSectionArrival, useSectionSpy } from '../hooks/useSectionLink.js';
import { padIndex } from '../lib/format.js';
import { INTERIOR_SCENES } from '../lib/interior-painter.js';
import { CORE_MODULES_ID, SHOWCASE_3D_ID, WORKSPACES_ID } from '../lib/routes.js';
import '../styles/home.css';

const FLAGSHIPS = PRODUCTS.flatMap((product, i) => (product.flagship ? [{ product, index: i + 1 }] : []));

const SPECS = [
  { value: '24V DC Modular Bus', detail: 'Class 2 SELV / hot-swap nodes' },
  { value: 'CRI 97+ Warm LED', detail: '2700K / R9 > 90 / flicker-free' },
  { value: 'FSC Walnut & Anodized Aluminum', detail: 'Oiled solid walnut / 6063-T5' },
];

// Same order and indices as the navbar, which the overview scrolls through left
// to right. Each workspace opens on a room: dining and living for the planner,
// a bedroom for the catalog, a studio wall for the elevation studio.
const ENTRIES = [
  {
    to: '/room-3d',
    index: '02',
    section: '3D Room',
    title: 'Room Planner',
    body: 'Place fixtures in a dimensioned room and read light falloff before anything is drilled.',
    scene: INTERIOR_SCENES.dining,
  },
  {
    to: '/catalog',
    index: '03',
    section: 'Catalog',
    title: 'Catalog',
    body: 'Pendants, wall rails, shelving and drivers, specified by finish, output and mounting.',
    scene: INTERIOR_SCENES.bedroom,
  },
  {
    to: '/studio-2d',
    index: '04',
    section: 'Wall Studio',
    title: 'Wall Studio',
    body: 'Compose shelves, lights and panels on a to-scale elevation, check clearances, send the parts list to the cart.',
    scene: INTERIOR_SCENES.studio,
  },
];

// The two evening atmospheres the hero wall breathes between, 6.5 s apiece.
const ATMOSPHERES = [
  { id: 'venetian', label: 'Warm Venetian Plaster / 2700K' },
  { id: 'limestone', label: 'Soft Limestone Evening Wash / 2400K' },
];

const ARRIVAL_SECTIONS = Object.freeze([SHOWCASE_3D_ID]);

function AmbientHero() {
  const surfaceRef = useRef(null);
  const readoutRef = useRef(null);
  useAmbientLight(surfaceRef, readoutRef);
  useOffscreenPause(surfaceRef);

  return (
    <section
      ref={surfaceRef}
      className="hero optical"
      data-testid="ambient-surface"
      data-atmospheres={ATMOSPHERES.map((atmosphere) => atmosphere.id).join(' ')}
      aria-labelledby="hero-title"
    >
      {/* A full-bleed Venetian plaster wall in evening light. Two atmospheres
          crossfade on the compositor while the pendant answers the pointer. */}
      <div className="hero__layers" aria-hidden="true">
        <div className="hero__plaster hero__plaster--venetian" />
        <div className="hero__plaster hero__plaster--limestone" />
        <div className="hero__relief" />
        <div className="hero__wash" />
        <div className="hero__wash hero__wash--evening" />
        <div className="hero__scrim" />
        <div className="hero__rail" />
        <div className="hero__crosshair hero__crosshair--x tech-only" />
        <div className="hero__crosshair hero__crosshair--y tech-only" />
        <div className="hero__pendant">
          <span className="hero__carriage" />
          <span className="hero__cable" />
          <span className="hero__lamp" />
        </div>
      </div>

      <p className="hero__tag mono" aria-hidden="true">
        <span>Track T-24 / Pendant P-1</span>
        <span className="hero__atmosphere">
          {ATMOSPHERES.map(({ id, label }) => (
            <span key={id} className={`hero__atmosphere-name hero__atmosphere-name--${id}`}>
              {label}
            </span>
          ))}
        </span>
      </p>

      <div className="hero__content" data-testid="hero-copy">
        {/* The slash stays on the line it closes, so a narrow wrap never
            opens a line with it. */}
        <p className="hero__attribution" data-testid="hero-attribution">
          Architectural Lighting &amp; Modular{' '}
          <span className="hero__attribution-keep">
            Systems
            <span className="hero__attribution-rule" aria-hidden="true">
              /
            </span>
          </span>{' '}
          24V&nbsp;DC
        </p>
        <h1 id="hero-title" className="hero__title">
          Light and storage on one modular spine.
        </h1>
        <p className="hero__lede">
          Pendants, wall rails and shelving share a single 24V DC bus. Plan a room in 3D, compose a
          wall in 2D, then order the exact bill of materials.
        </p>
        <div className="hero__actions">
          <Link to="/catalog" className="button button--primary">
            Browse catalog
            <ArrowRight />
          </Link>
          <Link to="/room-3d" className="bracket-cta bracket-cta--light hero__bracket" data-testid="hero-room-planner">
            Open Room Planner
          </Link>
        </div>
      </div>

      <p className="hero__readout mono" aria-hidden="true">
        <span className="hero__readout-label">Light</span>
        <span ref={readoutRef} />
      </p>
    </section>
  );
}

function SectionHead({ index, section, titleId, title, lede }) {
  const reveal = useScrollReveal();
  return (
    <header ref={reveal} className="section-head reveal-up">
      <p className="index-label">
        <span className="index-label__num">{index}</span> / {section}
      </p>
      <h2 id={titleId} className="section-head__title">
        {title}
      </h2>
      {lede && <p className="section-head__lede">{lede}</p>}
    </header>
  );
}

function ExploreHome({ sectionRef }) {
  const reveal = useScrollReveal();
  return (
    <section
      ref={sectionRef}
      id={WORKSPACES_ID}
      className="entries explore container"
      aria-labelledby="entries-title"
      data-testid="workspaces"
    >
      <SectionHead
        index="05"
        section="Workspaces"
        titleId="entries-title"
        title="Explore the Lumen home"
        lede="Start from a room, a part or a wall. Every workspace draws on one parts index and one 24V bus, so a room, a wall and a cart always agree on the bill of materials."
      />

      <ul className="entries__grid explore__trio reveal-stagger">
        {ENTRIES.map(({ to, index, section, title, body, scene }) => (
          <li key={to} ref={reveal} className="explore__cell reveal-up">
            <Link to={to} className="entry-card">
              <span className="entry-card__portrait" data-scene={scene.id}>
                <InteriorPortrait scene={scene.id} />
                <span className="entry-card__glow" aria-hidden="true" />
                <span className="entry-card__room" aria-hidden="true">
                  {scene.label}
                </span>
              </span>
              <span className="entry-card__caption">
                <span className="index-label">
                  <span className="index-label__num">{index}</span> / {section}
                </span>
                <span className="entry-card__title">{title}</span>
                <span className="entry-card__body">{body}</span>
                <span className="entry-card__cta mono">
                  Enter
                  <ArrowRight />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div ref={reveal} className="manifesto reveal-up" data-testid="culture-of-light">
        <h3 className="manifesto__title">A culture of light</h3>
        <p className="manifesto__body">
          Light is the first material of a room. We draw it from measured fixture data, carry it on one quiet
          24V spine and let it fall on oak, plaster and stone exactly as specified. Nothing is decorative until
          it is useful, and nothing is useful until it can be serviced for decades.
        </p>
      </div>
    </section>
  );
}

export default function HomePage() {
  useDocumentTitle(null);
  useSectionArrival(ARRIVAL_SECTIONS);
  const reveal = useScrollReveal();
  const modulesRef = useRef(null);
  const workspacesRef = useRef(null);
  useSectionSpy(modulesRef, CORE_MODULES_ID);
  useSectionSpy(workspacesRef, WORKSPACES_ID);

  return (
    <>
      <AmbientHero />

      {/* Below the hero the overview alternates calm paper with full-bleed
          architectural bands: a ledger strip, the icons film, the travertine
          dimming bench, the twilight theatre, plaster plinths and the rooms. */}
      <div className="home-atmosphere" data-testid="home-atmosphere">
        <section className="spec-strip" aria-label="System specification">
          <dl className="spec-strip__grid container reveal-stagger">
            {SPECS.map((spec, i) => (
              <div key={spec.value} ref={reveal} className="spec-strip__item reveal-up">
                <dt className="spec-strip__value">
                  <span className="spec-strip__index mono" aria-hidden="true">
                    {padIndex(i + 1)}
                  </span>
                  {spec.value}
                </dt>
                <dd className="spec-strip__detail mono">{spec.detail}</dd>
              </div>
            ))}
          </dl>
        </section>

        <MeetOurIconsCinema />

        <section className="lab band band--travertine" aria-labelledby="lab-title" data-testid="surface-lab">
          <div className="container">
            <SectionHead
              index="02"
              section="Surface & Dimming Lab"
              titleId="lab-title"
              title="Read a finish under real light before it is specified."
              lede="One LED channel on the 24V bus, a dimmer, three colour temperatures and four production finishes. Load, output and reflected light are calculated from fixture data as you adjust them."
            />
            <div ref={reveal} className="reveal-cinematic">
              <SurfaceLab />
            </div>
          </div>
        </section>

        <SpatialShowcase />

        <section
          ref={modulesRef}
          id={CORE_MODULES_ID}
          className="modules container"
          aria-labelledby="modules-title"
          data-testid="core-modules"
        >
          <SectionHead
            index="04"
            section="Core Modules"
            titleId="modules-title"
            title="Three modules that anchor most walls."
            lede="A lit shelf, a corner column and an acoustic frame. Each mounts to the same bus and ships in the same four finishes."
          />
          <ul className="modules__grid reveal-stagger">
            {FLAGSHIPS.map(({ product, index }) => (
              <li key={product.id} className="modules__cell">
                <ProductCard product={product} index={index} />
              </li>
            ))}
          </ul>
          <div ref={reveal} className="modules__foot reveal-up">
            <p className="modules__count mono">
              {padIndex(PRODUCTS.length)} modules / {padIndex(CATEGORIES.length)} families / one 24V bus
            </p>
            <Link to="/catalog" className="button">
              Explore Full Catalog
              <ArrowRight />
            </Link>
          </div>
        </section>

        <ExploreHome sectionRef={workspacesRef} />
      </div>
    </>
  );
}
