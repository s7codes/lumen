import { FINISH_IDS, getProduct } from '../data/products.js';

/*
 * Every photograph and film the storefront ships, served from public/media/
 * on the same origin (no hotlinks, so img-src and media-src stay 'self').
 * The stills and the hero and room films are path-traced renders of the
 * planner's own parametric parts and rooms. The Meet our Icons reel is real
 * camera footage of architectural interiors under the Pexels License, cut
 * and graded by scripts/media/make-footage.mjs and credited below. Pure
 * data: the components, the server tests and the E2E suite all read the
 * same paths and sizes.
 *
 * Each URL carries the release as a query (?v=9.2.0), so /media/* can be
 * cached for a year as immutable and a new release is still a new URL.
 */

export const MEDIA_ROOT = '/media';

const RELEASE = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

export function mediaUrl(path) {
  return `${MEDIA_ROOT}/${path}?v=${encodeURIComponent(RELEASE)}`;
}

/** A film's two sources, VP9 WebM first (smaller), H.264 MP4 for Safari and older devices. */
function film(base) {
  return Object.freeze({ webm: mediaUrl(`${base}.webm`), mp4: mediaUrl(`${base}.mp4`) });
}

/* ---------- hero ---------- */

export const HERO_SIZES = Object.freeze({ full: Object.freeze({ width: 2560, height: 1440 }), half: Object.freeze({ width: 1280, height: 720 }) });

function heroScene(id) {
  return Object.freeze({
    id,
    still: Object.freeze({ 1280: mediaUrl(`hero/${id}-1280.webp`), 2560: mediaUrl(`hero/${id}-2560.webp`) }),
    srcSet: `${mediaUrl(`hero/${id}-1280.webp`)} 1280w, ${mediaUrl(`hero/${id}-2560.webp`)} 2560w`,
    film: film(`hero/${id}`),
  });
}

export const HERO_MEDIA = Object.freeze({ daylight: heroScene('daylight'), warm: heroScene('warm') });

/* ---------- rooms ---------- */

export const ROOM_SIZE = Object.freeze({ width: 1600, height: 2000 });

function room(slug) {
  return Object.freeze({ slug, still: mediaUrl(`rooms/${slug}-1600.webp`), film: film(`rooms/${slug}`) });
}

export const ROOM_MEDIA = Object.freeze({
  dining: room('dining-living'),
  bedroom: room('bedroom-sanctuary'),
  studio: room('studio-wall'),
});

/* ---------- meet our icons ---------- */

export const ICONS_SIZE = Object.freeze({ width: 1920, height: 1080 });

const PEXELS_LICENSE = 'Pexels License';

function icon(base, credit) {
  return Object.freeze({
    base,
    poster: mediaUrl(`icons/${base}.webp`),
    film: film(`icons/${base}`),
    credit: Object.freeze({ source: 'Pexels', license: PEXELS_LICENSE, ...credit }),
  });
}

/**
 * The three camera films of the Meet our Icons reel, in reel order. The
 * Pexels License allows use and modification without attribution; each film
 * still names its source clip and its author.
 */
export const ICONS_MEDIA = Object.freeze({
  pendant: icon('icon-01-pendant', {
    title: 'Elegant Wave-Shaped Pendant Light Design',
    author: 'Alef Morais',
    url: 'https://www.pexels.com/video/elegant-wave-shaped-pendant-light-design-39024324/',
  }),
  plaster: icon('icon-02-plaster', {
    title: 'Stylish Minimalist Interior with Decorative Vases',
    author: 'Raphael Kim',
    url: 'https://www.pexels.com/video/stylish-minimalist-interior-with-decorative-vases-35660680/',
  }),
  stair: icon('icon-03-stair', {
    title: 'Warmly Lit Wooden Stairs in Modern Interior',
    author: 'Alef Morais',
    url: 'https://www.pexels.com/video/warmly-lit-wooden-stairs-in-modern-interior-39024320/',
  }),
});

/* ---------- catalog ---------- */

export const CATALOG_SIZE = Object.freeze({ width: 1600, height: 1200 });

/** The studio photograph of a part in one of its finishes, or its default finish. */
export function productPhoto(productId, finishId) {
  const product = getProduct(productId);
  if (!product) return null;
  const finish = product.finishes.includes(finishId) ? finishId : product.defaultFinish;
  return Object.freeze({ finish, src: mediaUrl(`catalog/${product.id}-${finish}.webp`), ...CATALOG_SIZE });
}

/** Every file path under public/media/ the manifest promises, for the asset audit. */
export function mediaFiles(products) {
  const files = [];
  for (const id of Object.keys(HERO_MEDIA)) files.push(`hero/${id}-1280.webp`, `hero/${id}-2560.webp`, `hero/${id}.webm`, `hero/${id}.mp4`);
  for (const { slug } of Object.values(ROOM_MEDIA)) files.push(`rooms/${slug}-1600.webp`, `rooms/${slug}.webm`, `rooms/${slug}.mp4`);
  for (const { base } of Object.values(ICONS_MEDIA)) files.push(`icons/${base}.webp`, `icons/${base}.webm`, `icons/${base}.mp4`);
  for (const product of products) for (const finish of product.finishes.filter((f) => FINISH_IDS.includes(f))) files.push(`catalog/${product.id}-${finish}.webp`);
  return files;
}
