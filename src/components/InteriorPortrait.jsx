import { useEffect, useRef } from 'react';
import { createInteriorAssets, paintInterior } from '../lib/interior-painter.js';

const MAX_DENSITY = 2;
let sharedAssets = null;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

// The three portraits share one set of textures, built on first paint.
function interiorAssets() {
  sharedAssets ??= createInteriorAssets(makeCanvas);
  return sharedAssets;
}

/**
 * One 3:4 interior, painted once into a canvas and again only when its size
 * changes. The luminaire's position lands on the parent as --glow-x and
 * --glow-y, where the hover light breathes (CSS, on the compositor). The
 * picture is decorative: the link around it carries the words.
 */
export function InteriorPortrait({ scene }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return undefined;
    const host = canvas.parentElement;
    let painted = '';
    const paint = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const density = Math.min(window.devicePixelRatio || 1, MAX_DENSITY);
      const key = `${width}x${height}@${density}`;
      if (key === painted) return;
      painted = key;
      canvas.width = Math.round(width * density);
      canvas.height = Math.round(height * density);
      ctx.setTransform(density, 0, 0, density, 0, 0);
      const glow = paintInterior(ctx, { scene, width, height, assets: interiorAssets() });
      host?.style.setProperty('--glow-x', `${(glow.x * 100).toFixed(1)}%`);
      host?.style.setProperty('--glow-y', `${(glow.y * 100).toFixed(1)}%`);
      canvas.dataset.painted = scene;
    };
    const sizing = new ResizeObserver(paint);
    sizing.observe(canvas);
    paint();
    return () => sizing.disconnect();
  }, [scene]);

  return <canvas ref={canvasRef} className="entry-card__canvas" data-testid="interior-portrait" data-scene={scene} aria-hidden="true" />;
}
