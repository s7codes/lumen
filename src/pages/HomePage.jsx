import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CatalogGlyph, RoomGlyph, WallGlyph } from '../components/icons.jsx';
import { ProductCard } from '../components/ProductCard.jsx';
import { SurfaceLab } from '../components/SurfaceLab.jsx';
import { CATEGORIES, PRODUCTS } from '../data/products.js';
import { useAmbientLight } from '../hooks/useAmbientLight.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { padIndex } from '../lib/format.js';
import '../styles/home.css';

const FLAGSHIPS = PRODUCTS.flatMap((product, i) => (product.flagship ? [{ product, index: i + 1 }] : []));

const SPECS = [
  { value: '24V DC Modular Bus', detail: 'Class 2 SELV / hot-swap nodes' },
  { value: 'CRI 97+ Warm LED', detail: '2700K / R9 > 90 / flicker-free' },
  { value: 'FSC Walnut & Anodized Aluminum', detail: 'Oiled solid walnut / 6063-T5' },
];

const ENTRIES = [
  {
    to: '/catalog',
    index: '02',
    section: 'Catalog',
    title: 'Catalog',
    body: 'Pendants, wall rails, shelving and drivers, specified by finish, output and mounting.',
    Glyph: CatalogGlyph,
  },
  {
    to: '/room-3d',
    index: '03',
    section: '3D Room',
    title: 'Room Planner',
    body: 'Place fixtures in a dimensioned room and read light falloff before anything is drilled.',
    Glyph: RoomGlyph,
  },
  {
    to: '/studio-2d',
    index: '04',
    section: 'Wall Studio',
    title: 'Wall Studio',
    body: 'Compose shelves, lights and panels on a to-scale elevation, check clearances, send the parts list to the bag.',
    Glyph: WallGlyph,
  },
];

function AmbientHero() {
  const surfaceRef = useRef(null);
  const readoutRef = useRef(null);
  useAmbientLight(surfaceRef, readoutRef);

  return (
    <section ref={surfaceRef} className="hero" data-testid="ambient-surface" aria-labelledby="hero-title">
      <div className="hero__layers" aria-hidden="true">
        <div className="hero__ribs" />
        <div className="hero__wash" />
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
        Track T-24 / Pendant P-1 / 2700K
      </p>

      <div className="hero__content container">
        <p className="index-label">
          <span className="index-label__num">01</span> / Overview
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
          <Link to="/room-3d" className="button">
            Open room planner
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
      <span className="section-head__rule" aria-hidden="true" />
    </header>
  );
}

export default function HomePage() {
  useDocumentTitle(null);
  const reveal = useScrollReveal();

  return (
    <>
      <AmbientHero />

      <section className="spec-strip" aria-label="System specification">
        <dl className="spec-strip__grid container reveal-stagger">
          {SPECS.map((spec, i) => (
            <div key={spec.value} ref={reveal} className="spec-strip__item reveal-up">
              <dt className="index-label">
                <span className="index-label__num">Spec</span> {String(i + 1).padStart(2, '0')}
              </dt>
              <dd className="spec-strip__value">{spec.value}</dd>
              <dd className="spec-strip__detail mono">{spec.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="lab container" aria-labelledby="lab-title" data-testid="surface-lab">
        <SectionHead
          index="02"
          section="Surface & Dimming Lab"
          titleId="lab-title"
          title="Read a finish under real light before it is specified."
          lede="One LED channel on the 24V bus, a dimmer, three colour temperatures and four production finishes. Load, output and reflected light are calculated from fixture data as you adjust them."
        />
        <div ref={reveal} className="reveal-up">
          <SurfaceLab />
        </div>
      </section>

      <section className="modules container" aria-labelledby="modules-title" data-testid="core-modules">
        <SectionHead
          index="03"
          section="Core Modules"
          titleId="modules-title"
          title="Three modules that anchor most walls."
          lede="A lit shelf, a corner column and an acoustic frame. Each mounts to the same bus and ships in the same four finishes."
        />
        <ul className="modules__grid reveal-stagger">
          {FLAGSHIPS.map(({ product, index }) => (
            <li key={product.id} ref={reveal} className="modules__cell reveal-up">
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

      <section className="entries container" aria-labelledby="entries-title">
        <header ref={reveal} className="entries__head reveal-up">
          <p className="index-label">
            <span className="index-label__num">04</span> / Workspaces
          </p>
          <h2 id="entries-title" className="entries__title">
            Start from a part, a room or a wall.
          </h2>
        </header>

        <ul className="entries__grid reveal-stagger">
          {ENTRIES.map(({ to, index, section, title, body, Glyph }) => (
            <li key={to} ref={reveal} className="reveal-up">
              <Link to={to} className="entry-card">
                <span className="index-label">
                  <span className="index-label__num">{index}</span> / {section}
                </span>
                <span className="entry-card__glyph">
                  <Glyph />
                </span>
                <span className="entry-card__title">{title}</span>
                <span className="entry-card__body">{body}</span>
                <span className="entry-card__cta mono">
                  Enter
                  <ArrowRight />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
