import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useCardTilt } from '../hooks/useCardTilt.js';
import { useScrollReveal } from '../hooks/useScrollReveal.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { SHOWCASE_3D_ID } from '../lib/routes.js';
import { ArrowRight } from './icons.jsx';

/*
 * Isometric schematic of the Gallery envelope (640 x 520 x 300 cm), drawn
 * once at module load. Room frame in cm: x along the north wall, y up, z
 * toward the south wall. The near walls are section-cut to dashed lines,
 * exactly as the planner's orbit lens shows them.
 */

const W = 640;
const D = 520;
const H = 300;
const K = 0.7;
const CX = 444;
const CY = 222;
const COS30 = Math.cos(Math.PI / 6);

function iso(x, y, z) {
  return [CX + (x - z) * COS30 * K, CY + (x + z) * 0.5 * K - y * K];
}

const fmt = (n) => Number(n.toFixed(1));

function points(...corners) {
  return corners.map((c) => iso(...c).map(fmt).join(',')).join(' ');
}

function segment(a, b) {
  const [x1, y1] = iso(...a).map(fmt);
  const [x2, y2] = iso(...b).map(fmt);
  return { x1, y1, x2, y2 };
}

/** An arrow from `from` along a room-frame vector, with a head sized in screen px. */
function arrow(from, to, head = 9) {
  const [x1, y1] = iso(...from);
  const [x2, y2] = iso(...to);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const spread = 0.42;
  const tip = [x2, y2];
  const left = [x2 - head * Math.cos(a - spread), y2 - head * Math.sin(a - spread)];
  const right = [x2 - head * Math.cos(a + spread), y2 - head * Math.sin(a + spread)];
  return {
    line: { x1: fmt(x1), y1: fmt(y1), x2: fmt(x2 - head * 0.6 * Math.cos(a)), y2: fmt(y2 - head * 0.6 * Math.sin(a)) },
    head: [tip, left, right].map((p) => p.map(fmt).join(',')).join(' '),
  };
}

const GRID_STEP = 80;
function gridStops(length) {
  return Array.from({ length: Math.ceil(length / GRID_STEP) - 1 }, (_, i) => (i + 1) * GRID_STEP);
}

const FLOOR_GRID = [
  ...gridStops(W).map((x) => segment([x, 0, 0], [x, 0, D])),
  ...gridStops(D).map((z) => segment([0, 0, z], [W, 0, z])),
];

const SHELF = { x0: 250, x1: 370, y0: 120, y1: 128, d: 25 };
const GIZMO_AT = [(SHELF.x0 + SHELF.x1) / 2, (SHELF.y0 + SHELF.y1) / 2, SHELF.d];
const EYE = [320, 165, 405];
const [EYE_X, EYE_Y] = iso(...EYE).map(fmt);
const CONE_PIVOT = `${EYE_X}px ${EYE_Y}px`;

const SCHEMATIC = {
  floor: points([0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]),
  north: points([0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]),
  west: points([0, 0, 0], [0, 0, D], [0, H, D], [0, H, 0]),
  cap: points([-12, H, -12], [W, H, -12], [W, H, 0], [0, H, 0], [0, H, D], [-12, H, D]),
  cuts: [
    segment([W, 0, 0], [W, 0, D]),
    segment([W, 0, D], [0, 0, D]),
    segment([W, 0, D], [W, H, D]),
    segment([W, H, 0], [W, H, D]),
    segment([W, H, D], [0, H, D]),
  ],
  wash: points([232, 196, 0], [388, 196, 0], [470, 0, 0], [150, 0, 0]),
  bar: points([232, 196, 0], [388, 196, 0], [388, 202, 0], [232, 202, 0]),
  pool: iso(310, 0, 70).map(fmt),
  shelf: {
    top: points([SHELF.x0, SHELF.y1, 0], [SHELF.x1, SHELF.y1, 0], [SHELF.x1, SHELF.y1, SHELF.d], [SHELF.x0, SHELF.y1, SHELF.d]),
    front: points(
      [SHELF.x0, SHELF.y0, SHELF.d],
      [SHELF.x1, SHELF.y0, SHELF.d],
      [SHELF.x1, SHELF.y1, SHELF.d],
      [SHELF.x0, SHELF.y1, SHELF.d],
    ),
    side: points([SHELF.x1, SHELF.y0, 0], [SHELF.x1, SHELF.y0, SHELF.d], [SHELF.x1, SHELF.y1, SHELF.d], [SHELF.x1, SHELF.y1, 0]),
  },
  frame: points([4, 100, 200], [4, 100, 280], [4, 190, 280], [4, 190, 200]),
  frameInset: points([4, 108, 208], [4, 108, 272], [4, 182, 272], [4, 182, 208]),
  gizmo: {
    x: arrow(GIZMO_AT, [GIZMO_AT[0] + 78, GIZMO_AT[1], GIZMO_AT[2]]),
    y: arrow(GIZMO_AT, [GIZMO_AT[0], GIZMO_AT[1] + 62, GIZMO_AT[2]]),
    z: arrow(GIZMO_AT, [GIZMO_AT[0], GIZMO_AT[1], GIZMO_AT[2] + 70]),
    origin: iso(...GIZMO_AT).map(fmt),
  },
  laser: segment([SHELF.x0, SHELF.y0, SHELF.d], [SHELF.x0, 0, SHELF.d]),
  laserAt: iso(SHELF.x0, SHELF.y0 / 2, SHELF.d).map(fmt),
  cone: points(EYE, [24, 165, 30], [616, 165, 30]),
  coneFar: iso(320, 165, 30).map(fmt),
  plumb: segment([EYE[0], 0, EYE[2]], EYE),
  feet: points([EYE[0] - 16, 0, EYE[2] - 16], [EYE[0] + 16, 0, EYE[2] - 16], [EYE[0] + 16, 0, EYE[2] + 16], [EYE[0] - 16, 0, EYE[2] + 16]),
  compass: arrow([W + 110, 0, 70], [W + 110, 0, -20], 8),
  compassAt: iso(W + 110, 0, -52).map(fmt),
  washLabel: iso(388, 196, 0).map(fmt),
  cutLabel: iso(W, 0, D / 2).map(fmt),
  washTop: fmt(iso(310, 196, 0)[1]),
  washBottom: fmt(iso(310, 0, 0)[1]),
};

function RoomSchematic() {
  const s = SCHEMATIC;
  const g = s.gizmo;
  return (
    <svg
      className="showcase3d__svg"
      viewBox="0 0 960 640"
      role="img"
      aria-labelledby="showcase3d-svg-title"
      focusable="false"
    >
      <title id="showcase3d-svg-title">
        Isometric cutaway of a 640 x 520 x 300 cm room: a lit shelf with a transform gizmo on the north wall, an
        acoustic frame on the west wall and an observer at 165 cm eye level looking at the north wall.
      </title>
      <defs>
        <linearGradient id="showcase3d-wash" gradientUnits="userSpaceOnUse" x1="0" y1={s.washTop} x2="0" y2={s.washBottom}>
          <stop offset="0" stopColor="#f0b273" stopOpacity="0.42" />
          <stop offset="0.55" stopColor="#e8923a" stopOpacity="0.12" />
          <stop offset="1" stopColor="#e8923a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="showcase3d-pool">
          <stop offset="0" stopColor="#f0b273" stopOpacity="0.26" />
          <stop offset="1" stopColor="#e8923a" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id="showcase3d-cone"
          gradientUnits="userSpaceOnUse"
          x1={EYE_X}
          y1={EYE_Y}
          x2={s.coneFar[0]}
          y2={s.coneFar[1]}
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      <polygon className="showcase3d__floor" points={s.floor} />
      {FLOOR_GRID.map((line, i) => (
        <line key={i} className="showcase3d__grid" {...line} />
      ))}
      <ellipse className="showcase3d__pool" cx={s.pool[0]} cy={s.pool[1]} rx="150" ry="86" fill="url(#showcase3d-pool)" />

      <polygon className="showcase3d__wall showcase3d__wall--west" points={s.west} />
      <polygon className="showcase3d__wall showcase3d__wall--north" points={s.north} />
      <polygon className="showcase3d__cap" points={s.cap} />
      <polygon className="showcase3d__wash" points={s.wash} fill="url(#showcase3d-wash)" />
      <polygon className="showcase3d__bar" points={s.bar} />

      <polygon className="showcase3d__frame" points={s.frame} />
      <polygon className="showcase3d__frame-inset" points={s.frameInset} />

      <g className="showcase3d__shelf">
        <polygon points={s.shelf.side} data-face="side" />
        <polygon points={s.shelf.top} data-face="top" />
        <polygon points={s.shelf.front} data-face="front" />
      </g>

      {s.cuts.map((line, i) => (
        <line key={i} className="showcase3d__cut" {...line} />
      ))}

      <g className="showcase3d__eye">
        <polygon
          className="showcase3d__cone"
          points={s.cone}
          fill="url(#showcase3d-cone)"
          style={{ transformOrigin: CONE_PIVOT }}
        />
        <line className="showcase3d__plumb" {...s.plumb} />
        <polygon className="showcase3d__feet" points={s.feet} />
        <line className="showcase3d__crosshair" x1={EYE_X - 7} y1={EYE_Y} x2={EYE_X + 7} y2={EYE_Y} />
        <line className="showcase3d__crosshair" x1={EYE_X} y1={EYE_Y - 7} x2={EYE_X} y2={EYE_Y + 7} />
      </g>

      <line className="showcase3d__laser" {...s.laser} />

      <g className="showcase3d__gizmo">
        {['z', 'x', 'y'].map((axis) => (
          <g key={axis} data-axis={axis}>
            <line {...g[axis].line} />
            <polygon points={g[axis].head} />
          </g>
        ))}
        <rect x={g.origin[0] - 3.5} y={g.origin[1] - 3.5} width="7" height="7" className="showcase3d__gizmo-origin" />
      </g>

      <g className="showcase3d__compass">
        <line {...s.compass.line} />
        <polygon points={s.compass.head} />
        <text x={s.compassAt[0]} y={s.compassAt[1]} textAnchor="middle">
          N
        </text>
      </g>

      <g className="showcase3d__labels" aria-hidden="true">
        <text x={s.washLabel[0] + 18} y={s.washLabel[1] - 30}>
          24V wall wash / 2700K
        </text>
        <text x={g.x.line.x2 + 22} y={g.x.line.y2 + 6}>
          XYZ gizmo / 5 cm snap
        </text>
        <text x={s.laserAt[0] - 14} y={s.laserAt[1]} textAnchor="end">
          FFL +{SHELF.y0}
        </text>
        <text x={EYE_X + 18} y={EYE_Y + 4}>
          Eye 165 cm / 78 deg lens
        </text>
        <text x={s.cutLabel[0] + 18} y={s.cutLabel[1] + 4}>
          Section cut / near walls
        </text>
      </g>
    </svg>
  );
}

const PILLARS = Object.freeze([
  {
    index: '01',
    title: '360-Degree Four-Wall Envelope',
    body: 'Orbit every wall without a stop, from 5 deg above the floor to an 85 deg plan view. Envelopes run from a compact bedroom to a 900 x 900 cm loft.',
    spec: 'Yaw -180 / +180 deg / Pitch 5-85 deg',
  },
  {
    index: '02',
    title: '165 cm Eye-Level Walkthrough',
    body: 'Stand where you will stand. A 78 deg architectural lens at eye height, widened to 92 deg on the wheel, with vertical illuminance read at the eye.',
    spec: 'Eye 165 cm / FOV 50-92 deg / lx at eye',
  },
  {
    index: '03',
    title: 'Direct 3D Raycast & Gizmo',
    body: 'Take a module and slide it across the wall plane under the cursor. Transform gizmo, axis locks and laser dimensions to floor, ceiling and both corners.',
    spec: 'Ray to wall plane / 5 cm snap / X Y locks',
  },
]);

function Pillar({ pillar }) {
  const reveal = useScrollReveal();
  const cardRef = useRef(null);
  useCardTilt(cardRef);
  return (
    <li ref={reveal} className="showcase3d__pillar-cell reveal-up">
      <article ref={cardRef} className="showcase3d__pillar">
        <p className="index-label">
          <span className="index-label__num">{pillar.index}</span> / Capability
        </p>
        <h3 className="showcase3d__pillar-title">{pillar.title}</h3>
        <p className="showcase3d__pillar-body">{pillar.body}</p>
        <p className="showcase3d__pillar-spec mono">{pillar.spec}</p>
      </article>
    </li>
  );
}

/**
 * Overview showcase for the 3D Spatial Studio. Everything here is SVG and
 * CSS: the overview still downloads no WebGL. The launch key warms the
 * planner chunks on intent, like the navbar.
 */
export function SpatialShowcase() {
  const reveal = useScrollReveal();
  const warm = () => prefetchRoute('/room-3d');
  return (
    <section
      id={SHOWCASE_3D_ID}
      className="showcase3d container"
      aria-labelledby="showcase3d-title"
      data-testid="home-3d-showcase"
      tabIndex={-1}
    >
      <header ref={reveal} className="section-head showcase3d__head reveal-up">
        <p className="index-label">
          <span className="index-label__num">04</span> / 3D Spatial Studio
        </p>
        <h2 id="showcase3d-title" className="section-head__title showcase3d__title">
          Step inside a four-walled room before a single hole is drilled.
        </h2>
        <p className="section-head__lede">
          The 3D Spatial Studio builds the room to the centimetre, lights it from fixture data and lets you stand in it.
          Plan all four walls, then walk the result at eye level.
        </p>
      </header>

      <div className="showcase3d__rig">
        <figure ref={reveal} className="showcase3d__stage bento reveal-cinematic">
          <div className="showcase3d__stage-bar mono" aria-hidden="true">
            <span>Gallery / 640 x 520 x 300 cm</span>
            <span>Orbit cutaway / AZ 024</span>
          </div>
          <RoomSchematic />
          <figcaption className="showcase3d__legend mono">
            <span data-key="eye">Eye 165 cm / 78 deg lens</span>
            <span data-key="gizmo">XYZ transform gizmo</span>
            <span data-key="wash">24V photometric wash</span>
          </figcaption>
        </figure>

        <ul className="showcase3d__pillars reveal-stagger">
          {PILLARS.map((pillar) => (
            <Pillar key={pillar.index} pillar={pillar} />
          ))}
        </ul>
      </div>

      <div ref={reveal} className="showcase3d__launch bento reveal-up">
        <div className="showcase3d__launch-copy">
          <p className="showcase3d__launch-title">Four walls, one 24V run, one bill of materials.</p>
          <p className="showcase3d__launch-spec mono">WebGL 2 / 240-900 cm envelopes / OBJ and 2D Wall Studio bridge</p>
        </div>
        <Link
          to="/room-3d"
          className="button button--primary showcase3d__cta"
          data-testid="launch-3d-studio-cta"
          onPointerEnter={warm}
          onFocus={warm}
        >
          Launch 3D Spatial Studio
          <ArrowRight />
        </Link>
      </div>
    </section>
  );
}
