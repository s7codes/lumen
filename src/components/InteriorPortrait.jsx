import { useEffect, useRef } from 'react';
import { INTERIOR_VIEW, interiorScene } from '../lib/interior-painter.js';

const VIEW_BOX = `0 0 ${INTERIOR_VIEW.width} ${INTERIOR_VIEW.height}`;

function Stops({ stops }) {
  return stops.map(([offset, color, opacity = 1], i) => <stop key={i} offset={offset} stopColor={color} stopOpacity={opacity} />);
}

function Def({ def, prefix }) {
  const id = `${prefix}-${def.id}`;
  if (def.type === 'clip') {
    return (
      <clipPath id={id}>
        <path d={def.d} />
      </clipPath>
    );
  }
  const units = def.units === 'user' ? 'userSpaceOnUse' : 'objectBoundingBox';
  if (def.type === 'radial') {
    const squash = def.squash === 1 ? undefined : `translate(${def.cx} ${def.cy}) scale(1 ${def.squash}) translate(${-def.cx} ${-def.cy})`;
    return (
      <radialGradient id={id} gradientUnits={units} cx={def.cx} cy={def.cy} r={def.r} gradientTransform={squash}>
        <Stops stops={def.stops} />
      </radialGradient>
    );
  }
  return (
    <linearGradient id={id} gradientUnits={units} x1={def.x1} y1={def.y1} x2={def.x2} y2={def.y2}>
      <Stops stops={def.stops} />
    </linearGradient>
  );
}

const paintOf = (paint, prefix) => (paint === 'none' || paint.startsWith('#') ? paint : `url(#${prefix}-${paint})`);

/**
 * One 3:4 interior as smooth architectural vectors: crisp geometry under
 * smooth gradients, no canvas, no grain and no filters, sharp at any pixel
 * density. The luminaire's position lands on the parent as --glow-x and
 * --glow-y, where the hover light breathes (CSS, on the compositor). The
 * picture is decorative: the link around it carries the words.
 */
export function InteriorPortrait({ scene }) {
  const ref = useRef(null);
  const art = interiorScene(scene);
  const prefix = `interior-${art.id}`;

  useEffect(() => {
    const host = ref.current?.parentElement;
    host?.style.setProperty('--glow-x', `${(art.glow.x * 100).toFixed(1)}%`);
    host?.style.setProperty('--glow-y', `${(art.glow.y * 100).toFixed(1)}%`);
  }, [art]);

  return (
    <svg
      ref={ref}
      className="entry-card__picture"
      viewBox={VIEW_BOX}
      preserveAspectRatio="xMidYMid slice"
      data-testid="interior-portrait"
      data-scene={art.id}
      data-painted={art.id}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {art.defs.map((def) => (
          <Def key={def.id} def={def} prefix={prefix} />
        ))}
      </defs>
      {art.shapes.map((shape, i) => (
        <path
          key={i}
          d={shape.d}
          fill={paintOf(shape.paint, prefix)}
          fillOpacity={shape.opacity}
          stroke={shape.stroke}
          strokeWidth={shape.width}
          strokeOpacity={shape.strokeOpacity}
          strokeLinecap={shape.stroke ? 'round' : undefined}
          clipPath={shape.clip ? `url(#${prefix}-${shape.clip})` : undefined}
        />
      ))}
    </svg>
  );
}
