// Every shot the studio renders: the hero room, the three portrait rooms and
// every catalog part in every finish it ships in (default finishes first, so
// every card has its photograph early in a long batch).
const { PRODUCTS } = await import(new URL('../../src/data/products.js', import.meta.url));

export const HERO_JOBS = [{ id: 'hero', kind: 'hero', width: 2560, height: 1440 }];

export const ROOM_JOBS = [
  { id: 'room-dining', kind: 'room-dining', width: 1600, height: 2000 },
  { id: 'room-bedroom', kind: 'room-bedroom', width: 1600, height: 2000 },
  { id: 'room-studio', kind: 'room-studio', width: 1600, height: 2000 },
];

const all = PRODUCTS.flatMap((p) => p.finishes.map((finish) => ({ id: `product-${p.id}-${finish}`, kind: 'product', productId: p.id, finish, width: 1600, height: 1200, first: finish === p.defaultFinish })));
export const PRODUCT_JOBS = [...all.filter((job) => job.first), ...all.filter((job) => !job.first)];

export const JOBS = [...HERO_JOBS, ...ROOM_JOBS, ...PRODUCT_JOBS];
