import { createRoomState } from '../../../src/lib/room-3d.js';
import { filmCamera, filmDimPct, filmShelf } from '../../../src/lib/showcase-film.js';
import { STAGE_ROOM } from '../../../src/lib/showcase-scene.js';

/*
 * One capture frame as planner props: the stage room (the Gallery preset,
 * 640 x 520 x 300 cm, a modular sofa for scale, the 2700K night rig) with
 * the Lumen parts the overview names, posed at film time t.
 */

const ROOM = Object.freeze({ widthCm: STAGE_ROOM.widthCm, depthCm: STAGE_ROOM.depthCm, heightCm: STAGE_ROOM.heightCm, furniture: 'sofa-200', lighting: 'night' });

function items(act, t) {
  const shelf = filmShelf(act, t);
  const dimPct = filmDimPct(act, t);
  // The iso-lux film reads one pendant and the shelf, so the field has room for its rings.
  const accent = act !== 'isolux';
  return [
    { uid: 'shelf', productId: 'floating-shelf-110', finish: 'walnut', xCm: shelf.x, yCm: shelf.y, led: true },
    { uid: 'pendant', productId: 'linear-pendant-150', finish: 'obsidian', xCm: 245, yCm: 206, led: true, ...(dimPct < 100 ? { dimPct } : {}) },
    { uid: 'spot-1', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 70, yCm: 266, led: accent },
    { uid: 'spot-2', productId: 'directional-spot-monopoint', finish: 'obsidian', xCm: 470, yCm: 266, led: accent },
    { uid: 'column', productId: 'corner-floor-column-140', finish: 'walnut', xCm: 618, yCm: 0, led: accent },
    { uid: 'frame', productId: 'acoustic-art-frame-50x70', finish: 'oak', xCm: 236, yCm: 112, wall: 'west', led: accent },
    { uid: 'sconce', productId: 'wall-sconce-80', finish: 'chalk', xCm: 150, yCm: 110, wall: 'east', led: accent },
  ];
}

export function filmFrame(act, t) {
  const cam = filmCamera(act, t);
  const camera = cam.mode === 'orbit' ? { yaw: Math.round(cam.yaw * 100) / 100, pitch: cam.pitch, zoom: cam.zoom } : { yaw: 0, pitch: 24, zoom: 1 };
  const state = createRoomState(ROOM, items(act, t), camera);
  // createRoomState rounds the camera; the film wants the exact pose.
  state.camera = camera;
  const shelf = filmShelf(act, t);
  return {
    state,
    cameraMode: cam.mode,
    walk: cam.mode === 'inside' ? { xCm: cam.xCm, zCm: cam.zCm, headingDeg: cam.headingDeg, pitchDeg: cam.pitchDeg } : { xCm: 320, zCm: 405, headingDeg: 0, pitchDeg: 0 },
    insideFov: cam.mode === 'inside' ? cam.fovDeg : 78,
    floorLux: act === 'isolux',
    selectedUid: act === 'gizmo' ? 'shelf' : null,
    axisLock: shelf.axis === 'x' ? 'x' : shelf.axis === 'y' ? 'y' : 'free',
  };
}
