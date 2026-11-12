import { memo, useId } from 'react';
import { FINISHES, getFinish } from '../data/products.js';

/**
 * Miniature architectural drawing of one catalog part on a dark glass tile.
 * Every shape is drawn on a 36-unit grid in the three tones of the active
 * finish (base, highlight, shade). A luminous part that is switched on adds
 * its warm backlight and light cones; passive parts and parts whose 24V
 * channel is off show the bare hardware. Decorative: the row that holds it
 * carries the accessible name.
 */

// Null-prototype record: an untrusted id such as "constructor" resolves to nothing.
export const FINISH_RAMPS = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(FINISHES.map((finish) => [finish.id, Object.freeze({ base: finish.hex, hi: finish.highlight, lo: finish.shade })])),
  ),
);

export function finishRamp(finishId, fallbackId) {
  const finish = getFinish(finishId) ?? getFinish(fallbackId) ?? FINISHES[0];
  return { id: finish.id, ramp: FINISH_RAMPS[finish.id] };
}

const GRID = 36;
const SIZES = Object.freeze({ md: 36, sm: 28 });
const TILE_RADIUS_PX = 8;

const LED_ON = '#fff3dc';
const LED_OFF = 'rgba(255, 255, 255, 0.16)';
const INTERIOR = '#100f0d';
const FELT = '#46423d';
const FELT_GROOVE = '#2a2724';
const COPPER = '#c98a52';
const COPPER_HI = '#ebb27b';
const CHAMPAGNE = '#e5c799';
const DATUM = 'rgba(255, 255, 255, 0.12)';
const CABLE = 'rgba(235, 232, 226, 0.5)';
const TICK = 'rgba(229, 199, 153, 0.7)';
const CHAMFER = 'rgba(255, 255, 255, 0.08)';

const led = (on) => (on ? LED_ON : LED_OFF);

// Five evenly spaced grooves across the frame's felt core, four across the baffle's.
const FRAME_GROOVES = [13.47, 15.73, 18, 20.27, 22.53];
const BAFFLE_GROOVES = [14.46, 16.92, 19.38, 21.84];
const TRACK_ANCHORS = [6, 12, 18, 24, 30];
const HUB_PORTS = [7.6, 12, 16.4, 20.8, 25.2];

/**
 * Per shape: `glow` is the backlight ellipse [cx, cy, rx, ry] (null for
 * passive hardware) and `draw` paints the part. `url(id)` names one of the
 * tile's gradients.
 */
const ART = Object.freeze({
  // Cantilevered timber board on the wall, a 2700K line washing the wall below.
  shelf: {
    glow: [18, 23, 15, 10],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        <rect x="3.2" y="5.5" width="0.8" height="25" fill={DATUM} />
        {on && <polygon points="7,17.4 29,17.4 33.5,31 2.5,31" fill={url('beam')} />}
        <rect x="9" y="8.4" width="2.2" height="3.8" rx="0.3" fill={hi} opacity="0.6" />
        <rect x="11.6" y="9.3" width="2" height="2.9" rx="0.3" fill={lo} />
        <rect x="23.6" y="9.8" width="3.6" height="2.4" rx="1.2" fill={hi} opacity="0.45" />
        <rect x="4" y="12.2" width="27" height="4.6" rx="0.8" fill={base} />
        <rect x="4" y="12.2" width="27" height="1" rx="0.5" fill={hi} />
        <rect x="4" y="15.6" width="27" height="1.2" fill={lo} />
        <rect x="7" y="16.6" width="22" height="0.9" rx="0.45" fill={led(on)} />
      </>
    ),
  },
  // Open storage cube in three-quarter view, a downlight under the top panel.
  cube: {
    glow: [16.5, 20, 9, 9],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        <polygon points="7,11 11,7 30,7 26,11" fill={hi} />
        <polygon points="26,11 30,7 30,26 26,30" fill={lo} />
        <rect x="7" y="11" width="19" height="19" fill={base} />
        <rect x="10" y="14" width="13" height="13" fill={INTERIOR} />
        {on && <polygon points="10.6,15.1 22.4,15.1 23,27 10,27" fill={url('beam')} />}
        <rect x="10.6" y="14.3" width="11.8" height="0.8" rx="0.4" fill={led(on)} />
        <rect x="7" y="11" width="19" height="0.8" fill={hi} opacity="0.55" />
      </>
    ),
  },
  // Two-door credenza: door seam, plinth shadow, a strip grazing the floor.
  sideboard: {
    glow: [18, 28, 16, 7],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        {on && <polygon points="6,24.9 30,24.9 34,33.5 2,33.5" fill={url('beam')} />}
        <rect x="4" y="10.5" width="28" height="13.5" rx="0.9" fill={base} />
        <rect x="4" y="10.5" width="28" height="1" rx="0.5" fill={hi} />
        <rect x="5.4" y="12.6" width="11.9" height="9.4" rx="0.4" fill="none" stroke={lo} strokeWidth="0.6" opacity="0.75" />
        <rect x="18.7" y="12.6" width="11.9" height="9.4" rx="0.4" fill="none" stroke={lo} strokeWidth="0.6" opacity="0.75" />
        <rect x="17.6" y="12" width="0.8" height="10.6" fill={lo} />
        <rect x="4" y="22.6" width="28" height="1.4" fill={lo} />
        <rect x="6" y="24" width="24" height="0.9" rx="0.45" fill={led(on)} />
      </>
    ),
  },
  // Slim extruded bar on two stand-offs, a bright opal core and a down cone.
  lightbar: {
    glow: [18, 24, 15, 9],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        <rect x="6" y="9.2" width="24" height="0.8" fill={DATUM} />
        <rect x="9.6" y="10" width="1" height="3.4" fill={lo} />
        <rect x="25.4" y="10" width="1" height="3.4" fill={lo} />
        {on && <polygon points="6.4,17.2 29.6,17.2 34.5,32 1.5,32" fill={url('beam')} />}
        <rect x="5" y="13.4" width="26" height="3.4" rx="1.4" fill={base} />
        <rect x="6" y="13.4" width="24" height="0.7" rx="0.35" fill={hi} />
        <rect x="6.4" y="15.6" width="23.2" height="1.5" rx="0.75" fill={led(on)} />
      </>
    ),
  },
  // Floor monolith on a base plate, light slots down both flanks.
  column: {
    glow: [18, 18, 13, 15],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        {on && <polygon points="14.2,7 14.2,28 3,31 3,4" fill={url('washLeft')} />}
        {on && <polygon points="21.8,7 21.8,28 33,31 33,4" fill={url('washRight')} />}
        <rect x="4" y="31.4" width="28" height="0.7" fill={DATUM} />
        <rect x="11.5" y="29.6" width="13" height="1.8" rx="0.5" fill={lo} />
        <rect x="14" y="4.5" width="8" height="25.2" rx="1" fill={base} />
        <rect x="14" y="4.5" width="1" height="25.2" rx="0.5" fill={hi} />
        <rect x="15.4" y="6.6" width="1.1" height="21" rx="0.55" fill={led(on)} />
        <rect x="19.5" y="6.6" width="1.1" height="21" rx="0.55" fill={led(on)} />
      </>
    ),
  },
  // Ceiling canopy and a tilted canister throwing a crisp 36 deg cone.
  spot: {
    glow: [22, 26, 12, 10],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        <rect x="4" y="3.6" width="28" height="0.8" fill={DATUM} />
        <rect x="9.5" y="4.4" width="9" height="1.8" rx="0.6" fill={lo} />
        <rect x="13.3" y="6.2" width="1.4" height="2.6" fill={lo} />
        <g transform="rotate(-32 14 9)">
          {on && <polygon points="11.4,19.2 16.6,19.2 23.5,40 4.5,40" fill={url('beam')} />}
          {on && <path d="M11.4 19.2 4.5 40M16.6 19.2 23.5 40" stroke="rgba(255, 214, 160, 0.35)" strokeWidth="0.5" />}
          <rect x="10.2" y="9" width="7.6" height="10.4" rx="1.6" fill={base} />
          <rect x="10.2" y="9" width="1.1" height="10.4" rx="0.55" fill={hi} />
          <rect x="11" y="18.4" width="6" height="1.1" rx="0.5" fill={led(on)} />
        </g>
      </>
    ),
  },
  // Timber frame around fluted PET felt, a rear halo lifting it off the wall.
  frame: {
    glow: [18, 18, 14, 16],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        {on && <rect x="6.3" y="3.3" width="23.4" height="29.4" rx="4.5" fill={url('halo')} />}
        <rect x="9.5" y="6" width="17" height="24" rx="0.6" fill={base} />
        <rect x="11.2" y="7.7" width="13.6" height="20.6" fill={FELT} />
        {FRAME_GROOVES.map((x) => (
          <g key={x}>
            <rect x={x - 0.35} y="7.7" width="0.7" height="20.6" fill={FELT_GROOVE} />
            <rect x={x + 0.35} y="7.7" width="0.4" height="20.6" fill={CHAMFER} />
          </g>
        ))}
        <rect x="9.5" y="6" width="17" height="0.9" fill={hi} />
        <rect x="25.6" y="6" width="0.9" height="24" fill={lo} />
      </>
    ),
  },
  // Plaster-in channel with twin copper 24V conductors and its five anchors.
  track: {
    glow: null,
    draw: ({ base, hi }) => (
      <>
        <rect x="3" y="12.4" width="30" height="10.2" rx="1" fill={base} />
        <rect x="3" y="12.4" width="30" height="0.8" rx="0.4" fill={hi} />
        <rect x="4.2" y="14.2" width="27.6" height="6.8" rx="0.6" fill={INTERIOR} />
        <rect x="4.8" y="15.5" width="26.4" height="1.1" rx="0.5" fill={COPPER} />
        <rect x="4.8" y="15.5" width="26.4" height="0.4" fill={COPPER_HI} />
        <rect x="4.8" y="18.5" width="26.4" height="1.1" rx="0.5" fill={COPPER} />
        <rect x="4.8" y="18.5" width="26.4" height="0.4" fill={COPPER_HI} />
        <rect x="6" y="26.6" width="24" height="0.5" fill="rgba(229, 199, 153, 0.45)" />
        {TRACK_ANCHORS.map((x) => (
          <rect key={x} x={x - 0.3} y="24.8" width="0.6" height="4" fill={TICK} />
        ))}
      </>
    ),
  },
  // Linear luminaire on twin cables from twin canopies, lit down and up.
  pendant: {
    glow: [18, 22, 15, 11],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        <rect x="4" y="3.4" width="28" height="0.8" fill={DATUM} />
        {on && <polygon points="6.4,15.4 29.6,15.4 31.5,8.5 4.5,8.5" fill={url('up')} opacity="0.7" />}
        <rect x="7.8" y="4.2" width="5.4" height="1.6" rx="0.6" fill={lo} />
        <rect x="22.8" y="4.2" width="5.4" height="1.6" rx="0.6" fill={lo} />
        <rect x="10.25" y="5.8" width="0.5" height="9.6" fill={CABLE} />
        <rect x="25.25" y="5.8" width="0.5" height="9.6" fill={CABLE} />
        {on && <polygon points="6.4,18.6 29.6,18.6 34.5,33.5 1.5,33.5" fill={url('beam')} />}
        <rect x="5" y="15.4" width="26" height="3.2" rx="1.1" fill={base} />
        <rect x="5.8" y="15.4" width="24.4" height="0.6" rx="0.3" fill={hi} />
        <rect x="6.4" y="17.5" width="23.2" height="1.1" rx="0.55" fill={led(on)} />
      </>
    ),
  },
  // Long wall baffle: a timber edge around ribbed felt with chamfered grooves.
  baffle: {
    glow: null,
    draw: ({ base, hi }) => (
      <>
        <rect x="4" y="10.6" width="28" height="15" rx="1.1" fill={base} />
        <rect x="4" y="10.6" width="28" height="0.9" rx="0.45" fill={hi} />
        <rect x="5.3" y="12" width="25.4" height="12.3" rx="0.5" fill={FELT} />
        {BAFFLE_GROOVES.map((y) => (
          <g key={y}>
            <rect x="5.3" y={y - 0.45} width="25.4" height="0.9" fill={FELT_GROOVE} />
            <rect x="5.3" y={y + 0.45} width="25.4" height="0.45" fill={CHAMFER} />
          </g>
        ))}
        <rect x="5" y="25.6" width="26" height="0.9" fill="rgba(0, 0, 0, 0.45)" />
      </>
    ),
  },
  // Vertical blade on one back plate, grazing the wall up and down.
  sconce: {
    glow: [18, 18, 10, 16],
    draw: ({ base, hi, lo }, on, url) => (
      <>
        {on && <polygon points="16.2,9.4 19.8,9.4 26,0 10,0" fill={url('up')} />}
        {on && <polygon points="16.2,26.6 19.8,26.6 26,36 10,36" fill={url('beam')} />}
        <rect x="14.6" y="15.6" width="6.8" height="4.8" rx="0.6" fill={lo} />
        <rect x="16" y="9" width="4" height="18" rx="1.1" fill={base} />
        <rect x="16" y="9" width="0.9" height="18" rx="0.45" fill={hi} />
        <rect x="17.3" y="10.6" width="1.6" height="14.8" rx="0.6" fill={led(on)} />
      </>
    ),
  },
  // Plaster-in DALI-2 hub: bus through both ends, terminal ports, a flat status bar.
  hub: {
    glow: null,
    draw: ({ base, hi, lo }) => (
      <>
        <rect x="0" y="16" width="5" height="0.8" fill={COPPER} opacity="0.75" />
        <rect x="0" y="19.2" width="5" height="0.8" fill={COPPER} opacity="0.75" />
        <rect x="31" y="16" width="5" height="0.8" fill={COPPER} opacity="0.75" />
        <rect x="31" y="19.2" width="5" height="0.8" fill={COPPER} opacity="0.75" />
        <rect x="4" y="10" width="28" height="16" rx="1.4" fill={INTERIOR} />
        <rect x="5.4" y="11.4" width="25.2" height="13.2" rx="0.9" fill={base} />
        <rect x="5.4" y="11.4" width="25.2" height="0.8" rx="0.4" fill={hi} />
        <rect x="7.6" y="14.3" width="7.2" height="1.3" rx="0.3" fill={CHAMPAGNE} />
        <rect x="21.6" y="14.5" width="6.6" height="0.9" rx="0.3" fill={lo} />
        {HUB_PORTS.map((x) => (
          <g key={x}>
            <rect x={x} y="18.4" width="3.2" height="3.8" rx="0.4" fill={INTERIOR} />
            <rect x={x + 1.2} y="19.3" width="0.8" height="2" fill={COPPER} />
          </g>
        ))}
      </>
    ),
  },
});

export const GLYPH_SHAPES = Object.freeze(Object.keys(ART));

function ProductThumbGlyphView({ product, finish, lit = true, size = 'md', className = '' }) {
  const uid = `ptg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const art = Object.hasOwn(ART, product?.shape) ? ART[product.shape] : null;
  if (!art) return null;

  const dim = SIZES[size] ?? SIZES.md;
  const px = GRID / dim;
  const radius = TILE_RADIUS_PX * px;
  const { id: finishId, ramp } = finishRamp(finish, product.defaultFinish);
  const glowing = Boolean(art.glow) && product.watts > 0 && lit !== false;
  const url = (name) => `url(#${uid}-${name})`;

  return (
    <svg
      className={`product-thumb ${className}`.trim()}
      width={dim}
      height={dim}
      viewBox={`0 0 ${GRID} ${GRID}`}
      aria-hidden="true"
      focusable="false"
      data-testid="product-thumb-glyph"
      data-shape={product.shape}
      data-finish={finishId}
      data-lit={String(glowing)}
      data-size={dim === SIZES.sm ? 'sm' : 'md'}
    >
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect width={GRID} height={GRID} rx={radius} />
        </clipPath>
        <linearGradient id={`${uid}-tile`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor="#292622" />
          <stop offset="1" stopColor="#171614" />
        </linearGradient>
        {glowing && (
          <>
            <radialGradient id={`${uid}-glow`}>
              <stop offset="0" stopColor="#ffb866" stopOpacity="0.42" />
              <stop offset="0.55" stopColor="#e8923a" stopOpacity="0.14" />
              <stop offset="1" stopColor="#e8923a" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ffd9a3" stopOpacity="0.55" />
              <stop offset="1" stopColor="#ffd9a3" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-up`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ffd9a3" stopOpacity="0.5" />
              <stop offset="1" stopColor="#ffd9a3" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-washLeft`} x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="#ffd9a3" stopOpacity="0.4" />
              <stop offset="1" stopColor="#ffd9a3" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${uid}-washRight`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#ffd9a3" stopOpacity="0.4" />
              <stop offset="1" stopColor="#ffd9a3" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`${uid}-halo`}>
              <stop offset="0.55" stopColor="#ffcf8f" stopOpacity="0.5" />
              <stop offset="1" stopColor="#ffcf8f" stopOpacity="0" />
            </radialGradient>
          </>
        )}
      </defs>
      <g clipPath={url('clip')}>
        <rect width={GRID} height={GRID} fill={url('tile')} />
        <rect width={GRID} height="0.9" fill="rgba(255, 255, 255, 0.07)" />
        {glowing && <ellipse cx={art.glow[0]} cy={art.glow[1]} rx={art.glow[2]} ry={art.glow[3]} fill={url('glow')} />}
        {art.draw(ramp, glowing, url)}
      </g>
      <rect
        x={px / 2}
        y={px / 2}
        width={GRID - px}
        height={GRID - px}
        rx={radius - px / 2}
        fill="none"
        stroke="rgba(255, 255, 255, 0.09)"
        strokeWidth={px}
      />
    </svg>
  );
}

export const ProductThumbGlyph = memo(ProductThumbGlyphView);
