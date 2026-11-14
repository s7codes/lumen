import { memo, useEffect, useRef, useState } from 'react';
import { CATALOG_SIZE, productPhoto } from '../lib/media-manifest.js';

/** Warms the browser cache with a finish's photograph before its swatch is picked. */
export function preloadProductPhoto(productId, finishId) {
  const photo = productPhoto(productId, finishId);
  if (!photo || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.src = photo.src;
}

/**
 * The studio photograph of one catalog part: a 1600 x 1200 path-traced still
 * of the planner's own model in the corner of a daylight gallery room, its
 * 2700K channel on where it has one. Every finish shown so far stays mounted
 * as a layer; a newly picked finish crossfades in over the last one only
 * once its photograph has decoded, so a swatch never flashes the bare wall.
 */
export const ProductVisual = memo(function ProductVisual({ product, finish, className = 'pv' }) {
  const photo = productPhoto(product.id, finish.id);
  const [layers, setLayers] = useState(() => [photo.finish]);
  const [shown, setShown] = useState(null);
  const wanted = useRef(photo.finish);
  wanted.current = photo.finish;
  const rootRef = useRef(null);

  useEffect(() => {
    setLayers((current) => (current.includes(photo.finish) ? current : [...current, photo.finish]));
  }, [photo.finish]);

  // A photograph already decoded (cached, or loaded before this finish was picked) shows at once.
  useEffect(() => {
    const img = rootRef.current?.querySelector(`img[data-finish="${CSS.escape(photo.finish)}"]`);
    if (img?.complete && img.naturalWidth > 0) setShown(photo.finish);
  }, [photo.finish, layers]);

  const { w, h } = product.dimsCm;
  const lit = product.watts > 0;
  const label = `${product.name} in ${finish.name}, ${w} x ${h} cm, shown in a daylight gallery interior${lit ? ' with its 2700K light on' : ''}`;

  return (
    <div
      ref={rootRef}
      className={className}
      role="img"
      aria-label={label}
      data-testid="product-visual"
      data-shape={product.shape}
      data-lit={lit ? 'true' : 'false'}
      data-finish={photo.finish}
      data-shown={shown ?? undefined}
    >
      {layers.map((id) => {
        const src = productPhoto(product.id, id).src;
        return (
          <img
            key={id}
            className="pv__photo"
            src={src}
            width={CATALOG_SIZE.width}
            height={CATALOG_SIZE.height}
            alt=""
            loading="lazy"
            decoding="async"
            data-finish={id}
            data-visible={id === shown || undefined}
            onLoad={() => {
              if (id === wanted.current) setShown(id);
            }}
          />
        );
      })}
    </div>
  );
});
