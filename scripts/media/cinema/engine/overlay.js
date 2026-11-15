/*
 * 2D annotation kit for the CAD films: hairlines, dashed lasers, crosshairs
 * and tracked mono labels, drawn over the WebGL frame through the film
 * camera's own projection, so every mark sits on the point it names.
 */

export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
export const SANS = '"Inter Tight Variable", "Inter Tight", system-ui, sans-serif';

export const INK = Object.freeze({
  champagne: '229, 199, 153',
  amber: '232, 146, 58',
  orange: '255, 122, 46',
  gold: '255, 210, 122',
  paper: '245, 242, 235',
  graphite: '20, 18, 16',
});

export function rgba(rgb, a = 1) {
  return `rgba(${rgb}, ${a})`;
}

/** A crisp 1 px hairline: endpoints snapped to pixel centres. */
export function hairline(ctx, a, b, color, width = 1) {
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
}

/** A dashed laser line between two screen points. */
export function laser(ctx, a, b, color, { dash = [6, 5], width = 1.25, offset = 0 } = {}) {
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineDashOffset = offset;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.restore();
}

/** A small end tick across a dimension line. */
export function endTick(ctx, p, dir, color, size = 5) {
  if (!p) return;
  const nx = -dir[1];
  const ny = dir[0];
  hairline(ctx, [p[0] - nx * size, p[1] - ny * size], [p[0] + nx * size, p[1] + ny * size], color, 1.25);
}

/** A '+' crosshair. */
export function cross(ctx, p, color, arm = 6, width = 1) {
  if (!p) return;
  hairline(ctx, [p[0] - arm, p[1]], [p[0] + arm, p[1]], color, width);
  hairline(ctx, [p[0], p[1] - arm], [p[0], p[1] + arm], color, width);
}

/** Letter-spaced text, measured so plates can fit it. */
export function trackedWidth(ctx, text, tracking) {
  let w = 0;
  for (const c of text) w += ctx.measureText(c).width + tracking;
  return w - tracking;
}

export function trackedText(ctx, text, x, y, tracking) {
  let cx = x;
  for (const c of text) {
    ctx.fillText(c, cx, y);
    cx += ctx.measureText(c).width + tracking;
  }
}

/**
 * A label: tracked uppercase mono on an optional flat graphite plate with a
 * hairline edge. `align` is 'left' | 'center' | 'right' about (x, y).
 */
export function tag(ctx, p, text, { size = 12, weight = 500, color = rgba(INK.champagne, 0.95), plate = rgba(INK.graphite, 0.72), edge = rgba(INK.champagne, 0.35), align = 'left', pad = [7, 4], tracking = 1.1, dy = 0 } = {}) {
  if (!p) return null;
  ctx.save();
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.textBaseline = 'middle';
  const w = trackedWidth(ctx, text, tracking);
  const h = size + pad[1] * 2;
  // A left-aligned label that would run off the right edge swings to the other side of its point.
  if (align === 'left' && p[0] + w + pad[0] * 2 > ctx.canvas.width - 12) align = 'right';
  let x = p[0];
  if (align === 'center') x -= w / 2 + pad[0];
  else if (align === 'right') x -= w + pad[0] * 2;
  const y = p[1] + dy - h / 2;
  const box = [Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w + pad[0] * 2), Math.round(h)];
  if (plate) {
    ctx.fillStyle = plate;
    ctx.fillRect(box[0], box[1], box[2], box[3]);
  }
  if (edge) {
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(box[0], box[1], box[2], box[3]);
  }
  ctx.fillStyle = color;
  trackedText(ctx, text, box[0] + pad[0], box[1] + h / 2 + 0.5, tracking);
  ctx.restore();
  return box;
}

/** Fraction of a screen point inside the frame, with a margin. */
export function onScreen(p, view, margin = 0) {
  return Boolean(p) && p[0] >= margin && p[0] <= view.width - margin && p[1] >= margin && p[1] <= view.height - margin;
}

/** The unit screen direction from a to b. */
export function direction(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

export function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
