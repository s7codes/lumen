import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useIconsReel } from '../hooks/useIconsReel.js';
import { ICON_REEL } from '../lib/icons-reel.js';
import { ICONS_MEDIA } from '../lib/media-manifest.js';

const REEL_ID = 'icons-reel';

/**
 * Meet our Icons: a full-bleed cinema reel across the overview. Three 2.4:1
 * films (the dome lamp on travertine, the Linear Pendant 150 on its track
 * spine, the Floor Column 140 among plaster scallops) hold the banner for
 * 3 s each and crossfade on a 9 s loop, under the centred title and its
 * bracketed key. A hairline rail of three keys shows the 3 s progression
 * and jumps to any icon. Plain <video>: the overview still loads no WebGL.
 */
export function MeetOurIconsCinema() {
  const sectionRef = useRef(null);
  const [index, setIndex] = useState(0);
  const reel = useIconsReel({ sectionRef, onIndex: setIndex });
  const current = ICON_REEL[index] ?? ICON_REEL[0];

  return (
    <section
      ref={sectionRef}
      className="cinema"
      aria-labelledby="cinema-title"
      data-testid="icons-cinema"
      data-icon={current.id}
      data-playing="false"
    >
      <div id={REEL_ID} className="cinema__reel" data-testid="icons-reel" role="img" aria-label={`Film ${current.index} of ${ICON_REEL.length}: ${current.caption}`}>
        {ICON_REEL.map((icon, i) => {
          const media = ICONS_MEDIA[icon.id];
          return (
            <video
              key={icon.id}
              className="cinema__film"
              data-reel={icon.id}
              data-testid={`icons-film-${icon.id}`}
              data-active={i === index || undefined}
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
      <div className="cinema__keys" role="group" aria-label="Icons in the reel" data-testid="icons-keys">
        {ICON_REEL.map((icon, i) => (
          <button
            key={icon.id}
            type="button"
            className="cinema__key"
            aria-pressed={i === index}
            aria-controls={REEL_ID}
            aria-label={`${icon.index} ${icon.label}`}
            data-active={i === index || undefined}
            data-testid={`icons-key-${icon.id}`}
            onClick={() => reel.current?.pick(i)}
          >
            <span className="cinema__key-head" aria-hidden="true">
              <span className="cinema__key-index">{icon.index}</span>
              <span className="cinema__key-label">{icon.label}</span>
            </span>
            <span className="cinema__key-track" aria-hidden="true">
              <span className="cinema__key-fill" data-key-fill={icon.id} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
