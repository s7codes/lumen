import { HERO_VIEW, heroSceneGeometry } from '../lib/hero-scenes.js';

const VIEW_BOX = `0 0 ${HERO_VIEW.width} ${HERO_VIEW.height}`;
const BLEED = { x: -160, y: -120, width: HERO_VIEW.width + 320, height: HERO_VIEW.height + 240 };
const r1 = (v) => Math.round(v * 10) / 10;
const poly = (points) => points.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');

function Stops({ stops }) {
  return stops.map(([offset, color, opacity = 1]) => <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />);
}

/** The cone's light along its axis: a white-hot opening falling into a 2700K halo. */
function ConeGradient({ id, spec, reachY, stops }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={r1(spec.x)} y1={r1(spec.y0)} x2={r1(spec.x)} y2={r1(reachY)}>
      <Stops stops={stops} />
    </linearGradient>
  );
}

const CONE_MAIN = [
  [0, '#fffdf7', 0.98],
  [0.16, '#fffaf0', 0.94],
  [0.42, '#fcefd8', 0.78],
  [0.74, '#f5e2c0', 0.5],
  [1, '#f5e2c0', 0.2],
];
const CONE_CORE = [
  [0, '#ffffff', 0.92],
  [0.3, '#fffdf7', 0.6],
  [0.7, '#fffaf0', 0.18],
  [1, '#fffaf0', 0],
];
const CONE_HALO = [
  [0, '#f5e2c0', 0.34],
  [0.5, '#f5e2c0', 0.18],
  [1, '#f5e2c0', 0.04],
];
const SPOT_BEAM = [
  [0, '#fffaf0', 0.72],
  [0.22, '#fff1d4', 0.42],
  [0.6, '#ffe6b8', 0.16],
  [1, '#ffdc9c', 0],
];

/* ---------- Scene I: architectural wall wash and molded door reveal ---------- */

function SconceBody({ lamp }) {
  const { x, y, halfW, halfH } = lamp;
  const mouth = halfW * 0.84;
  const lip = halfW * 0.26;
  const shell = `M${r1(x - mouth)} ${r1(y - halfH)}Q${r1(x - halfW * 1.16)} ${r1(y)} ${r1(x - mouth)} ${r1(y + halfH)}A${r1(mouth)} ${r1(lip)} 0 0 0 ${r1(x + mouth)} ${r1(y + halfH)}Q${r1(x + halfW * 1.16)} ${r1(y)} ${r1(x + mouth)} ${r1(y - halfH)}A${r1(mouth)} ${r1(lip)} 0 0 0 ${r1(x - mouth)} ${r1(y - halfH)}Z`;
  return (
    <g className="hero-scene__sconce">
      {/* Contact shadow on the plaster: soft, close and warm. */}
      <ellipse cx={r1(x + halfW * 0.5)} cy={r1(y + halfH * 0.1)} rx={r1(halfW * 1.9)} ry={r1(halfH * 1.18)} fill="url(#hw-sconce-shadow)" />
      <path d={shell} fill="url(#hw-anodized)" />
      {/* A specular strip down the curve and a cooler rim on the far flank. */}
      <path d={shell} fill="url(#hw-anodized-sheen)" />
      <ellipse cx={r1(x)} cy={r1(y - halfH)} rx={r1(mouth)} ry={r1(lip)} fill="#fff9ec" />
      <ellipse cx={r1(x)} cy={r1(y + halfH)} rx={r1(mouth)} ry={r1(lip)} fill="#fff9ec" />
      <ellipse cx={r1(x)} cy={r1(y - halfH)} rx={r1(mouth)} ry={r1(lip)} fill="none" stroke="#3a3733" strokeWidth="1.4" />
      <ellipse cx={r1(x)} cy={r1(y + halfH)} rx={r1(mouth)} ry={r1(lip)} fill="none" stroke="#2a2825" strokeWidth="1.4" />
      <circle cx={r1(x)} cy={r1(y - halfH)} r={r1(halfW * 2.4)} fill="url(#hw-bloom)" />
      <circle cx={r1(x)} cy={r1(y + halfH)} r={r1(halfW * 2.4)} fill="url(#hw-bloom)" />
    </g>
  );
}

function WallWashScene() {
  const g = heroSceneGeometry().wallWash;
  const { lamp, cones } = g;
  const up = cones.up;
  const down = cones.down;
  return (
    <svg
      className="hero-scene hero-scene--wall-wash"
      data-scene="wall-wash"
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hw-wall" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#c8bca9'], [0.45, '#b9ac98'], [1, '#ad9f8b']]} />
        </linearGradient>
        <linearGradient id="hw-wall-falloff" gradientUnits="userSpaceOnUse" x1="300" y1="0" x2="1600" y2="0">
          <Stops stops={[[0, '#5a4732', 0.2], [0.32, '#5a4732', 0.05], [0.62, '#5a4732', 0], [1, '#5a4732', 0.14]]} />
        </linearGradient>
        <radialGradient id="hw-ambient" gradientUnits="userSpaceOnUse" cx={r1(lamp.x)} cy={r1(lamp.y)} r="620">
          <Stops stops={[[0, '#f5e2c0', 0.62], [0.32, '#f2dcb6', 0.3], [0.7, '#e9d3ae', 0.08], [1, '#e9d3ae', 0]]} />
        </radialGradient>
        <linearGradient id="hw-ceiling" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#bdb09c'], [1, '#cbbfac']]} />
        </linearGradient>
        <radialGradient id="hw-ceiling-spot" gradientUnits="userSpaceOnUse" cx={r1(lamp.x)} cy={r1(g.ceilingY)} r={r1(up.spread * 1.5)}>
          <Stops stops={[[0, '#fffdf7', 0.95], [0.35, '#fbefd9', 0.7], [1, '#f5e2c0', 0]]} />
        </radialGradient>
        <linearGradient id="hw-side" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={r1(g.corner)} y2="0">
          <Stops stops={[[0, '#a2947f'], [0.7, '#ae9f8a'], [1, '#b5a792']]} />
        </linearGradient>
        <linearGradient id="hw-corner-ao" gradientUnits="userSpaceOnUse" x1={r1(g.corner)} y1="0" x2={r1(g.corner + 70)} y2="0">
          <Stops stops={[[0, '#3c2f22', 0.26], [0.4, '#3c2f22', 0.08], [1, '#3c2f22', 0]]} />
        </linearGradient>
        <linearGradient id="hw-floor" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#c3a581'], [1, '#b89874']]} />
        </linearGradient>
        <radialGradient id="hw-floor-pool" gradientUnits="userSpaceOnUse" cx={r1(lamp.x)} cy={r1(g.floorY + 14)} r={r1(down.spread * 1.7)} gradientTransform={`translate(0 ${r1(g.floorY + 14)}) scale(1 0.24) translate(0 ${r1(-(g.floorY + 14))})`}>
          <Stops stops={[[0, '#fff6e2', 0.9], [0.4, '#f8e3bc', 0.55], [1, '#f5e2c0', 0]]} />
        </radialGradient>
        <linearGradient id="hw-skirting" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#d8cebe'], [1, '#c4b8a5']]} />
        </linearGradient>
        <linearGradient id="hw-door-leaf" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={r1(g.corner)} y2="0">
          <Stops stops={[[0, '#c3b7a4'], [1, '#d0c5b3']]} />
        </linearGradient>
        <linearGradient id="hw-architrave" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={r1(g.corner)} y2="0">
          <Stops stops={[[0, '#cbc0ae'], [1, '#d9cfbf']]} />
        </linearGradient>
        <ConeGradient id="hw-up-main" spec={up.spec} reachY={up.reachY} stops={CONE_MAIN} />
        <ConeGradient id="hw-up-core" spec={up.spec} reachY={up.reachY} stops={CONE_CORE} />
        <ConeGradient id="hw-up-halo" spec={up.spec} reachY={up.reachY} stops={CONE_HALO} />
        <ConeGradient id="hw-down-main" spec={down.spec} reachY={down.reachY} stops={CONE_MAIN} />
        <ConeGradient id="hw-down-core" spec={down.spec} reachY={down.reachY} stops={CONE_CORE} />
        <ConeGradient id="hw-down-halo" spec={down.spec} reachY={down.reachY} stops={CONE_HALO} />
        <linearGradient id="hw-anodized" gradientUnits="userSpaceOnUse" x1={r1(lamp.x - lamp.halfW * 1.2)} y1="0" x2={r1(lamp.x + lamp.halfW * 1.2)} y2="0">
          <Stops stops={[[0, '#0d0c0b'], [0.22, '#2b2926'], [0.5, '#1a1917'], [0.86, '#121110'], [1, '#2a2825']]} />
        </linearGradient>
        <linearGradient id="hw-anodized-sheen" gradientUnits="userSpaceOnUse" x1={r1(lamp.x - lamp.halfW * 1.2)} y1="0" x2={r1(lamp.x + lamp.halfW * 1.2)} y2="0">
          <Stops stops={[[0, '#ffffff', 0], [0.26, '#ffffff', 0], [0.33, '#f3e8d6', 0.34], [0.4, '#ffffff', 0], [0.9, '#ffffff', 0], [0.96, '#d8d2c8', 0.16], [1, '#ffffff', 0]]} />
        </linearGradient>
        <radialGradient id="hw-sconce-shadow">
          <Stops stops={[[0, '#2e2318', 0.3], [0.6, '#2e2318', 0.12], [1, '#2e2318', 0]]} />
        </radialGradient>
        <radialGradient id="hw-bloom">
          <Stops stops={[[0, '#fffdf7', 0.85], [0.35, '#fff7e8', 0.32], [1, '#fff7e8', 0]]} />
        </radialGradient>
        <radialGradient id="hw-vignette" cx="0.62" cy="0.42" r="0.78">
          <Stops stops={[[0, '#2a2016', 0], [0.66, '#2a2016', 0.04], [1, '#2a2016', 0.2]]} />
        </radialGradient>
        <clipPath id="hw-floor-clip">
          <path d={g.floor} />
        </clipPath>
        <clipPath id="hw-ceiling-clip">
          <path d={g.ceiling} />
        </clipPath>
      </defs>

      <g className="hero-scene__layer" data-depth="far">
        {/* Back wall: smooth matte plaster, lit round the sconce, settling toward the corners. */}
        <rect {...BLEED} fill="url(#hw-wall)" />
        <rect {...BLEED} fill="url(#hw-wall-falloff)" />
        <rect {...BLEED} fill="url(#hw-ambient)" />

        <path d={g.ceiling} fill="url(#hw-ceiling)" />
        <g clipPath="url(#hw-ceiling-clip)">
          <ellipse cx={r1(lamp.x)} cy={r1(g.ceilingY)} rx={r1(up.spread * 1.5)} ry="70" fill="url(#hw-ceiling-spot)" />
        </g>
        <line x1="-160" y1={r1(g.ceilingY)} x2="1760" y2={r1(g.ceilingY)} stroke="#6e5f4c" strokeOpacity="0.35" strokeWidth="1.2" />

        {/* Light: a soft halo, the crisp hyperbolic cone and its white-hot core, up and down. */}
        <path d={up.halo} fill="url(#hw-up-halo)" />
        <path d={down.halo} fill="url(#hw-down-halo)" />
        <path d={up.main} fill="url(#hw-up-main)" />
        <path d={down.main} fill="url(#hw-down-main)" />
        <path d={up.core} fill="url(#hw-up-core)" />
        <path d={down.core} fill="url(#hw-down-core)" />

        <path d={g.backSkirting} fill="url(#hw-skirting)" />
        <line x1="-160" y1={r1(g.floorY)} x2="1760" y2={r1(g.floorY)} stroke="#4a3b2b" strokeOpacity="0.42" strokeWidth="1.4" />

        {/* Herringbone oak in perspective, the downlight pooling on it at the wall. */}
        <path d={g.floor} fill="url(#hw-floor)" />
        <g clipPath="url(#hw-floor-clip)">
          <path d={g.parquet.along} fill="#c8aa86" stroke="#7a5a3c" strokeOpacity="0.3" strokeWidth="0.8" />
          <path d={g.parquet.across} fill="#bd9f7b" stroke="#7a5a3c" strokeOpacity="0.3" strokeWidth="0.8" />
          <rect x="-160" y={r1(g.floorY)} width="1920" height="260" fill="url(#hw-floor-pool)" />
          <rect x="-160" y={r1(g.floorY)} width="1920" height="22" fill="#3d2e20" fillOpacity="0.1" />
        </g>

        <SconceBody lamp={lamp} />
      </g>

      <g className="hero-scene__layer" data-depth="near">
        {/* The side wall turns away from the light; the doorway sits deep in it. */}
        <path d={g.sideWall} fill="url(#hw-side)" />
        <path d={g.sideSkirting} fill="#b7aa96" />
        <path d={g.architrave} fill="url(#hw-architrave)" />
        <path d={g.opening} fill="#5b4c3b" fillOpacity="0.55" />
        <path d={g.farJamb} fill="#c6baa7" />
        <path d={g.headJamb} fill="#8d806d" />
        <path d={g.leaf} fill="url(#hw-door-leaf)" />
        {g.fields.map((field, i) => (
          <g key={i}>
            <path d={field.lit} fill="#ddd4c5" />
            <path d={field.shade} fill="#9f927e" />
            <path d={field.face} fill="#cabfac" />
          </g>
        ))}
        <line x1={r1(g.handle.x)} y1={r1(g.handle.y)} x2={r1(g.handle.x2)} y2={r1(g.handle.y)} stroke="#2a2420" strokeWidth={r1(g.handle.r * 1.3)} strokeLinecap="round" />
        <circle cx={r1(g.handle.x)} cy={r1(g.handle.y)} r={r1(g.handle.r * 1.6)} fill="#2a2420" />
        {/* The inside corner: one crisp line and a short band of occlusion on the back wall. */}
        <rect x={r1(g.corner)} y="-120" width="70" height="1140" fill="url(#hw-corner-ao)" />
        <line x1={r1(g.corner)} y1="-120" x2={r1(g.corner)} y2="1020" stroke="#4d3f2f" strokeOpacity="0.4" strokeWidth="1.2" />
      </g>

      <rect {...BLEED} fill="url(#hw-vignette)" />
    </svg>
  );
}

/* ---------- Scene II: 24V recessed track, linear pendant and walnut shelf ---------- */

const BOOK_TONES = Object.freeze({
  linen: { front: '#d6cab2', top: '#e6dcc8', side: '#bfb196' },
  clay: { front: '#a9673f', top: '#c07c52', side: '#8c5333' },
  ink: { front: '#2b2c2f', top: '#45464a', side: '#1d1e20' },
});

function BoxFaces({ faces, tones }) {
  return (
    <>
      {faces.top && <polygon points={poly(faces.top)} fill={tones.top} />}
      {faces.left && <polygon points={poly(faces.left)} fill={tones.side} />}
      {faces.right && <polygon points={poly(faces.right)} fill={tones.side} />}
      <polygon points={poly(faces.front)} fill={tones.front} />
    </>
  );
}

function Vase({ x, y, s, fill }) {
  // A ceramic vessel 26 cm tall: a narrow foot, a full shoulder and a short neck.
  const w = (cm) => r1(cm * s);
  const d = `M${r1(x - w(4.5))} ${r1(y)}C${r1(x - w(10))} ${r1(y - w(6))} ${r1(x - w(9))} ${r1(y - w(17))} ${r1(x - w(3))} ${r1(y - w(22))}L${r1(x - w(2.6))} ${r1(y - w(26))}L${r1(x + w(2.6))} ${r1(y - w(26))}L${r1(x + w(3))} ${r1(y - w(22))}C${r1(x + w(9))} ${r1(y - w(17))} ${r1(x + w(10))} ${r1(y - w(6))} ${r1(x + w(4.5))} ${r1(y)}Z`;
  return (
    <g>
      <ellipse cx={r1(x + w(2))} cy={r1(y)} rx={w(8)} ry={w(1.6)} fill="#2e2318" fillOpacity="0.22" />
      <path d={d} fill={fill} />
    </g>
  );
}

function Urn({ x, y, s }) {
  const w = (cm) => r1(cm * s);
  const d = `M${r1(x - w(7))} ${r1(y)}C${r1(x - w(11))} ${r1(y - w(9))} ${r1(x - w(8))} ${r1(y - w(17))} ${r1(x - w(5))} ${r1(y - w(19))}L${r1(x + w(5))} ${r1(y - w(19))}C${r1(x + w(8))} ${r1(y - w(17))} ${r1(x + w(11))} ${r1(y - w(9))} ${r1(x + w(7))} ${r1(y)}Z`;
  return (
    <g>
      <ellipse cx={r1(x + w(3))} cy={r1(y)} rx={w(11)} ry={w(2)} fill="#2e2318" fillOpacity="0.24" />
      <path d={d} fill="url(#hg-urn)" />
      <ellipse cx={r1(x)} cy={r1(y - w(19))} rx={w(5)} ry={w(1.2)} fill="#5d5245" />
    </g>
  );
}

function GalleryScene() {
  const g = heroSceneGeometry().gallery;
  const { pendant, consoleFaces, shelf } = g;
  const slabTop = consoleFaces.slab.top;
  return (
    <svg
      className="hero-scene hero-scene--gallery"
      data-scene="gallery"
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="hg-wall" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#d8cebd'], [0.5, '#d2c8b4'], [1, '#c9bfa2']]} />
        </linearGradient>
        <linearGradient id="hg-daylight" x1="0" y1="0" x2="1" y2="0.55">
          <Stops stops={[[0, '#fffaf0', 0.36], [0.34, '#fffaf0', 0.12], [0.7, '#fffaf0', 0]]} />
        </linearGradient>
        <linearGradient id="hg-falloff" x1="0" y1="0" x2="1" y2="0">
          <Stops stops={[[0, '#5a4732', 0], [0.55, '#5a4732', 0], [1, '#5a4732', 0.1]]} />
        </linearGradient>
        <linearGradient id="hg-ceiling" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#cfc6b6'], [1, '#e0d8ca']]} />
        </linearGradient>
        <linearGradient id="hg-floor" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#cdc1a9'], [1, '#bdb096']]} />
        </linearGradient>
        {g.spots.map((spot, i) => (
          <linearGradient key={spot.x} id={`hg-scallop-${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={r1(spot.scallopTop[1])} x2="0" y2={r1(spot.scallopFoot[1])}>
            <Stops stops={[[0, '#fffaf0', 0.95], [0.25, '#ffefcc', 0.7], [0.65, '#ffe1a6', 0.32], [1, '#ffd98f', 0]]} />
          </linearGradient>
        ))}
        {/* The beam in the air: white-hot at the aperture, thinning toward the stone. */}
        {g.spots.map((spot, i) => (
          <linearGradient
            key={spot.x}
            id={`hg-spot-beam-${i}`}
            gradientUnits="userSpaceOnUse"
            x1={r1(spot.apex[0])}
            y1={r1(spot.apex[1])}
            x2={r1(spot.beamEnd[0])}
            y2={r1(spot.beamEnd[1])}
          >
            <Stops stops={SPOT_BEAM} />
          </linearGradient>
        ))}
        <radialGradient id="hg-spot-bloom">
          <Stops stops={[[0, '#fffdf7', 0.9], [0.3, '#fff4dc', 0.4], [1, '#fff4dc', 0]]} />
        </radialGradient>
        <linearGradient id="hg-wash" gradientUnits="userSpaceOnUse" x1="0" y1={r1(g.washTop)} x2="0" y2={r1(g.washFoot)}>
          <Stops stops={[[0, '#fff4d8', 0.98], [0.16, '#ffe2a6', 0.84], [0.55, '#f8c977', 0.46], [1, '#f2b65c', 0.1]]} />
        </linearGradient>
        <linearGradient id="hg-beam" gradientUnits="userSpaceOnUse" x1="0" y1={r1(pendant.beamTop)} x2="0" y2={r1(g.consoleTopY)}>
          <Stops stops={[[0, '#fff1cf', 0.7], [0.4, '#ffdf9e', 0.36], [1, '#ffd27a', 0.18]]} />
        </linearGradient>
        <linearGradient id="hg-diffuser" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#fffdf6'], [1, '#ffe7b6']]} />
        </linearGradient>
        <radialGradient id="hg-pool">
          <Stops stops={[[0, '#fffaf0', 1], [0.38, '#ffe8b4', 0.86], [0.78, '#ffd27a', 0.32], [1, '#ffd27a', 0]]} />
        </radialGradient>
        <radialGradient id="hg-spill" gradientUnits="userSpaceOnUse" cx={r1(pendant.wallSpill.x)} cy={r1(pendant.wallSpill.y)} r="300" gradientTransform={`translate(0 ${r1(pendant.wallSpill.y)}) scale(1 0.5) translate(0 ${r1(-pendant.wallSpill.y)})`}>
          <Stops stops={[[0, '#ffe5ae', 0.6], [0.5, '#ffdc9c', 0.22], [1, '#ffdc9c', 0]]} />
        </radialGradient>
        <linearGradient id="hg-walnut" x1="0" y1="0" x2="1" y2="0">
          <Stops stops={[[0, '#4f311f'], [0.5, '#64412b'], [1, '#553521']]} />
        </linearGradient>
        <linearGradient id="hg-travertine" x1="0" y1="0" x2="1" y2="0">
          <Stops stops={[[0, '#dccfb5'], [1, '#e8dcc6']]} />
        </linearGradient>
        <linearGradient id="hg-urn" x1="0" y1="0" x2="1" y2="0">
          <Stops stops={[[0, '#8f8069'], [0.4, '#c4b59b'], [1, '#7c6e59']]} />
        </linearGradient>
        <linearGradient id="hg-vase" x1="0" y1="0" x2="1" y2="0">
          <Stops stops={[[0, '#b9ad9a'], [0.38, '#f0e9dd'], [1, '#a59885']]} />
        </linearGradient>
        <linearGradient id="hg-anodized" x1="0" y1="0" x2="0" y2="1">
          <Stops stops={[[0, '#3a3834'], [0.5, '#1e1d1b'], [1, '#121110']]} />
        </linearGradient>
        <radialGradient id="hg-vignette" cx="0.58" cy="0.46" r="0.8">
          <Stops stops={[[0, '#2a2016', 0], [0.7, '#2a2016', 0.03], [1, '#2a2016', 0.16]]} />
        </radialGradient>
        <clipPath id="hg-slab-clip">
          <polygon points={poly(slabTop)} />
        </clipPath>
        <clipPath id="hg-ceiling-clip">
          <path d={g.ceiling} />
        </clipPath>
      </defs>

      <g className="hero-scene__layer" data-depth="far">
        {/* A serene limestone gallery wall with crisp shadow reveals. */}
        <rect {...BLEED} fill="url(#hg-wall)" />
        <rect {...BLEED} fill="url(#hg-daylight)" />
        <rect {...BLEED} fill="url(#hg-falloff)" />
        {g.joints.map((joint, i) => (
          <line key={i} x1={r1(joint.x)} y1={r1(joint.y0)} x2={r1(joint.x)} y2={r1(joint.y1)} stroke="#8a7d63" strokeOpacity="0.34" strokeWidth="1.3" />
        ))}
        {g.courses.map((y) => (
          <g key={y}>
            <line x1="-160" y1={r1(y)} x2="1760" y2={r1(y)} stroke="#857858" strokeOpacity="0.4" strokeWidth="1.5" />
            <line x1="-160" y1={r1(y + 1.6)} x2="1760" y2={r1(y + 1.6)} stroke="#f2ecdf" strokeOpacity="0.55" strokeWidth="1" />
          </g>
        ))}

        {/* Two monopoint grazers: the crisp scallop each one lays on the stone. */}
        {g.spots.map((spot, i) => (
          <path key={spot.x} d={spot.scallop} fill={`url(#hg-scallop-${i})`} />
        ))}

        <path d={g.ceiling} fill="url(#hg-ceiling)" />
        <line x1="-160" y1={r1(g.ceilingY)} x2="1760" y2={r1(g.ceilingY)} stroke="#7d705a" strokeOpacity="0.4" strokeWidth="1.2" />
        <g clipPath="url(#hg-ceiling-clip)">
          <path d={g.slot} fill="#1c1b19" />
          <path d={g.slotLip} fill="none" stroke="#f7f1e6" strokeOpacity="0.7" strokeWidth="1" />
          <path d={g.grazerSlot} fill="#1c1b19" />
          <path d={g.grazerLip} fill="none" stroke="#f7f1e6" strokeOpacity="0.7" strokeWidth="1" />
        </g>
        {/* Each beam leaves its aperture and opens onto the scallop: one cone, drawn from the fixture down. */}
        {g.spots.map((spot, i) => (
          <path key={spot.x} d={spot.beam} fill={`url(#hg-spot-beam-${i})`} data-spot-beam={i} />
        ))}
        {g.spots.map((spot, i) => (
          <g key={spot.x}>
            <path d={spot.body} fill="url(#hg-anodized)" />
            <path d={spot.aperture} fill="#fff4d8" data-spot-aperture={i} />
            <circle cx={r1(spot.apex[0])} cy={r1(spot.apex[1])} r={r1(spot.bloom)} fill="url(#hg-spot-bloom)" />
          </g>
        ))}

        {/* The travertine floor: large slabs, joints toward the vanishing point. */}
        <path d={g.floor} fill="url(#hg-floor)" />
        {g.floorLines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#8c7f66" strokeOpacity="0.3" strokeWidth="1" />
        ))}
        <line x1="-160" y1={r1(g.floorY)} x2="1760" y2={r1(g.floorY)} stroke="#4f4331" strokeOpacity="0.38" strokeWidth="1.4" />

        {/* The floating walnut shelf and the golden wash its LED throws down the wall. */}
        <path d={g.wash} fill="url(#hg-wash)" />
        <path d={g.shelfShadow} fill="#3a2b1d" fillOpacity="0.22" />
        <BoxFaces faces={shelf} tones={{ top: '#7a503a', side: '#432a1b', front: 'url(#hg-walnut)' }} />
        <path d={g.shelfLed} fill="none" stroke="#fff6e0" strokeWidth="2.6" strokeLinecap="round" />
        {g.books.map((book) => (
          <BoxFaces key={book.x0} faces={book.faces} tones={BOOK_TONES[book.tone]} />
        ))}
        {g.stack.map((book) => (
          <BoxFaces key={book.y0} faces={book.faces} tones={BOOK_TONES[book.tone]} />
        ))}
        <Vase {...g.vase} fill="url(#hg-vase)" />

        {/* A low travertine console on a walnut base behind a shadow gap. */}
        <path d={g.consoleShadow} fill="#2f2418" fillOpacity="0.22" />
        <rect {...BLEED} fill="url(#hg-spill)" />
        <BoxFaces faces={consoleFaces.plinth} tones={{ top: '#3a2417', side: '#3d2618', front: 'url(#hg-walnut)' }} />
        <path d={g.plinthGap} fill="none" stroke="#1d140d" strokeOpacity="0.55" strokeWidth="2" />
        <BoxFaces faces={consoleFaces.slab} tones={{ top: 'url(#hg-travertine)', side: '#c6b699', front: '#d6c8ad' }} />
        {g.veins.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#a48b66" strokeOpacity="0.36" strokeWidth="0.9" />
        ))}
        {g.frontVeins.map((d, i) => (
          <path key={`f${i}`} d={d} fill="none" stroke="#a48b66" strokeOpacity="0.3" strokeWidth="0.8" />
        ))}
        <ellipse cx={r1(g.objects.bowl.x + g.objects.bowl.s * 2)} cy={r1(g.objects.bowl.y)} rx={r1(g.objects.bowl.s * 15)} ry={r1(g.objects.bowl.s * 2.4)} fill="#2e2318" fillOpacity="0.22" />
        <ellipse cx={r1(g.objects.bowl.x)} cy={r1(g.objects.bowl.y - g.objects.bowl.s * 3)} rx={r1(g.objects.bowl.s * 13)} ry={r1(g.objects.bowl.s * 3.4)} fill="#36322e" />
        <ellipse cx={r1(g.objects.bowl.x)} cy={r1(g.objects.bowl.y - g.objects.bowl.s * 5)} rx={r1(g.objects.bowl.s * 12)} ry={r1(g.objects.bowl.s * 2.2)} fill="#5a534c" />
        <Urn {...g.objects.urn} />
      </g>

      {/* The linear pendant slides along its track after the pointer; its beam and pool travel with it. */}
      <g className="hero-scene__layer hero-scene__pendant" data-depth="pendant">
        <path d={pendant.beam} fill="url(#hg-beam)" />
        <g clipPath="url(#hg-slab-clip)">
          <ellipse cx={r1(pendant.pool.x)} cy={r1(pendant.pool.y)} rx={r1(pendant.pool.rx)} ry={r1(pendant.pool.ry * 1.6)} fill="url(#hg-pool)" />
        </g>
        {pendant.cables.map(([[x0, y0], [x1, y1]]) => (
          <line key={x0} x1={r1(x0)} y1={r1(y0)} x2={r1(x1)} y2={r1(y1)} stroke="#2a2826" strokeOpacity="0.85" strokeWidth="1.1" />
        ))}
        {pendant.box.bottom && <polygon points={poly(pendant.box.bottom)} fill="url(#hg-diffuser)" />}
        <polygon points={poly(pendant.box.front)} fill="url(#hg-anodized)" />
        {pendant.box.left && <polygon points={poly(pendant.box.left)} fill="#141312" />}
      </g>

      <rect {...BLEED} fill="url(#hg-vignette)" />
    </svg>
  );
}

/** Both hero interiors, stacked: the gallery crossfades over the wall wash on the CSS clock. */
export function HeroScenes() {
  return (
    <div className="hero__stage" aria-hidden="true">
      <WallWashScene />
      <GalleryScene />
    </div>
  );
}
