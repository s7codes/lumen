import { FINISH_IDS, getProduct } from '../data/products.js';

/*
 * Every photograph and film the storefront ships, served from public/media/
 * on the same origin (no hotlinks, so img-src and media-src stay 'self').
 * The stills are path-traced renders of the planner's own parametric parts
 * and rooms; the Meet our Icons reel and the showcase films are shot on the
 * accumulation cinema stage (scripts/media/cinema), the showcase acts in a
 * CAD chamber posed and labelled by the same functions the overview HUD
 * reads. Pure data: the components, the server tests and the E2E suite all
 * read the same paths and sizes.
 *
 * Each URL carries the release as a query (?v=9.1.0), so /media/* can be
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

/* ---------- showcase ---------- */

export const SHOWCASE_SIZE = Object.freeze({ width: 1440, height: 960 });

function act(base) {
  return Object.freeze({ base, poster: mediaUrl(`showcase/${base}.webp`), film: film(`showcase/${base}`) });
}

export const SHOWCASE_MEDIA = Object.freeze({
  orbit: act('01-envelope'),
  inside: act('02-walkthrough'),
  gizmo: act('03-raycast-gizmo'),
  isolux: act('04-iso-lux'),
});

/* ---------- meet our icons ---------- */

export const ICONS_SIZE = Object.freeze({ width: 1920, height: 800 });

function icon(base) {
  return Object.freeze({ base, poster: mediaUrl(`icons/${base}.webp`), film: film(`icons/${base}`) });
}

/** The three 2.4:1 cinema loops of the Meet our Icons reel, in reel order. */
export const ICONS_MEDIA = Object.freeze({
  monolith: icon('icon-01-monolith'),
  suspension: icon('icon-02-suspension'),
  column: icon('icon-03-column-spot'),
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
  for (const { base } of Object.values(SHOWCASE_MEDIA)) files.push(`showcase/${base}.webp`, `showcase/${base}.webm`, `showcase/${base}.mp4`);
  for (const { base } of Object.values(ICONS_MEDIA)) files.push(`icons/${base}.webp`, `icons/${base}.webm`, `icons/${base}.mp4`);
  for (const product of products) for (const finish of product.finishes.filter((f) => FINISH_IDS.includes(f))) files.push(`catalog/${product.id}-${finish}.webp`);
  return files;
}
