import { memo, useId, useMemo } from 'react';
import { buildProductScene, SCENE_VIEW } from '../lib/product-scene.js';

const VIEW_BOX = `0 0 ${SCENE_VIEW.width} ${SCENE_VIEW.height}`;

function resolve(fill, prefix) {
  return typeof fill === 'string' && fill.startsWith('@') ? `url(#${prefix}-${fill.slice(1)})` : fill;
}

function points(list) {
  return list.map(([x, y]) => `${x},${y}`).join(' ');
}

function Gradient({ spec, prefix }) {
  const id = `${prefix}-${spec.id}`;
  const units = spec.units === 'user' ? 'userSpaceOnUse' : undefined;
  const stops = spec.stops.map(([offset, color, opacity = 1]) => (
    <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
  ));
  if (spec.type === 'radial') {
    return (
      <radialGradient id={id} gradientUnits={units} cx={spec.cx} cy={spec.cy} r={spec.r}>
        {stops}
      </radialGradient>
    );
  }
  return (
    <linearGradient id={id} gradientUnits={units} x1={spec.x1} y1={spec.y1} x2={spec.x2} y2={spec.y2}>
      {stops}
    </linearGradient>
  );
}

function Shape({ shape, prefix }) {
  const fill = resolve(shape.fill, prefix);
  const common = { opacity: shape.opacity };
  switch (shape.type) {
    case 'poly':
      return <polygon points={points(shape.points)} fill={fill} {...common} />;
    case 'path':
      return <path d={shape.d} fill={fill} {...common} />;
    case 'ellipse':
      return <ellipse cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} fill={fill} {...common} />;
    case 'line':
      return (
        <line
          x1={shape.from[0]}
          y1={shape.from[1]}
          x2={shape.to[0]}
          y2={shape.to[1]}
          stroke={resolve(shape.stroke, prefix)}
          strokeWidth={shape.width}
          strokeLinecap={shape.cap}
          {...common}
        />
      );
    case 'polyline':
      return <polyline points={points(shape.points)} fill="none" stroke={resolve(shape.stroke, prefix)} strokeWidth={shape.width} {...common} />;
    default:
      return null;
  }
}

/**
 * A lifelike interior for one catalog part: the module in true perspective
 * in the corner of a daylight gallery room (smooth stone walls, an oak floor,
 * a skirting shadow line and a diagonal band of window light), lit by its
 * own 2700K light where it has one. Geometry comes from
 * src/lib/product-scene.js; this component only maps it to SVG.
 */
export const ProductVisual = memo(function ProductVisual({ product, finish, className = 'pv' }) {
  const prefix = `pv${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const scene = useMemo(() => buildProductScene(product, finish), [product, finish]);
  const { w, h } = product.dimsCm;
  const label = `${product.name} in ${finish.name}, ${w} x ${h} cm, shown in a daylight gallery interior${scene.lit ? ' with its 2700K light on' : ''}`;

  return (
    <svg
      className={className}
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={label}
      data-testid="product-visual"
      data-shape={product.shape}
      data-lit={scene.lit ? 'true' : 'false'}
    >
      <defs>
        {scene.gradients.map((spec) => (
          <Gradient key={spec.id} spec={spec} prefix={prefix} />
        ))}
      </defs>
      {scene.shapes.map((shape, i) => (
        <Shape key={i} shape={shape} prefix={prefix} />
      ))}
    </svg>
  );
});
