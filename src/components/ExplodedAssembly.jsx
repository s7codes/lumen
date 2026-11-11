import {
  anchorSchedule,
  BLUEPRINT_VIEWS,
  CHANNEL_CM,
  fmtCm,
  Line,
  r2,
  Rect,
  SCALES,
  SHELL_CM,
  TitleBlock,
} from './BlueprintViews.jsx';

export { ExplosionSpreadControl } from './ExplosionSpreadControl.jsx';

/* Exploded assembly. Cabinet oblique: depth (Z, out of the wall) recedes up
   and right at 30 deg and half scale. Sub-assemblies leave the wall toward
   the viewer along that same axis, so every alignment point of every layer
   stays on one straight line at any spread. */

const OBLIQUE_K = 0.5;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;
const EXPLODE_GAP = 38;
const TOWARD_VIEWER = { x: -COS30, y: SIN30 };
const EXPLODED_ENV = { x: 14, y: 14, w: 292, h: 120 };
const BALLOON_R = 4.2;
const BALLOON_REACH = 11;
const AXIS_OVERRUN = 6;
const FRAME_INSET_CM = 5;

const ANCHOR_LABELS = {
  wall: 'Wall Anchor & Concealed Steel Cleat',
  floor: 'Floor Plate & Anti-Tip Wall Tie',
  ceiling: 'Ceiling Canopy & Junction Plate',
  recessed: 'Plaster-In Clip & Mounting Rail',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function optics(product) {
  const { w: W, h: H, d: D } = product.dimsCm;
  switch (product.shape) {
    case 'lightbar':
      return [{ x: 0.02 * W, y: 0.2 * H, w: 0.96 * W, h: 0.6 * H, z0: 0, zd: 1 }];
    case 'column':
      return [{ x: W / 2 - 1, y: 6, w: 2, h: H - 12, z0: 0, zd: 1 }];
    case 'cube':
      return [{ x: SHELL_CM, y: H - SHELL_CM - 1, w: W - 2 * SHELL_CM, h: 1, z0: SHELL_CM, zd: D - 2 * SHELL_CM }];
    case 'sideboard':
      return [{ x: 0.04 * W, y: 0, w: 0.92 * W, h: 1, z0: 2, zd: D * 0.6 }];
    case 'frame':
      return [{ x: -1.5, y: -1.5, w: W + 3, h: H + 3, z0: D - 0.6, zd: 0.6, ring: true }];
    case 'spot':
      return [{ x: 0.25 * W, y: 0, w: 0.5 * W, h: 0.8, z0: 0.2 * D, zd: 0.6 * D }];
    default:
      return [{ x: 0.04 * W, y: 0, w: 0.92 * W, h: clamp(H * 0.15, 0.6, 1.2), z0: 0, zd: Math.min(3, D) }];
  }
}

/**
 * Four sub-assemblies in the product's own frame: x from the left edge, y up
 * from the bottom edge, z from the front face back toward the wall (cm).
 */
export function explodedLayers(product, finish) {
  const { w: W, h: H, d: D } = product.dimsCm;
  const schedule = anchorSchedule(product);
  const lit = product.watts > 0;
  const back = Math.min(1.2, D / 2);
  const busY = product.dimsCm.h > 16 ? H - 5 : H / 2;
  let anchor;
  let bus;

  switch (product.mount) {
    case 'floor':
      anchor = [
        { x: -2, y: 0, w: W + 4, h: 1, z0: 0, zd: D },
        { x: W / 2 - 1, y: H - 6, w: 2, h: 1, z0: D, zd: 4 },
      ];
      bus = [
        { x: W / 2 - CHANNEL_CM.w / 2, y: 4, w: CHANNEL_CM.w, h: H - 8, z0: D / 2, zd: 1 },
        { x: W / 2 - 1.1, y: 2, w: 2.2, h: 1.8, z0: D / 2 - 0.4, zd: 1.8 },
      ];
      break;
    case 'ceiling':
      anchor = [{ x: 0, y: H - 1.2, w: W, h: 1.2, z0: 0, zd: D }];
      bus = [{ x: W / 2 - 1.1, y: H - 3.4, w: 2.2, h: 2, z0: D / 2 - 1, zd: 2 }];
      break;
    case 'recessed':
      anchor = [{ x: 0.02 * W, y: 0, w: 0.96 * W, h: H, z0: D, zd: 1 }];
      bus = [
        { x: 0.01 * W, y: H / 2 - 0.4, w: 0.98 * W, h: 0.8, z0: D / 2 - 0.4, zd: 0.8 },
        { x: 0.01 * W, y: 0, w: 2.2, h: H, z0: D / 2 - 0.6, zd: 1.2 },
      ];
      break;
    default: {
      const cleatH = clamp(H * 0.5, 1.2, 5);
      const cleatY = clamp(schedule.lineCm - cleatH / 2, 0, H - cleatH);
      anchor = [{ x: 0.08 * W, y: cleatY, w: 0.84 * W, h: cleatH, z0: D - back, zd: back, holes: true }];
      bus = [
        { x: 0.1 * W, y: busY - CHANNEL_CM.h / 2, w: 0.8 * W, h: CHANNEL_CM.h, z0: Math.max(0, D - 2 * back), zd: back },
        { x: 0.1 * W - 0.6, y: busY - 0.9, w: 2.2, h: 1.8, z0: Math.max(0, D - 2 * back), zd: back },
      ];
    }
  }

  return [
    {
      index: '01',
      label: ANCHOR_LABELS[product.mount] ?? ANCHOR_LABELS.wall,
      spec: `${schedule.count}x ${schedule.fixing}`,
      tone: 'steel',
      parts: anchor,
    },
    {
      index: '02',
      label: '24V DC Copper Bus & Connector Core',
      spec: lit ? `2x 2.5 mm2 Cu, 24V DC SELV, ${product.watts} W` : '2x 2.5 mm2 Cu, 24V DC SELV feed-through',
      tone: 'copper',
      parts: bus,
    },
    {
      index: '03',
      label: 'Primary Structural Body',
      spec: `${finish.label}, W ${fmtCm(W)} x H ${fmtCm(H)} x D ${fmtCm(D)} cm`,
      tone: 'body',
      parts: [{ x: 0, y: 0, w: W, h: H, z0: 0, zd: D }],
    },
    lit
      ? {
          index: '04',
          label: `Optical Diffuser & ${product.kelvin}K LED Array`,
          spec: `Opal PMMA, ${product.lumens} lm, CRI ${product.cri}+`,
          tone: 'optic',
          parts: optics(product),
        }
      : {
          index: '04',
          label: 'Anodized Cover Plate',
          spec: `6063-T5 aluminium, ${finish.label}`,
          tone: 'plate',
          parts: [{ x: 0, y: 0, w: W, h: H, z0: 0, zd: Math.min(0.3, D) }],
        },
  ];
}

/** Paper point for (x, y, z) in the product frame, at origin O and scale u. */
function projectPoint(xCm, yCm, zCm, u, origin) {
  return {
    x: origin.x + xCm * u + zCm * u * OBLIQUE_K * COS30,
    y: origin.y - yCm * u - zCm * u * OBLIQUE_K * SIN30,
  };
}

/** Paper geometry of one part: front face, receding top and side. */
function projectPart(part, u, origin) {
  const corner = projectPoint(part.x, part.y, part.z0, u, origin);
  const depth = { x: part.zd * u * OBLIQUE_K * COS30, y: -part.zd * u * OBLIQUE_K * SIN30 };
  const w = part.w * u;
  const h = Math.max(part.h * u, 0.8);
  const x = corner.x;
  const y = corner.y - h;
  return {
    face: { x, y, w, h },
    top: [
      [x, y],
      [x + w, y],
      [x + w + depth.x, y + depth.y],
      [x + depth.x, y + depth.y],
    ],
    side: [
      [x + w, y],
      [x + w + depth.x, y + depth.y],
      [x + w + depth.x, y + h + depth.y],
      [x + w, y + h],
    ],
    bounds: { x0: x, y0: y + depth.y, x1: x + w + depth.x, y1: y + h },
  };
}

function layerOffset(k) {
  return { x: r2(k * EXPLODE_GAP * TOWARD_VIEWER.x), y: r2(k * EXPLODE_GAP * TOWARD_VIEWER.y) };
}

function layoutExploded(layers, origin, u) {
  return layers.map((layer, k) => {
    const shapes = layer.parts.map((part) => ({ part, geo: projectPart(part, u, origin) }));
    // Balloons sit off the front-right corner, square to the explode axis, so a
    // neighbouring layer (displaced along the axis) never runs into them.
    const lead = shapes[0].geo;
    const attach = { x: lead.face.x + lead.face.w, y: lead.face.y + lead.face.h };
    return {
      ...layer,
      shapes,
      offset: layerOffset(k),
      attach,
      balloon: { x: attach.x + BALLOON_REACH * SIN30, y: attach.y + BALLOON_REACH * COS30 },
    };
  });
}

function explodedBounds(placed) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const layer of placed) {
    const { x: dx, y: dy } = layer.offset;
    for (const { geo } of layer.shapes) {
      box.x0 = Math.min(box.x0, geo.bounds.x0 + dx);
      box.y0 = Math.min(box.y0, geo.bounds.y0 + dy);
      box.x1 = Math.max(box.x1, geo.bounds.x1 + dx);
      box.y1 = Math.max(box.y1, geo.bounds.y1 + dy);
    }
    box.x1 = Math.max(box.x1, layer.balloon.x + BALLOON_R + dx);
    box.y0 = Math.min(box.y0, layer.balloon.y - BALLOON_R + dy);
    box.y1 = Math.max(box.y1, layer.balloon.y + BALLOON_R + dy);
  }
  return box;
}

/** Largest standard scale at which the fully exploded set fits, centred in the drawing field. */
function fitExploded(layers) {
  for (const scale of SCALES) {
    const u = 10 / scale;
    const box = explodedBounds(layoutExploded(layers, { x: 0, y: 0 }, u));
    if (box.x1 - box.x0 <= EXPLODED_ENV.w && box.y1 - box.y0 <= EXPLODED_ENV.h) {
      const origin = {
        x: EXPLODED_ENV.x + (EXPLODED_ENV.w - (box.x1 - box.x0)) / 2 - box.x0,
        y: EXPLODED_ENV.y + (EXPLODED_ENV.h - (box.y1 - box.y0)) / 2 - box.y0,
      };
      return { scale, u, origin, placed: layoutExploded(layers, origin, u) };
    }
  }
  const u = 10 / SCALES.at(-1);
  const origin = { x: EXPLODED_ENV.x + EXPLODED_ENV.w / 2, y: EXPLODED_ENV.y + EXPLODED_ENV.h / 2 };
  return { scale: SCALES.at(-1), u, origin, placed: layoutExploded(layers, origin, u) };
}

const points = (list) => list.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');

function bodyDetail(product, face, u) {
  const { x, y, w, h } = face;
  switch (product.shape) {
    case 'cube': {
      const t = SHELL_CM * u;
      return w > 2 * t && h > 2 * t ? <Rect box={{ x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t }} className="bp__inner" /> : null;
    }
    case 'sideboard':
      return <Line x1={x + w / 2} y1={y + 1} x2={x + w / 2} y2={y + h - 1} className="bp__thin" />;
    case 'frame': {
      const t = FRAME_INSET_CM * u;
      return <Rect box={{ x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t }} className="bp__inner bp__inner--felt" />;
    }
    default:
      return null;
  }
}

function PartShape({ geo, part, tone, ids, product, u }) {
  const fill = tone === 'body' ? `url(#${ids.fill})` : undefined;
  if (part.ring) {
    return <Rect box={geo.face} className="bp__halo" />;
  }
  return (
    <g className={`bp-x__part bp-x__part--${tone}`}>
      <polygon points={points(geo.side)} className="bp-x__face bp-x__face--side" />
      <polygon points={points(geo.top)} className="bp-x__face bp-x__face--top" />
      <Rect box={geo.face} className="bp-x__face bp-x__face--front" fill={fill} />
      {tone === 'body' && bodyDetail(product, geo.face, u)}
    </g>
  );
}

export function ExplodedView({ product, finish, ids }) {
  const layers = explodedLayers(product, finish);
  const { scale, u, origin, placed } = fitExploded(layers);
  const schedule = anchorSchedule(product);
  const xs = schedule.points.map((p) => p.xCm);
  const alignX = [...new Set([xs[0] ?? product.dimsCm.w / 2, xs.at(-1) ?? product.dimsCm.w / 2])];
  const alignY = product.mount === 'wall' ? schedule.lineCm : product.dimsCm.h / 2;
  const deep = Math.max(...layers[0].parts.map((part) => part.z0 + part.zd));
  const travel = 3 * EXPLODE_GAP;
  const baseLen = deep * u * OBLIQUE_K + 2 * AXIS_OVERRUN;
  const fullLen = baseLen + travel;

  return (
    <>
      <g className="bp-x__axes" data-testid="exploded-axes">
        {alignX.map((xCm) => {
          const start = projectPoint(xCm, alignY, deep, u, origin);
          const from = { x: start.x - AXIS_OVERRUN * TOWARD_VIEWER.x, y: start.y - AXIS_OVERRUN * TOWARD_VIEWER.y };
          const to = { x: from.x + fullLen * TOWARD_VIEWER.x, y: from.y + fullLen * TOWARD_VIEWER.y };
          return (
            <line
              key={xCm}
              x1={r2(from.x)}
              y1={r2(from.y)}
              x2={r2(to.x)}
              y2={r2(to.y)}
              className="bp-x__axis"
              data-testid="exploded-leader"
              style={{
                transformOrigin: `${r2(from.x)}px ${r2(from.y)}px`,
                '--axis-base': r2(baseLen / fullLen),
                '--axis-travel': r2(travel / fullLen),
              }}
            />
          );
        })}
      </g>

      {placed.map((layer) => (
        <g
          key={layer.index}
          className="bp-x__layer"
          data-testid="exploded-layer"
          data-layer={layer.index}
          data-tone={layer.tone}
          style={{ '--dx': layer.offset.x, '--dy': layer.offset.y }}
        >
          <title>{`${layer.index} / ${layer.label}`}</title>
          {layer.shapes.map(({ part, geo }, i) => (
            <PartShape key={i} geo={geo} part={part} tone={layer.tone} ids={ids} product={product} u={u} />
          ))}
          {layer.index === '01' &&
            layer.parts[0].holes &&
            schedule.points.map((p) => {
              const hole = projectPoint(p.xCm, alignY, layer.parts[0].z0, u, origin);
              return (
                <g key={p.xCm} className="bp__anchor">
                  <Line x1={hole.x - 1.8} y1={hole.y} x2={hole.x + 1.8} y2={hole.y} />
                  <Line x1={hole.x} y1={hole.y - 1.8} x2={hole.x} y2={hole.y + 1.8} />
                </g>
              );
            })}
          <g className="bp-x__balloon">
            <Line
              x1={layer.attach.x}
              y1={layer.attach.y}
              x2={layer.balloon.x - BALLOON_R * SIN30}
              y2={layer.balloon.y - BALLOON_R * COS30}
              className="bp-x__lead"
            />
            <circle cx={r2(layer.balloon.x)} cy={r2(layer.balloon.y)} r={BALLOON_R} />
            <text x={r2(layer.balloon.x)} y={r2(layer.balloon.y + 1.9)} textAnchor="middle">
              {layer.index}
            </text>
          </g>
        </g>
      ))}

      <text x={r2(EXPLODED_ENV.x + EXPLODED_ENV.w)} y={r2(EXPLODED_ENV.y + 2)} textAnchor="end" className="bp__note bp-x__assembled">
        Assembled. Raise the spread to separate the four sub-assemblies.
      </text>

      <g className="bp-x__parts" data-testid="exploded-parts">
        {layers.map((layer, i) => {
          const x = i % 2 === 0 ? 14 : 166;
          const y = 148 + Math.floor(i / 2) * 17;
          return (
            <g key={layer.index} data-testid="exploded-part" data-layer={layer.index}>
              <text x={x} y={y} className="bp-x__part-label">
                {`${layer.index} / ${layer.label}`}
              </text>
              <text x={x} y={y + 7} className="bp__note">
                {layer.spec}
              </text>
            </g>
          );
        })}
      </g>
      <TitleBlock product={product} view={BLUEPRINT_VIEWS[3]} scale={scale} />
    </>
  );
}
