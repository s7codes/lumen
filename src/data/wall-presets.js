function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Positions are cm from the left wall edge (x) and the finished floor (y) to
// the module's lower-left corner. Every preset is collision-free on its wall.
export const WALL_PRESETS = deepFreeze([
  {
    id: 'nordic-reading-wall',
    name: 'Nordic Reading Wall',
    summary: 'Floor column beside a chair, two lit shelves, cube pair, ceiling track with two spots.',
    wall: { widthCm: 300, heightCm: 250, slope: false },
    items: [
      { productId: 'corner-floor-column-140', finish: 'walnut', xCm: 8, yCm: 0 },
      { productId: 'floating-shelf-110', finish: 'walnut', xCm: 40, yCm: 118 },
      { productId: 'floating-shelf-110', finish: 'walnut', xCm: 40, yCm: 158 },
      { productId: 'modular-cube-36', finish: 'oak', xCm: 170, yCm: 118 },
      { productId: 'modular-cube-36', finish: 'oak', xCm: 210, yCm: 118 },
      { productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 168, yCm: 172 },
      { productId: 'track-bus-200', finish: 'obsidian', xCm: 50, yCm: 228 },
      { productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 80, yCm: 238 },
      { productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 200, yCm: 238 },
    ],
  },
  {
    id: 'acoustic-media-spine',
    name: 'Acoustic Media Spine',
    summary: 'Paired low sideboards under three felt panels, a lightbar header and a ceiling track.',
    wall: { widthCm: 300, heightCm: 250, slope: false },
    items: [
      { productId: 'compact-sideboard-75', finish: 'obsidian', xCm: 72, yCm: 30 },
      { productId: 'compact-sideboard-75', finish: 'obsidian', xCm: 153, yCm: 30 },
      { productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 62, yCm: 100 },
      { productId: 'acoustic-art-frame-50x70', finish: 'chalk', xCm: 125, yCm: 100 },
      { productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 188, yCm: 100 },
      { productId: 'linear-lightbar-60', finish: 'obsidian', xCm: 120, yCm: 182 },
      { productId: 'track-bus-200', finish: 'obsidian', xCm: 50, yCm: 228 },
      { productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 94, yCm: 238 },
      { productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 194, yCm: 238 },
    ],
  },
  {
    id: 'attic-study-alcove',
    name: 'Attic Study Alcove',
    summary: 'Desk cabinet and stacked shelves under a 90 x 90 cm roof slope, column in the low corner.',
    wall: { widthCm: 300, heightCm: 240, slope: true },
    items: [
      { productId: 'compact-sideboard-75', finish: 'oak', xCm: 20, yCm: 70 },
      { productId: 'floating-shelf-110', finish: 'oak', xCm: 20, yCm: 140 },
      { productId: 'floating-shelf-110', finish: 'oak', xCm: 20, yCm: 180 },
      { productId: 'modular-cube-36', finish: 'chalk', xCm: 150, yCm: 100 },
      { productId: 'modular-cube-36', finish: 'chalk', xCm: 150, yCm: 140 },
      { productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 200, yCm: 100 },
      { productId: 'linear-lightbar-60', finish: 'chalk', xCm: 150, yCm: 190 },
      { productId: 'directional-spot-monopoint', finish: 'chalk', xCm: 60, yCm: 228 },
      { productId: 'corner-floor-column-140', finish: 'oak', xCm: 270, yCm: 0 },
    ],
  },
]);

const PRESET_BY_ID = new Map(WALL_PRESETS.map((preset) => [preset.id, preset]));

export function getWallPreset(id) {
  return typeof id === 'string' ? (PRESET_BY_ID.get(id) ?? null) : null;
}
