function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const FINISHES = deepFreeze([
  {
    id: 'walnut',
    label: 'Walnut',
    name: 'FSC American Walnut',
    surface: 'Oiled solid timber, FSC 100%',
    hex: '#5b3a26',
    highlight: '#8a5c3d',
    shade: '#2b1a10',
    texture: 'grain',
    lrv: 0.14,
    specular: 0.32,
  },
  {
    id: 'oak',
    label: 'Oak',
    name: 'Nordic White Oak',
    surface: 'White-oiled solid timber',
    hex: '#c4a57c',
    highlight: '#e0c8a4',
    shade: '#8a6d48',
    texture: 'grain',
    lrv: 0.46,
    specular: 0.24,
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    name: 'Brushed Obsidian Aluminum',
    surface: 'Brushed 6063-T5, black anodized',
    hex: '#2c2e30',
    highlight: '#5a5e62',
    shade: '#141516',
    texture: 'brushed',
    lrv: 0.09,
    specular: 0.85,
  },
  {
    id: 'chalk',
    label: 'Chalk',
    name: 'Matte Chalk',
    surface: 'Powder coat, 5% gloss',
    hex: '#e4dfd5',
    highlight: '#f4f1ea',
    shade: '#b5afa4',
    texture: 'matte',
    lrv: 0.82,
    specular: 0.06,
  },
]);

export const FINISH_IDS = FINISHES.map((finish) => finish.id);

export const CATEGORIES = deepFreeze([
  { id: 'shelving', label: 'Shelving' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'hardware', label: 'Hardware' },
]);

export const CATEGORY_IDS = CATEGORIES.map((category) => category.id);

export const STOCK_LABELS = deepFreeze({
  'in-stock': 'In stock',
  'made-to-order': 'Made to order',
});

const ALL_FINISHES = ['walnut', 'oak', 'obsidian', 'chalk'];
const METAL_FINISHES = ['obsidian', 'chalk'];

export const PRODUCTS = deepFreeze([
  {
    id: 'floating-shelf-110',
    sku: 'LMN-SH-110',
    name: 'Floating Shelf 110',
    category: 'shelving',
    priceUsd: 185,
    dimsCm: { w: 110, h: 8, d: 25 },
    watts: 16,
    lumens: 1150,
    kelvin: 2700,
    cri: 97,
    shape: 'shelf',
    mount: 'wall',
    mountingPoints: 3,
    finishes: ALL_FINISHES,
    defaultFinish: 'walnut',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: true,
    summary:
      'Solid board on a concealed steel cleat. A 2700K line under the front lip washes the wall below; the feed runs inside the cleat.',
  },
  {
    id: 'modular-cube-36',
    sku: 'LMN-CB-036',
    name: 'Modular Cube 36',
    category: 'shelving',
    priceUsd: 140,
    dimsCm: { w: 36, h: 36, d: 35 },
    watts: 12,
    lumens: 840,
    kelvin: 2700,
    cri: 97,
    shape: 'cube',
    mount: 'wall',
    mountingPoints: 2,
    finishes: ALL_FINISHES,
    defaultFinish: 'oak',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: false,
    summary:
      'Open box with 18 mm walls. Stacks, hangs or links side by side; an LED line under the top panel lights the interior.',
  },
  {
    id: 'compact-sideboard-75',
    sku: 'LMN-SB-075',
    name: 'Compact Sideboard 75',
    category: 'shelving',
    priceUsd: 320,
    dimsCm: { w: 75, h: 38, d: 38 },
    watts: 18,
    lumens: 1280,
    kelvin: 2700,
    cri: 97,
    shape: 'sideboard',
    mount: 'wall',
    mountingPoints: 4,
    finishes: ALL_FINISHES,
    defaultFinish: 'walnut',
    stock: 'made-to-order',
    leadWeeks: [4, 6],
    flagship: false,
    summary:
      'Wall-hung cabinet, two push-latch doors, one adjustable shelf. A 2700K wash on the underside grazes the floor.',
  },
  {
    id: 'linear-lightbar-60',
    sku: 'LMN-LB-060',
    name: 'Linear Lightbar 60',
    category: 'lighting',
    priceUsd: 160,
    dimsCm: { w: 60, h: 5, d: 5 },
    watts: 14,
    lumens: 1050,
    kelvin: 3000,
    cri: 97,
    shape: 'lightbar',
    mount: 'wall',
    mountingPoints: 2,
    finishes: ['obsidian', 'chalk', 'walnut', 'oak'],
    defaultFinish: 'obsidian',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: false,
    summary:
      'Extruded profile with an opal diffuser. Fits under shelves, in coves or on the wall, fed from the track bus or a 24V lead.',
  },
  {
    id: 'corner-floor-column-140',
    sku: 'LMN-CL-140',
    name: 'Corner Floor Column 140',
    category: 'lighting',
    priceUsd: 290,
    dimsCm: { w: 18, h: 140, d: 18 },
    watts: 24,
    lumens: 1800,
    kelvin: 2700,
    cri: 97,
    shape: 'column',
    mount: 'floor',
    mountingPoints: 1,
    finishes: ALL_FINISHES,
    defaultFinish: 'walnut',
    stock: 'made-to-order',
    leadWeeks: [3, 5],
    flagship: true,
    summary:
      'Free-standing column with a full-height opal slot. Stands in a corner to wash both walls; a single wall tie prevents tipping.',
  },
  {
    id: 'directional-spot-monopoint',
    sku: 'LMN-SP-012',
    name: 'Directional Spot Monopoint',
    category: 'lighting',
    priceUsd: 125,
    dimsCm: { w: 12, h: 12, d: 8 },
    watts: 7,
    lumens: 520,
    kelvin: 2700,
    cri: 97,
    shape: 'spot',
    mount: 'ceiling',
    mountingPoints: 1,
    finishes: METAL_FINISHES,
    defaultFinish: 'obsidian',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: false,
    summary:
      'Single-point canopy spot with a 36 deg beam, 350 deg rotation and 90 deg tilt. For accenting art and objects.',
  },
  {
    id: 'acoustic-art-frame-50x70',
    sku: 'LMN-AF-070',
    name: 'Acoustic Art Frame 50x70',
    category: 'surfaces',
    priceUsd: 210,
    dimsCm: { w: 50, h: 70, d: 4 },
    watts: 15,
    lumens: 980,
    kelvin: 2700,
    cri: 97,
    shape: 'frame',
    mount: 'wall',
    mountingPoints: 2,
    finishes: ALL_FINISHES,
    defaultFinish: 'oak',
    stock: 'made-to-order',
    leadWeeks: [3, 4],
    flagship: true,
    summary:
      'Timber frame around a 30 mm PET felt core, NRC 0.70. A rear 2700K halo lifts the panel off the wall.',
  },
  {
    id: 'track-bus-200',
    sku: 'LMN-TR-200',
    name: 'Recessed 24V Track Bus 200',
    category: 'hardware',
    priceUsd: 95,
    dimsCm: { w: 200, h: 3, d: 2 },
    watts: 0,
    lumens: 0,
    kelvin: null,
    cri: null,
    shape: 'track',
    mount: 'recessed',
    mountingPoints: 5,
    finishes: METAL_FINISHES,
    defaultFinish: 'obsidian',
    stock: 'in-stock',
    leadWeeks: [1, 1],
    flagship: false,
    summary:
      'Plaster-in channel carrying the 24V DC bus. Fixtures click in anywhere along its length. Cut to length on site.',
  },
  {
    id: 'linear-pendant-150',
    sku: 'LMN-PD-150',
    name: 'Linear Suspension Pendant 150',
    category: 'lighting',
    priceUsd: 420,
    dimsCm: { w: 150, h: 12, d: 6 },
    watts: 28,
    lumens: 2450,
    kelvin: 2700,
    cri: 97,
    shape: 'pendant',
    mount: 'ceiling',
    mountingPoints: 2,
    finishes: ['obsidian', 'chalk', 'walnut', 'oak'],
    defaultFinish: 'obsidian',
    stock: 'made-to-order',
    leadWeeks: [3, 5],
    flagship: false,
    summary:
      'Extruded profile on two 1.2 mm steel cables. Microprismatic optic over a dining table or desk run; the 24V feed rises through one canopy.',
  },
  {
    id: 'acoustic-baffle-120',
    sku: 'LMN-AB-120',
    name: 'Acoustic Wall Baffle 120',
    category: 'surfaces',
    priceUsd: 260,
    dimsCm: { w: 120, h: 35, d: 5 },
    watts: 0,
    lumens: 0,
    kelvin: null,
    cri: null,
    shape: 'baffle',
    mount: 'wall',
    mountingPoints: 3,
    finishes: ALL_FINISHES,
    defaultFinish: 'oak',
    stock: 'made-to-order',
    leadWeeks: [3, 4],
    flagship: false,
    summary:
      'Full-face 50 mm PET felt core, NRC 0.85, in a 12 mm timber edge. Takes out speech-band reverberation along a long wall.',
  },
  {
    id: 'wall-sconce-80',
    sku: 'LMN-SC-080',
    name: 'Vertical Architectural Sconce 80',
    category: 'lighting',
    priceUsd: 245,
    dimsCm: { w: 10, h: 80, d: 7 },
    watts: 14,
    lumens: 1180,
    kelvin: 2700,
    cri: 96,
    shape: 'sconce',
    mount: 'wall',
    mountingPoints: 1,
    finishes: ['obsidian', 'chalk', 'walnut', 'oak'],
    defaultFinish: 'chalk',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: false,
    summary:
      'Vertical blade with an opal face and open ends. Washes the wall up and down from a single back plate; pairs either side of a mirror or bed.',
  },
  {
    id: 'power-hub-dali',
    sku: 'LMN-HB-060',
    name: 'Recessed 24V DALI-2 Bus Hub',
    category: 'hardware',
    priceUsd: 165,
    dimsCm: { w: 60, h: 6, d: 4 },
    watts: 0,
    lumens: 0,
    kelvin: null,
    cri: null,
    shape: 'hub',
    mount: 'recessed',
    mountingPoints: 2,
    finishes: METAL_FINISHES,
    defaultFinish: 'obsidian',
    stock: 'in-stock',
    leadWeeks: [1, 2],
    flagship: false,
    summary:
      'Plaster-in junction that feeds the 24V bus and passes it through. A DALI-2 pair on the same terminal block addresses every fixture downstream.',
  },
]);

// Maps, not object lookups: an untrusted id such as "constructor" must never
// resolve to an inherited Object.prototype member.
const PRODUCT_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));
const FINISH_BY_ID = new Map(FINISHES.map((finish) => [finish.id, finish]));
const CATEGORY_BY_ID = new Map(CATEGORIES.map((category) => [category.id, category]));

export function getProduct(id) {
  return typeof id === 'string' ? (PRODUCT_BY_ID.get(id) ?? null) : null;
}

export function getFinish(id) {
  return typeof id === 'string' ? (FINISH_BY_ID.get(id) ?? null) : null;
}

export function getCategory(id) {
  return typeof id === 'string' ? (CATEGORY_BY_ID.get(id) ?? null) : null;
}

export function productHasFinish(product, finishId) {
  return Boolean(product) && typeof finishId === 'string' && product.finishes.includes(finishId);
}

export function efficacyLmPerW(product) {
  return product.watts > 0 ? product.lumens / product.watts : null;
}
