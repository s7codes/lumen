import { getFinish, getProduct } from '../data/products.js';
import { SLOPE_CM } from '../lib/wall-studio.js';
import '../styles/elevation-thumb.css';

/**
 * To-scale elevation drawn from stored module positions, floor at the
 * bottom. `marks` (uid -> 'added' | 'removed' | 'modified') outlines the
 * modules a comparison touches; `joints` draws room corners on an unrolled strip.
 */
export function ElevationThumb({ widthCm, heightCm, items, slope = false, joints = [], marks = null, label, className = '' }) {
  const outline = slope
    ? `0,0 ${widthCm - SLOPE_CM},0 ${widthCm},${SLOPE_CM} ${widthCm},${heightCm} 0,${heightCm}`
    : null;
  return (
    <svg
      className={`elevation-thumb ${className}`.trim()}
      viewBox={`0 0 ${widthCm} ${heightCm}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      {outline ? (
        <polygon className="elevation-thumb__wall" points={outline} />
      ) : (
        <rect className="elevation-thumb__wall" x="0" y="0" width={widthCm} height={heightCm} />
      )}
      {joints.map((x) => (
        <line key={x} className="elevation-thumb__joint" x1={x} y1="0" x2={x} y2={heightCm} />
      ))}
      {items.map((item) => {
        const { w, h } = getProduct(item.productId).dimsCm;
        return (
          <rect
            key={item.uid}
            className="elevation-thumb__module"
            data-uid={item.uid}
            data-diff={marks?.get(item.uid)}
            x={item.xCm}
            y={heightCm - item.yCm - h}
            width={w}
            height={h}
            fill={getFinish(item.finish).hex}
          />
        );
      })}
    </svg>
  );
}
