import { useEffect, useRef } from 'react';
import { useViewportVideo } from '../hooks/useViewportVideo.js';
import { INTERIOR_VIEW, interiorScene } from '../lib/interior-painter.js';
import { ROOM_MEDIA } from '../lib/media-manifest.js';

/**
 * One 4:5 room: a 2K photograph at rest, its film on hover or focus. The
 * film crossfades in only once it is actually playing (400 ms, the house
 * ease) and rewinds to its first frame, which is the photograph, when the
 * pointer leaves. The luminaire's position lands on the parent as --glow-x
 * and --glow-y for the hover light; data-painted turns "true" once the
 * photograph has decoded. The picture is decorative: the link around it
 * carries the words.
 */
export function InteriorPortrait({ scene }) {
  const ref = useRef(null);
  const videoRef = useRef(null);
  const art = interiorScene(scene);
  const media = ROOM_MEDIA[art.id];
  const { engage, release } = useViewportVideo(videoRef, ref, { mode: 'hover', rewindOnRelease: true });

  useEffect(() => {
    const host = ref.current?.parentElement;
    host?.style.setProperty('--glow-x', `${(art.glow.x * 100).toFixed(1)}%`);
    host?.style.setProperty('--glow-y', `${(art.glow.y * 100).toFixed(1)}%`);
  }, [art]);

  // The whole card is the hover target: the link, its caption and the picture.
  useEffect(() => {
    const card = ref.current?.closest('.entry-card');
    if (!card) return undefined;
    const onLeave = (event) => {
      if (event.type === 'focusout' && card.contains(event.relatedTarget)) return;
      release();
    };
    card.addEventListener('pointerenter', engage);
    card.addEventListener('pointerleave', onLeave);
    card.addEventListener('focusin', engage);
    card.addEventListener('focusout', onLeave);
    return () => {
      card.removeEventListener('pointerenter', engage);
      card.removeEventListener('pointerleave', onLeave);
      card.removeEventListener('focusin', engage);
      card.removeEventListener('focusout', onLeave);
    };
  }, [engage, release]);

  // A photograph already in the cache can finish before React attaches onLoad.
  useEffect(() => {
    const img = ref.current?.querySelector('img');
    if (img?.complete && img.naturalWidth > 0) ref.current.dataset.painted = 'true';
  }, []);

  return (
    <span ref={ref} className="entry-card__picture" data-testid="interior-portrait" data-scene={art.id} data-painted="false" aria-hidden="true">
      <img
        className="entry-card__still"
        src={media.still}
        width={INTERIOR_VIEW.width}
        height={INTERIOR_VIEW.height}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={(event) => {
          event.currentTarget.parentElement.dataset.painted = 'true';
        }}
      />
      <video ref={videoRef} className="entry-card__film" muted loop playsInline preload="metadata" poster={media.still} disablePictureInPicture tabIndex={-1}>
        <source src={media.film.webm} type="video/webm" />
        <source src={media.film.mp4} type="video/mp4" />
      </video>
    </span>
  );
}
