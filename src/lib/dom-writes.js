/*
 * Guarded DOM writes for per-frame overlays (gizmo, compass, laser lines,
 * scene-graph mirror). Each write is skipped when the value already matches,
 * so a 120 Hz loop never dirties layout for nothing.
 */

export function setData(el, key, value) {
  if (!el) return;
  const text = String(value);
  if (el.dataset[key] !== text) el.dataset[key] = text;
}

export function setAttr(el, name, value) {
  if (!el) return;
  const text = String(value);
  if (el.getAttribute(name) !== text) el.setAttribute(name, text);
}

// Writes into React's own text node, so a later render still updates the same node.
export function setText(el, text) {
  if (!el || el.textContent === text) return;
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE && node === el.lastChild) node.nodeValue = text;
  else el.textContent = text;
}
