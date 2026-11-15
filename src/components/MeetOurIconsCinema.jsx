import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useIconsReel } from '../hooks/useIconsReel.js';
import { ICON_REEL } from '../lib/icons-reel.js';
import { ICONS_MEDIA } from '../lib/media-manifest.js';

const REEL_LABEL = `Three films of light in architecture: ${ICON_REEL.map((icon) => icon.caption).join(' ')}`;

/**
 * Meet our Icons: a full-bleed cinema reel across the overview. Three camera
 * films (a timber wave pendant, low sun across sculpted plaster, a step light
 * on an oiled timber stair) hold the banner for 3 s each and crossfade on a
 * 9 s loop. The only words over them are the centred title and its bracketed
 * key. Plain <video>: the overview still loads no WebGL. The first film is
 * marked on screen at render; useIconsReel moves the mark from then on.
 */
export function MeetOurIconsCinema() {
  const sectionRef = useRef(null);
  useIconsReel(sectionRef);

  return (
    <section
      ref={sectionRef}
      className="cinema"
      aria-labelledby="cinema-title"
      data-testid="icons-cinema"
      data-icon={ICON_REEL[0].id}
      data-playing="false"
    >
      <div className="cinema__reel" data-testid="icons-reel" role="img" aria-label={REEL_LABEL}>
        {ICON_REEL.map((icon, i) => {
          const media = ICONS_MEDIA[icon.id];
          return (
            <video
              key={icon.id}
              className="cinema__film"
              data-reel={icon.id}
              data-testid={`icons-film-${icon.id}`}
              data-active={i === 0 || undefined}
              data-poster={media.poster}
              muted
              loop
              playsInline
              preload="none"
              disablePictureInPicture
              tabIndex={-1}
              aria-hidden="true"
            >
              <source src={media.film.webm} type="video/webm" />
              <source src={media.film.mp4} type="video/mp4" />
            </video>
          );
        })}
      </div>
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
