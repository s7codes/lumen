import { useCallback, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getProduct } from '../data/products.js';
import { useViewportVideo } from '../hooks/useViewportVideo.js';
import { HERO_FRAME, HERO_HOTSPOTS, HERO_SCENES } from '../lib/hero-scenes.js';
import { HERO_MEDIA } from '../lib/media-manifest.js';

/**
 * One scene: the 2K still (the LCP picture for the daylight scene) under a
 * film of the room's own light. The film is muted, looped and plays only on
 * screen; it fades in once it is actually playing, so the still is all a slow
 * network or a reduced-motion visitor ever sees. The film's poster is the
 * still the picture already chose, so no second photograph is fetched.
 */
function HeroScene({ scene, priority }) {
  const media = HERO_MEDIA[scene.id];
  const layerRef = useRef(null);
  const videoRef = useRef(null);
  useViewportVideo(videoRef, layerRef, { mode: 'auto' });

  const onStill = useCallback((event) => {
    const video = videoRef.current;
    const src = event.currentTarget.currentSrc;
    if (video && src && video.getAttribute('poster') !== src) video.setAttribute('poster', src);
  }, []);

  // A still already decoded from the cache fires no load event after hydration.
  useEffect(() => {
    const img = layerRef.current?.querySelector('img');
    if (img?.complete && img.currentSrc) onStill({ currentTarget: img });
  }, [onStill]);

  return (
    <div ref={layerRef} className={`hero-scene hero-scene--${scene.id}`} data-scene={scene.id} data-testid={`hero-scene-${scene.id}`}>
      <picture className="hero-scene__picture">
        <img
          className="hero-scene__still"
          srcSet={media.srcSet}
          sizes="(orientation: portrait) 180vh, 100vw"
          src={media.still[2560]}
          width={HERO_FRAME.width}
          height={HERO_FRAME.height}
          alt=""
          decoding="async"
          loading="eager"
          fetchPriority={priority ? 'high' : 'low'}
          onLoad={onStill}
        />
      </picture>
      <video
        ref={videoRef}
        className="hero-scene__film"
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
    </div>
  );
}

/** Both hero rooms, stacked: the warm scene crossfades over daylight on the CSS clock or the switcher. */
export function HeroScenes() {
  return (
    <div className="hero__stage" aria-hidden="true">
      <div className="hero__frame">
        {HERO_SCENES.map((scene, i) => (
          <HeroScene key={scene.id} scene={scene} priority={i === 0} />
        ))}
      </div>
    </div>
  );
}

/**
 * The fixtures in the photograph, each a square key placed on its own
 * fixture. Hover or focus opens a hairline callout with the part, a spec
 * line and a link to its page. The layer shares the stage's cover frame, so
 * a key never drifts off its fixture at any crop.
 */
export function HeroHotspots() {
  const uid = useId();
  return (
    <div className="hero__hotspots" data-testid="hero-hotspots">
      <div className="hero__frame">
        <ul className="hero__hotspot-list" aria-label="Fixtures in this room">
          {HERO_HOTSPOTS.map((spot) => {
            const product = getProduct(spot.productId);
            const callout = `${uid}-${spot.id}`;
            return (
              <li
                key={spot.id}
                className="hero-hotspot"
                data-hotspot={spot.id}
                data-testid={`hero-hotspot-${spot.id}`}
                data-callout={spot.y < 0.3 ? 'below' : 'above'}
                data-align={spot.x > 0.84 ? 'end' : 'center'}
                style={{ '--x': `${(spot.x * 100).toFixed(2)}%`, '--y': `${(spot.y * 100).toFixed(2)}%` }}
              >
                <Link to={`/catalog/${product.id}`} className="hero-hotspot__key" aria-describedby={callout}>
                  <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                    <path d="M6 1.5v9M1.5 6h9" />
                  </svg>
                  <span className="visually-hidden">{product.name}</span>
                </Link>
                <span className="hero-hotspot__callout" id={callout} role="tooltip">
                  <span className="hero-hotspot__name">{product.name}</span>
                  <span className="hero-hotspot__detail mono">{spot.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
