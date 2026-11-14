import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useIconsCinema } from '../hooks/useIconsCinema.js';
import { CINEMA_ACTS } from '../lib/icons-cinema.js';

const FIRST = CINEMA_ACTS[0];

/**
 * Meet our Icons: a full-bleed procedural film across the overview. A Canvas
 * 2D loop sweeps a macro camera through three cross-dissolving acts (the
 * obsidian dome on its travertine column, the triple-aperture diffuser and a
 * matte black 24V track whose brass louvers and glass cylinder spot sweep a
 * 2700K beam across dark veined marble), with only a calm editorial title and
 * a bracketed key over it. Pure 2D: the overview still loads no WebGL.
 */
export function MeetOurIconsCinema() {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  useIconsCinema(sectionRef, canvasRef);

  return (
    <section
      ref={sectionRef}
      className="cinema"
      aria-labelledby="cinema-title"
      data-testid="icons-cinema"
      data-act={FIRST.id}
      data-playing="false"
    >
      <canvas
        ref={canvasRef}
        className="cinema__canvas"
        data-testid="icons-cinema-canvas"
        role="img"
        aria-label="A looping macro film of three Lumen icons: a glossy obsidian dome over a travertine column, a triple-aperture diffuser with three 2700K lenses, and a matte black 24V track with brushed brass louvers and a glass cylinder spot sweeping a 2700K beam across dark veined marble and brushed metal."
      />
      <div className="cinema__veil" aria-hidden="true" />
      <div className="cinema__copy">
        <h2 id="cinema-title" className="cinema__title">
          Meet our Icons
        </h2>
        <Link to="/catalog" className="bracket-cta bracket-cta--light cinema__cta" data-testid="icons-discover-more">
          Discover More
        </Link>
      </div>
    </section>
  );
}
