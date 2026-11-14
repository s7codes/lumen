import { existsSync, mkdirSync, statSync } from 'node:fs';
import { PASSES } from './grade-lib.mjs';
import { preparedPasses, PUBLIC, writeStill } from './build-media.mjs';
const { PRODUCTS } = await import(new URL('../../src/data/products.js', import.meta.url));

// Daylight from the gallery window, the part's 2700K channel at a level
// that reads as on without burning the wall it washes.
const GRADE = { exposure: 1.0, wb: [0.97, 1.0, 1.04], saturation: 1.0, contrast: 1.06, vignette: 0.06 };
const LED = 0.012;
// A bare lightbar is mostly its own diffuser: at the shared level its glow
// lights the thin housing rails until every finish reads alike.
const LED_BY_PART = { 'linear-lightbar-60': 0.006 };
mkdirSync(`${PUBLIC}/catalog`, { recursive: true });
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
let made = 0;
for (const product of PRODUCTS) {
  for (const finish of product.finishes) {
    const shot = `product-${product.id}-${finish}`;
    if (filter && !filter.test(shot)) continue;
    if (!existsSync(`${PASSES}/${shot}/led.f32`)) continue;
    const out = `${PUBLIC}/catalog/${product.id}-${finish}.webp`;
    const passes = preparedPasses(shot, ['sky', 'led']);
    writeStill(passes, { sky: 1, led: LED_BY_PART[product.id] ?? LED }, GRADE, [{ path: out, width: 1600, height: 1200, quality: 86 }]);
    made += 1;
    console.log(shot, (statSync(out).size / 1024).toFixed(0), 'KB');
  }
}
console.log('made', made);
