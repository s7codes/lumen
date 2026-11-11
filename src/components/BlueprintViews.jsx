import { lazy, Suspense, useId } from 'react';
import { anchorPoints } from '../lib/wall-studio.js';

export const BLUEPRINT_VIEWS = Object.freeze([
  { id: 'front', index: '01', label: 'Front Elevation', title: 'Front Elevation', testId: 'blueprint-view-front' },
  {
    id: 'side',
    index: '02',
    label: 'Side Section',
    title: 'Side Section (Z-Depth & 24V Bus Channel)',
    testId: 'blueprint-view-side',
  },
  {
    id: 'mounting',
    index: '03',
    label: 'Mounting Detail',
    title: 'Mounting & Anchor Detail',
    testId: 'blueprint-view-mounting',
  },
  {
    id: 'exploded',
    index: '04',
    label: 'Exploded Assembly',
    title: 'Exploded Assembly (Z-Axis Projection)',
    testId: 'blueprint-tab-exploded',
  },
]);

export const DEFAULT_SPREAD = 0.65;

// The exploded sheet and its fader ship as one chunk, fetched when the tab is first approached.
export const loadExplodedAssembly = () => import('./ExplodedAssembly.jsx');
const ExplodedView = lazy(() => loadExplodedAssembly().then((module) => ({ default: module.ExplodedView })));

const VIEW_W = 320;
const VIEW_H = 214;
const TITLE_Y = 192;
export const SCALES = [1, 2, 5, 10, 20, 25, 50];
export const CHANNEL_CM = { w: 1.2, h: 0.8 };
export const SHELL_CM = 1.8;

const FIXINGS = {
  wall: 'M6 x 60 nylon plug, 5 x 50 screw',
  floor: 'Anti-tip wall tie, M5 x 40',
  ceiling: 'Canopy plate, 2x M4 to junction box',
  recessed: 'Plaster-in clip, M4 x 30',
};

export const r2 = (value) => Math.round(value * 100) / 100;
export const fmtCm = (value) => String(Number(value.toFixed(1)));

// Paper millimetres: a part drawn at 1:N spans (cm * 10) / N units. The scale
// is the largest standard one at which the view fits its envelope.
function fit(wCm, hCm, env) {
  const scale = SCALES.find((n) => (wCm * 10) / n <= env.w && (hCm * 10) / n <= env.h) ?? SCALES.at(-1);
  return { scale, u: 10 / scale };
}

function place(product, wCm, hCm, env) {
  const { scale, u } = fit(wCm, hCm, env);
  const w = wCm * u;
  const h = Math.max(hCm * u, 1.6);
  const x = env.x + (env.w - w) / 2;
  let y = env.y + (env.h - h) / 2;
  if (product.mount === 'floor') y = env.y + env.h - h;
  if (product.mount === 'ceiling') y = env.y;
  if (product.shape === 'pendant') y = env.y + Math.min(env.h * 0.35, env.h - h);
  return { scale, u, box: { x, y, w, h } };
}

/** Suspension cables from the ceiling datum down to a pendant body. */
function Cables({ box, ceilingY }) {
  if (box.y - ceilingY < 1) return null;
  return [box.x + box.w / 3, box.x + (2 * box.w) / 3].map((x) => (
    <Line key={r2(x)} x1={x} y1={ceilingY} x2={x} y2={box.y} className="bp__thin" />
  ));
}

export function Rect({ box, className, ...rest }) {
  return <rect x={r2(box.x)} y={r2(box.y)} width={r2(box.w)} height={r2(box.h)} className={className} {...rest} />;
}

export function Line({ x1, y1, x2, y2, className }) {
  return <line x1={r2(x1)} y1={r2(y1)} x2={r2(x2)} y2={r2(y2)} className={className} />;
}

/** Architectural dimension: extension lines, slash ticks and a centred value. */
function Dim({ from, to, offset, label, vertical = false, testId }) {
  const [a, b] = vertical ? [from[1], to[1]] : [from[0], to[0]];
  const base = vertical ? from[0] + offset : from[1] + offset;
  const mid = (a + b) / 2;
  const tick = (p) =>
    vertical ? (
      <Line x1={base - 1.6} y1={p + 1.6} x2={base + 1.6} y2={p - 1.6} className="bp__tick" />
    ) : (
      <Line x1={p - 1.6} y1={base + 1.6} x2={p + 1.6} y2={base - 1.6} className="bp__tick" />
    );
  return (
    <g className="bp__dim" data-testid={testId}>
      {vertical ? (
        <>
          <Line x1={from[0]} y1={a} x2={base + 2} y2={a} className="bp__ext" />
          <Line x1={to[0]} y1={b} x2={base + 2} y2={b} className="bp__ext" />
          <Line x1={base} y1={a} x2={base} y2={b} />
          <text
            x={r2(offset < 0 ? base - 3.5 : base + 3.5)}
            y={r2(mid + 2.2)}
            textAnchor={offset < 0 ? 'end' : 'start'}
            className="bp__dim-text"
          >
            {label}
          </text>
        </>
      ) : (
        <>
          <Line x1={a} y1={from[1]} x2={a} y2={base + (offset > 0 ? 2 : -2)} className="bp__ext" />
          <Line x1={b} y1={to[1]} x2={b} y2={base + (offset > 0 ? 2 : -2)} className="bp__ext" />
          <Line x1={a} y1={base} x2={b} y2={base} />
          <text x={r2(mid)} y={r2(base + (offset > 0 ? 7.5 : -2.5))} textAnchor="middle" className="bp__dim-text">
            {label}
          </text>
        </>
      )}
      {tick(a)}
      {tick(b)}
    </g>
  );
}

function Datum({ x1, x2, y, side, label }) {
  const marks = [];
  for (let x = x1 + 3; x <= x2; x += 4) marks.push(x);
  return (
    <g className="bp__datum">
      <Line x1={x1} y1={y} x2={x2} y2={y} />
      {marks.map((x) => (
        <Line key={x} x1={x} y1={y} x2={x - 2.4} y2={y + 2.4 * side} className="bp__hatch-line" />
      ))}
      {label && (
        <text x={r2(x2)} y={r2(y - 2)} textAnchor="end" className="bp__note">
          {label}
        </text>
      )}
    </g>
  );
}

function WallDatum({ x, y1, y2, label }) {
  const marks = [];
  for (let y = y1 + 3; y <= y2; y += 4) marks.push(y);
  return (
    <g className="bp__datum">
      <Line x1={x} y1={y1} x2={x} y2={y2} />
      {marks.map((y) => (
        <Line key={y} x1={x} y1={y} x2={x - 2.4} y2={y - 2.4} className="bp__hatch-line" />
      ))}
      {label && (
        <text x={r2(x - 3)} y={r2(y1 - 2)} textAnchor="middle" className="bp__note">
          {label}
        </text>
      )}
    </g>
  );
}

export function TitleBlock({ product, view, scale }) {
  const cells = [view.title.toUpperCase(), `1:${scale}`, product.sku];
  return (
    <g className="bp__title">
      <Line x1={8} y1={TITLE_Y - 8} x2={VIEW_W - 8} y2={TITLE_Y - 8} />
      <text x={12} y={TITLE_Y + 4} className="bp__title-main">
        {cells[0]}
      </text>
      <text x={VIEW_W - 12} y={TITLE_Y + 4} textAnchor="end" className="bp__title-meta" data-testid="blueprint-scale">
        {cells[1]} / {cells[2]}
      </text>
      <text x={12} y={TITLE_Y + 14} className="bp__note">
        All dimensions in cm. Drawn at scale on A-series paper units.
      </text>
    </g>
  );
}

function frontDetail(product, box, u) {
  const { x, y, w, h } = box;
  const lit = product.watts > 0;
  switch (product.shape) {
    case 'cube': {
      const t = SHELL_CM * u;
      return (
        <>
          <Rect box={{ x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t }} className="bp__inner" />
          {lit && <Line x1={x + t + 1} y1={y + t + 1} x2={x + w - t - 1} y2={y + t + 1} className="bp__led" />}
        </>
      );
    }
    case 'sideboard':
      return (
        <>
          <Line x1={x + w / 2} y1={y + 1} x2={x + w / 2} y2={y + h - 1} className="bp__thin" />
          <Line x1={x + w / 2 - 3} y1={y + h / 2 - 2} x2={x + w / 2 - 3} y2={y + h / 2 + 2} className="bp__thin" />
          <Line x1={x + w / 2 + 3} y1={y + h / 2 - 2} x2={x + w / 2 + 3} y2={y + h / 2 + 2} className="bp__thin" />
          {lit && <Line x1={x + 2} y1={y + h} x2={x + w - 2} y2={y + h} className="bp__led" />}
        </>
      );
    case 'lightbar':
      return <Line x1={x + 1.5} y1={y + h / 2} x2={x + w - 1.5} y2={y + h / 2} className="bp__led" />;
    case 'column': {
      const slot = 2 * u;
      return (
        <Rect box={{ x: x + w / 2 - slot / 2, y: y + 6 * u, w: slot, h: h - 12 * u }} className="bp__led-fill" />
      );
    }
    case 'spot': {
      const canopy = 2 * u;
      const head = { x: x + w * 0.22, y: y + h * 0.36, w: w * 0.56, h: h * 0.64 };
      return (
        <>
          <Line x1={x} y1={y + canopy} x2={x + w} y2={y + canopy} className="bp__thin" />
          <Line x1={x + w / 2} y1={y + canopy} x2={x + w / 2} y2={head.y} className="bp__thin" />
          <Rect box={head} className="bp__inner" />
          {lit && <Line x1={head.x + 2} y1={head.y + head.h} x2={head.x + head.w - 2} y2={head.y + head.h} className="bp__led" />}
        </>
      );
    }
    case 'frame': {
      const t = 5 * u;
      const halo = 1.5 * u + 1;
      return (
        <>
          <Rect box={{ x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t }} className="bp__inner bp__inner--felt" />
          {lit && <Rect box={{ x: x - halo, y: y - halo, w: w + 2 * halo, h: h + 2 * halo }} className="bp__halo" />}
        </>
      );
    }
    case 'track':
      return <Line x1={x + 1} y1={y + h / 2} x2={x + w - 1} y2={y + h / 2} className="bp__bus" />;
    case 'pendant':
      return lit ? <Line x1={x + 1.5} y1={y + h * 0.85} x2={x + w - 1.5} y2={y + h * 0.85} className="bp__led" /> : null;
    case 'sconce':
      return lit ? (
        <Rect box={{ x: x + w * 0.3, y: y + 1.5 * u, w: w * 0.4, h: h - 3 * u }} className="bp__led-fill" />
      ) : null;
    case 'baffle': {
      const t = 1.2 * u;
      return <Rect box={{ x: x + t, y: y + t, w: w - 2 * t, h: h - 2 * t }} className="bp__inner bp__inner--felt" />;
    }
    case 'hub':
      return (
        <>
          <Line x1={x + 1} y1={y + h / 2} x2={x + w - 1} y2={y + h / 2} className="bp__bus" />
          <Rect box={{ x: x + w * 0.4, y: y + h * 0.2, w: w * 0.2, h: h * 0.6 }} className="bp__inner" />
        </>
      );
    default:
      return lit ? <Line x1={x + 2} y1={y + h} x2={x + w - 2} y2={y + h} className="bp__led" /> : null;
  }
}

function FrontView({ product, ids }) {
  const env = { x: 52, y: 30, w: 196, h: 128 };
  const { w: wCm, h: hCm } = product.dimsCm;
  const { scale, u, box } = place(product, wCm, hCm, env);

  return (
    <>
      {product.mount === 'floor' && <Datum x1={30} x2={270} y={box.y + box.h} side={1} label="FFL +0" />}
      {product.mount === 'ceiling' && <Datum x1={30} x2={270} y={env.y} side={-1} label="Ceiling" />}
      {product.shape === 'pendant' && <Cables box={box} ceilingY={env.y} />}
      <Rect box={box} className="bp__body" fill={`url(#${ids.fill})`} />
      {frontDetail(product, box, u)}
      <Dim from={[box.x, box.y + box.h]} to={[box.x + box.w, box.y + box.h]} offset={12} label={`W ${fmtCm(wCm)}`} testId="dim-width" />
      <Dim from={[box.x + box.w, box.y]} to={[box.x + box.w, box.y + box.h]} offset={10} label={`H ${fmtCm(hCm)}`} vertical testId="dim-height" />
      <TitleBlock product={product} view={BLUEPRINT_VIEWS[0]} scale={scale} />
    </>
  );
}

function channelSpot(product, box, u) {
  const cw = CHANNEL_CM.w * u;
  const ch = CHANNEL_CM.h * u;
  if (product.mount === 'floor') return { x: box.x + 0.6 * u, y: box.y + box.h - ch - 0.6 * u, w: cw, h: ch };
  if (product.mount === 'ceiling') return { x: box.x + box.w / 2 - cw / 2, y: box.y + 0.4 * u, w: cw, h: ch };
  const yCm = product.dimsCm.h > 16 ? 5 : product.dimsCm.h / 2;
  return { x: box.x + 0.4 * u, y: box.y + yCm * u - ch / 2, w: cw, h: ch };
}

function SideView({ product, ids }) {
  const env = { x: 40, y: 32, w: 140, h: 124 };
  const { d: dCm, h: hCm } = product.dimsCm;
  const { scale, u, box } = place(product, dCm, hCm, env);
  const recessed = product.mount === 'recessed';
  const wallX = recessed ? box.x + box.w : box.x;
  const hollow = product.shape === 'cube' || product.shape === 'sideboard';
  const t = SHELL_CM * u;
  const channel = recessed
    ? { x: box.x + box.w * 0.25, y: box.y + box.h * 0.3, w: box.w * 0.5, h: box.h * 0.4 }
    : channelSpot(product, box, u);
  const labelY = Math.max(env.y, channel.y + channel.h / 2 - 16);
  const channelNote = recessed ? '2x 2.5 mm2 Cu' : `${CHANNEL_CM.w * 10} x ${CHANNEL_CM.h * 10} mm, rear feed`;
  const labelX = 228;

  return (
    <>
      {product.mount === 'floor' && <Datum x1={26} x2={200} y={box.y + box.h} side={1} label="FFL +0" />}
      {product.mount === 'ceiling' && <Datum x1={26} x2={200} y={env.y} side={-1} label="Ceiling" />}
      {product.shape === 'pendant' && <Line x1={box.x + box.w / 2} y1={env.y} x2={box.x + box.w / 2} y2={box.y} className="bp__thin" />}
      {product.mount !== 'ceiling' && (
        <WallDatum x={wallX} y1={env.y - 6} y2={env.y + env.h + 4} label={recessed ? 'Plaster face' : 'Wall'} />
      )}
      {recessed && (
        <Rect box={{ x: box.x - 6, y: env.y - 6, w: box.w + 6, h: env.h + 10 }} className="bp__plaster" fill={`url(#${ids.hatch})`} />
      )}
      <Rect box={box} className="bp__body bp__body--cut" fill={recessed ? `url(#${ids.fill})` : `url(#${ids.hatch})`} />
      {hollow && box.w > 2 * t && box.h > 2 * t && (
        <Rect box={{ x: box.x + t, y: box.y + t, w: box.w - 2 * t, h: box.h - 2 * t }} className="bp__void" />
      )}
      <Rect box={channel} className="bp__channel" data-testid="bus-channel" />
      <polyline
        className="bp__leader"
        points={`${r2(channel.x + channel.w)},${r2(channel.y + channel.h / 2)} ${r2(labelX - 6)},${r2(labelY)} ${r2(labelX - 2)},${r2(labelY)}`}
      />
      <text x={labelX} y={r2(labelY + 2)} className="bp__label">
        24V DC bus channel
      </text>
      <text x={labelX} y={r2(labelY + 10)} className="bp__note">
        {channelNote}
      </text>
      <Dim from={[box.x, box.y + box.h]} to={[box.x + box.w, box.y + box.h]} offset={12} label={`Z ${fmtCm(dCm)}`} testId="dim-depth" />
      <Dim from={[box.x + box.w, box.y]} to={[box.x + box.w, box.y + box.h]} offset={recessed ? 18 : 10} label={`H ${fmtCm(hCm)}`} vertical />
      <TitleBlock product={product} view={BLUEPRINT_VIEWS[1]} scale={scale} />
    </>
  );
}

/** Anchors in the product's own frame: x from the left edge, y up from the bottom edge. */
export function anchorSchedule(product) {
  const points = anchorPoints({ productId: product.id, xCm: 0, yCm: 0 });
  const xs = points.map((p) => p.xCm);
  const gaps = xs.slice(1).map((x, i) => Number((x - xs[i]).toFixed(1)));
  return {
    points,
    count: points.length,
    spacingCm: gaps.length > 0 ? gaps[0] : null,
    edgeCm: xs.length > 0 ? xs[0] : null,
    lineCm: points[0]?.yCm ?? 0,
    fixing: FIXINGS[product.mount] ?? FIXINGS.wall,
  };
}

function MountingView({ product }) {
  const env = { x: 52, y: 44, w: 196, h: 112 };
  const { w: wCm, h: hCm } = product.dimsCm;
  const { scale, u, box } = place(product, wCm, hCm, env);
  const schedule = anchorSchedule(product);
  const bottom = box.y + box.h;
  const anchors = schedule.points.map((p) => ({ x: box.x + p.xCm * u, y: bottom - p.yCm * u, p }));
  const chain = [box.x, ...anchors.map((a) => a.x), box.x + box.w];
  const chainCm = [0, ...schedule.points.map((p) => p.xCm), wCm];
  const chainY = box.y - 10;
  const anchorY = anchors[0]?.y ?? bottom;

  return (
    <>
      <Rect box={box} className="bp__body bp__body--rear" />
      <text x={r2(box.x + 2)} y={r2(box.y + box.h - 2)} className="bp__note">
        {box.h > 10 ? 'Rear face' : ''}
      </text>
      <Line x1={box.x - 6} y1={anchorY} x2={box.x + box.w + 6} y2={anchorY} className="bp__center" />
      {anchors.map(({ x, y, p }) => (
        <g key={`${p.xCm}-${p.yCm}`} className="bp__anchor" data-testid="anchor-point">
          <circle cx={r2(x)} cy={r2(y)} r={2.2} />
          <Line x1={x - 3.6} y1={y} x2={x + 3.6} y2={y} />
          <Line x1={x} y1={y - 3.6} x2={x} y2={y + 3.6} />
        </g>
      ))}
      <g data-testid="anchor-chain">
        {chain.slice(1).map((x, i) => {
          const span = chainCm[i + 1] - chainCm[i];
          if (span <= 0) return null;
          const narrow = x - chain[i] < 14;
          return (
            <Dim
              key={chain[i]}
              from={[chain[i], box.y]}
              to={[x, box.y]}
              offset={narrow && i % 2 === 1 ? -18 : -10}
              label={fmtCm(span)}
            />
          );
        })}
      </g>
      <Dim from={[box.x, bottom]} to={[box.x, anchorY]} offset={-10} label={`+${fmtCm(schedule.lineCm)}`} vertical />
      <text x={r2(box.x + box.w / 2)} y={r2(Math.min(bottom + 14, TITLE_Y - 12))} textAnchor="middle" className="bp__label">
        {schedule.count}x {schedule.fixing}
      </text>
      <text x={r2(VIEW_W / 2)} y={r2(chainY - 12 < 14 ? 14 : chainY - 12)} textAnchor="middle" className="bp__note">
        Anchor centres from left edge, viewed from the wall
      </text>
      <TitleBlock product={product} view={BLUEPRINT_VIEWS[2]} scale={scale} />
    </>
  );
}

export function BlueprintDrawing({ product, view, finish, svgRef }) {
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const ids = { fill: `${uid}-fill`, hatch: `${uid}-hatch`, title: `${uid}-title` };
  const meta = BLUEPRINT_VIEWS.find((entry) => entry.id === view) ?? BLUEPRINT_VIEWS[0];
  const { w, h, d } = product.dimsCm;

  return (
    <svg
      ref={svgRef}
      className="bp"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-labelledby={ids.title}
      data-testid="blueprint-svg"
      data-view={meta.id}
      style={{ '--finish-base': finish.hex }}
    >
      <title id={ids.title}>
        {`${product.name}, ${meta.title}. W ${w} x H ${h} x D ${d} cm.`}
      </title>
      <defs>
        <pattern id={ids.hatch} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" className="bp__hatch-line" />
        </pattern>
        <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={finish.highlight} stopOpacity="0.32" />
          <stop offset="1" stopColor={finish.shade} stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width={VIEW_W - 8} height={VIEW_H - 8} className="bp__sheet" />
      {meta.id === 'front' && <FrontView product={product} ids={ids} />}
      {meta.id === 'side' && <SideView product={product} ids={ids} />}
      {meta.id === 'mounting' && <MountingView product={product} />}
      {meta.id === 'exploded' && (
        <Suspense fallback={null}>
          <ExplodedView product={product} finish={finish} ids={ids} />
        </Suspense>
      )}
    </svg>
  );
}
