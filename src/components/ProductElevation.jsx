import { useId } from 'react';

const VIEW_W = 240;
const VIEW_H = 150;
const ENVELOPE = { x: 22, y: 18, w: 176, h: 92 };
const SCALES = [2, 5, 10, 20, 25, 50];
const BEAM_HALF_ANGLE = (18 * Math.PI) / 180;

const r2 = (value) => Math.round(value * 100) / 100;
const rectOf = (b) => ({ x: r2(b.x), y: r2(b.y), width: r2(b.w), height: r2(b.h) });
const pointsOf = (points) => points.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ');

// Drawing units are paper millimetres: a part drawn at 1:N spans
// (cm * 10) / N units. The chosen scale is the largest standard one at which
// the whole front elevation fits the drawing envelope.
function layout(product) {
  const { w: wCm, h: hCm } = product.dimsCm;
  const scale =
    SCALES.find((n) => (wCm * 10) / n <= ENVELOPE.w && (hCm * 10) / n <= ENVELOPE.h) ?? SCALES.at(-1);
  const unitsPerCm = 10 / scale;
  const w = wCm * unitsPerCm;
  const h = Math.max(hCm * unitsPerCm, 2.4);
  const x = ENVELOPE.x + (ENVELOPE.w - w) / 2;

  let y = ENVELOPE.y + (ENVELOPE.h - h) * 0.38;
  if (product.mount === 'floor') y = ENVELOPE.y + ENVELOPE.h - h;
  if (product.mount === 'ceiling') y = ENVELOPE.y;

  return { scale, unitsPerCm, box: { x, y, w, h } };
}

function Texture({ id, texture, vertical }) {
  const transform = vertical ? 'rotate(90)' : undefined;
  if (texture === 'grain') {
    return (
      <pattern id={id} width="28" height="5" patternUnits="userSpaceOnUse" patternTransform={transform}>
        <path className="elev__grain" d="M0 1.2 C7 0.4 14 2 21 1.1 S28 1.4 28 1.2" />
        <path className="elev__grain elev__grain--fine" d="M0 3.6 C6 4.3 15 2.9 22 3.8 S28 3.5 28 3.6" />
      </pattern>
    );
  }
  if (texture === 'brushed') {
    return (
      <pattern id={id} width="6" height="1.1" patternUnits="userSpaceOnUse" patternTransform={transform}>
        <line className="elev__brush" x1="0" y1="0.5" x2="6" y2="0.5" />
      </pattern>
    );
  }
  return null;
}

function Surface({ box, ids, textured, rx = 0.5 }) {
  const rect = rectOf(box);
  return (
    <>
      <rect {...rect} rx={rx} fill={`url(#${ids.body})`} />
      {textured && <rect {...rect} rx={rx} fill={`url(#${ids.texture})`} />}
      <rect {...rect} rx={rx} className="elev__edge" />
    </>
  );
}

function Wash({ box, ids, spread, length, inset = 2 }) {
  const top = box.y + box.h;
  const points = [
    [box.x + inset, top],
    [box.x + box.w - inset, top],
    [box.x + box.w + spread, top + length],
    [box.x - spread, top + length],
  ];
  return <polygon points={pointsOf(points)} fill={`url(#${ids.glow})`} />;
}

function Led({ x, y, w, h = 0.7 }) {
  return <rect className="elev__led" {...rectOf({ x, y, w, h })} />;
}

function Ground({ y, side }) {
  const x1 = ENVELOPE.x - 10;
  const x2 = ENVELOPE.x + ENVELOPE.w + 10;
  const hatches = [];
  for (let x = x1 + 4; x <= x2; x += 5) hatches.push(x);
  return (
    <g className="elev__ground">
      <line x1={x1} y1={r2(y)} x2={x2} y2={r2(y)} />
      {hatches.map((x) => (
        <line key={x} x1={x} y1={r2(y)} x2={x - 3} y2={r2(y + 3 * side)} />
      ))}
    </g>
  );
}

function SpotBody({ box, ids, textured, lit }) {
  const cx = box.x + box.w / 2;
  const canopy = { x: cx - box.w * 0.32, y: box.y, w: box.w * 0.64, h: box.h * 0.12 };
  const stem = { x: cx - 0.8, y: canopy.y + canopy.h, w: 1.6, h: box.h * 0.16 };
  const pivotY = stem.y + stem.h;
  const head = { x: cx - box.w * 0.24, y: pivotY, w: box.w * 0.48, h: box.h * 0.62 };
  const lensY = head.y + head.h;
  const lensR = head.w * 0.38;
  const throwLength = 80;
  const spread = throwLength * Math.tan(BEAM_HALF_ANGLE);
  const beam = [
    [cx - lensR, lensY],
    [cx + lensR, lensY],
    [cx + lensR + spread, lensY + throwLength],
    [cx - lensR - spread, lensY + throwLength],
  ];

  return (
    <>
      <Surface box={canopy} ids={ids} textured={textured} />
      <rect className="elev__metal" {...rectOf(stem)} />
      <g transform={`rotate(-28 ${r2(cx)} ${r2(pivotY)})`}>
        {lit && <polygon points={pointsOf(beam)} fill={`url(#${ids.glow})`} />}
        <Surface box={head} ids={ids} textured={textured} rx={1} />
        {lit && <Led x={cx - lensR} y={lensY - 0.9} w={lensR * 2} h={0.9} />}
      </g>
    </>
  );
}

function ShapeBody({ product, box, unitsPerCm, ids, textured }) {
  const lit = product.watts > 0;
  const cx = box.x + box.w / 2;
  const bottom = box.y + box.h;

  switch (product.shape) {
    case 'shelf':
      return (
        <>
          {lit && <Wash box={box} ids={ids} spread={10} length={34} />}
          <Surface box={box} ids={ids} textured={textured} />
          {lit && <Led x={box.x + 3} y={bottom - 0.7} w={box.w - 6} />}
        </>
      );

    case 'cube': {
      const t = Math.max(1.8 * unitsPerCm, 1.4);
      const inner = { x: box.x + t, y: box.y + t, w: box.w - 2 * t, h: box.h - 2 * t };
      return (
        <>
          <Surface box={box} ids={ids} textured={textured} />
          <rect className="elev__void" {...rectOf(inner)} />
          {lit && <rect {...rectOf(inner)} fill={`url(#${ids.glow})`} />}
          {lit && <Led x={inner.x + 1} y={inner.y} w={inner.w - 2} h={0.8} />}
        </>
      );
    }

    case 'sideboard':
      return (
        <>
          {lit && <Wash box={box} ids={ids} spread={6} length={20} />}
          <Surface box={box} ids={ids} textured={textured} />
          <rect
            className="elev__joint"
            {...rectOf({ x: box.x + 1.2, y: box.y + 1.2, w: box.w - 2.4, h: box.h - 2.4 })}
          />
          <line className="elev__joint" x1={r2(cx)} y1={r2(box.y + 1.2)} x2={r2(cx)} y2={r2(bottom - 1.2)} />
          {lit && <Led x={box.x + 3} y={bottom - 0.7} w={box.w - 6} />}
        </>
      );

    case 'lightbar':
      return (
        <>
          {lit && <Wash box={box} ids={ids} spread={22} length={44} inset={0} />}
          <Surface box={box} ids={ids} textured={textured} />
          {lit && (
            <rect
              className="elev__diffuser"
              {...rectOf({ x: box.x + 1, y: box.y + box.h * 0.58, w: box.w - 2, h: box.h * 0.28 })}
            />
          )}
        </>
      );

    case 'column':
      return (
        <>
          {lit && (
            <rect
              {...rectOf({ x: box.x - 24, y: box.y - 4, w: box.w + 48, h: box.h + 4 })}
              fill={`url(#${ids.halo})`}
            />
          )}
          <Surface box={box} ids={ids} textured={textured} />
          {lit && (
            <rect
              className="elev__diffuser"
              {...rectOf({ x: box.x + box.w * 0.34, y: box.y + 2.5, w: box.w * 0.32, h: box.h - 6 })}
              rx={0.4}
            />
          )}
          <rect className="elev__metal" {...rectOf({ x: box.x - 2.5, y: bottom - 1, w: box.w + 5, h: 1 })} />
        </>
      );

    case 'spot':
      return <SpotBody box={box} ids={ids} textured={textured} lit={lit} />;

    case 'frame': {
      const t = Math.max(3 * unitsPerCm, 2);
      const inner = { x: box.x + t, y: box.y + t, w: box.w - 2 * t, h: box.h - 2 * t };
      const grooves = [];
      for (let gx = inner.x + 2.5; gx < inner.x + inner.w - 1; gx += 2.5) grooves.push(r2(gx));
      return (
        <>
          {lit && (
            <rect
              {...rectOf({ x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 })}
              fill={`url(#${ids.halo})`}
            />
          )}
          <Surface box={box} ids={ids} textured={textured} rx={0.4} />
          <rect className="elev__felt" {...rectOf(inner)} />
          {grooves.map((gx) => (
            <line key={gx} className="elev__groove" x1={gx} y1={r2(inner.y)} x2={gx} y2={r2(inner.y + inner.h)} />
          ))}
        </>
      );
    }

    case 'track':
      return (
        <>
          <rect
            className="elev__flange"
            {...rectOf({ x: box.x - 1.2, y: box.y - 1.2, w: box.w + 2.4, h: box.h + 2.4 })}
          />
          <Surface box={box} ids={ids} textured={textured} rx={0.2} />
          <line
            className="elev__bus"
            x1={r2(box.x + 1)}
            y1={r2(box.y + box.h / 2)}
            x2={r2(box.x + box.w - 1)}
            y2={r2(box.y + box.h / 2)}
          />
        </>
      );

    default:
      return <Surface box={box} ids={ids} textured={textured} />;
  }
}

function anchorPoints(product, box) {
  const n = product.mountingPoints;
  const cx = box.x + box.w / 2;
  if (product.mount === 'floor') return [[cx, box.y + 5]];
  if (product.mount === 'ceiling') return [[cx, box.y + box.h * 0.06]];
  if (product.shape === 'track' && n > 1) {
    return Array.from({ length: n }, (_, i) => [box.x + 3 + ((box.w - 6) * i) / (n - 1), box.y + box.h / 2]);
  }
  const y = box.h > 16 ? box.y + 5 : box.y + box.h / 2;
  return Array.from({ length: n }, (_, i) => [box.x + (box.w * (i + 1)) / (n + 1), y]);
}

function Tick({ x, y }) {
  return <line x1={r2(x - 1.6)} y1={r2(y + 1.6)} x2={r2(x + 1.6)} y2={r2(y - 1.6)} />;
}

function TechnicalOverlay({ product, box, scale }) {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const cx = box.x + box.w / 2;
  const midY = box.y + box.h / 2;
  const dimY = ENVELOPE.y + ENVELOPE.h + 13;
  const dimX = right + 8;
  const textX = dimX + 6;

  return (
    <g className="elev__tech">
      <line className="elev__axis" x1={r2(cx)} y1={r2(box.y - 6)} x2={r2(cx)} y2={r2(bottom + 6)} />

      <g className="elev__dim">
        <line x1={r2(box.x)} y1={r2(bottom + 2)} x2={r2(box.x)} y2={r2(dimY + 2.5)} />
        <line x1={r2(right)} y1={r2(bottom + 2)} x2={r2(right)} y2={r2(dimY + 2.5)} />
        <line x1={r2(box.x - 2)} y1={dimY} x2={r2(right + 2)} y2={dimY} />
        <Tick x={box.x} y={dimY} />
        <Tick x={right} y={dimY} />

        <line x1={r2(right + 2)} y1={r2(box.y)} x2={r2(dimX + 2.5)} y2={r2(box.y)} />
        <line x1={r2(right + 2)} y1={r2(bottom)} x2={r2(dimX + 2.5)} y2={r2(bottom)} />
        <line x1={r2(dimX)} y1={r2(box.y - 2)} x2={r2(dimX)} y2={r2(bottom + 2)} />
        <Tick x={dimX} y={box.y} />
        <Tick x={dimX} y={bottom} />
      </g>

      <text className="elev__dim-text" x={r2(cx)} y={dimY - 2} textAnchor="middle">
        {product.dimsCm.w}
      </text>
      <text
        className="elev__dim-text"
        x={r2(textX)}
        y={r2(midY)}
        textAnchor="middle"
        transform={`rotate(-90 ${r2(textX)} ${r2(midY)})`}
      >
        {product.dimsCm.h}
      </text>

      {anchorPoints(product, box).map(([x, y]) => (
        <g key={`${r2(x)}-${r2(y)}`} className="elev__anchor">
          <circle cx={r2(x)} cy={r2(y)} r="1.5" />
          <line x1={r2(x - 2.6)} y1={r2(y)} x2={r2(x + 2.6)} y2={r2(y)} />
          <line x1={r2(x)} y1={r2(y - 2.6)} x2={r2(x)} y2={r2(y + 2.6)} />
        </g>
      ))}

      <text className="elev__label" x="8" y="10">
        Front elevation
      </text>
      <text className="elev__label" x={VIEW_W - 8} y="10" textAnchor="end">
        cm / 1:{scale}
      </text>
    </g>
  );
}

export function ProductElevation({ product, finish, technical = false }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const ids = {
    body: `${uid}-body`,
    texture: `${uid}-texture`,
    glow: `${uid}-glow`,
    halo: `${uid}-halo`,
  };
  const { scale, unitsPerCm, box } = layout(product);
  const vertical = box.h > box.w;
  const textured = finish.texture !== 'matte';
  const label = `Front elevation of ${product.name} in ${finish.name}, ${product.dimsCm.w} x ${product.dimsCm.h} cm, scale 1:${scale}`;

  return (
    <svg className="elev" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label} data-scale={scale}>
      <defs>
        <linearGradient id={ids.body} x1="0" y1="0" x2={vertical ? 1 : 0} y2={vertical ? 0 : 1}>
          <stop offset="0" className="elev__stop-hi" />
          <stop offset="0.35" className="elev__stop-base" />
          <stop offset="0.75" className="elev__stop-base" />
          <stop offset="1" className="elev__stop-shade" />
        </linearGradient>
        <linearGradient id={ids.glow} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="elev__stop-light" stopOpacity="0.5" />
          <stop offset="0.45" className="elev__stop-light" stopOpacity="0.14" />
          <stop offset="1" className="elev__stop-light" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.halo}>
          <stop offset="0" className="elev__stop-light" stopOpacity="0.32" />
          <stop offset="0.55" className="elev__stop-light" stopOpacity="0.1" />
          <stop offset="1" className="elev__stop-light" stopOpacity="0" />
        </radialGradient>
        <Texture id={ids.texture} texture={finish.texture} vertical={vertical} />
      </defs>

      {product.mount === 'floor' && <Ground y={box.y + box.h} side={1} />}
      {product.mount === 'ceiling' && <Ground y={box.y} side={-1} />}
      <ShapeBody product={product} box={box} unitsPerCm={unitsPerCm} ids={ids} textured={textured} />
      {technical && <TechnicalOverlay product={product} box={box} scale={scale} />}
    </svg>
  );
}
