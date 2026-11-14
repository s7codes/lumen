import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import RoomCanvas from '../../../src/components/room3d/RoomCanvas.jsx';
import { TransformGizmo } from '../../../src/components/room3d/TransformGizmo.jsx';
import { useWallDrag } from '../../../src/hooks/useWallDrag.js';
import { computeFloorLuxField } from '../../../src/lib/illuminance-field.js';
import { createRoomState } from '../../../src/lib/room-3d.js';
import { buildScene } from '../../../src/lib/room-scene.js';
import { filmFrame } from './film-frame.js';
import '@fontsource-variable/inter-tight';
import '@fontsource/ibm-plex-mono/400.css';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';
import '../../../src/styles/room3d.css';

/*
 * Showcase capture stage: the planner's own RoomCanvas, drag controller and
 * transform gizmo, driven frame by frame from src/lib/showcase-film.js. The
 * driver runs Chromium with reduced motion, so every rig snaps to the pose
 * it is handed and each frame is exactly the choreography at time t.
 */

const noop = () => {};

function Stage() {
  const [frame, setFrame] = useState(() => filmFrame('orbit', 0));
  const captureRef = useRef(null);
  const manifestRef = useRef(null);
  const viewRef = useRef(frame.state.camera);
  const drag = useWallDrag({ state: frame.state, selectedUid: frame.selectedUid, snapCm: 5, axisLock: frame.axisLock ?? 'free', onCommit: noop });
  const api = useMemo(
    () => ({
      viewRef,
      gliding: { current: false },
      pointerDown: { current: false },
      showView: (next) => {
        viewRef.current = next;
      },
      setOrbiting: noop,
      commit: noop,
      drag,
      hud: { compass: null, readout: null },
      walkMirror: { current: null },
      heldKeys: new Set(),
      locomotion: { run: false, rig: false, engaged: false, wake: null },
      commitWalk: noop,
      commitFov: noop,
    }),
    [drag],
  );
  const stageRef = useCallback(
    (el) => {
      drag.refs.stage = el;
    },
    [drag],
  );
  useEffect(() => {
    drag.refs.manifest = manifestRef.current;
  }, [drag]);

  const scene = useMemo(() => buildScene({ state: frame.state, selectedUid: frame.selectedUid }), [frame.state, frame.selectedUid]);
  const floorLux = useMemo(() => (frame.floorLux ? computeFloorLuxField(frame.state) : null), [frame.floorLux, frame.state]);
  const [ready, setReady] = useState(false);
  const selected = frame.selectedUid ? frame.state.items.find((item) => item.uid === frame.selectedUid) : null;

  useEffect(() => {
    window.capture = {
      async set(act, t) {
        flushSync(() => setFrame(filmFrame(act, t)));
        // Two frames: the rigs snap in a layout effect, the demand loop draws on the next tick.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        captureRef.current?.();
        return true;
      },
      ready: () => ready,
    };
  }, [ready]);

  return (
    <div id="stage" ref={stageRef}>
      <RoomCanvas
        scene={scene}
        floorLux={floorLux}
        room={frame.state.room}
        wall="north"
        camera={frame.state.camera}
        cameraMode={frame.cameraMode}
        walk={frame.walk}
        insideFov={frame.insideFov}
        api={api}
        drag={drag}
        manifestRef={manifestRef}
        captureRef={captureRef}
        antialias
        onSelect={noop}
        onHover={noop}
        onReady={() => setReady(true)}
      />
      <div ref={manifestRef} hidden data-testid="room-scene-manifest" />
      {selected && <TransformGizmo key={selected.uid} drag={drag} item={selected} room={frame.state.room} axisLock={frame.axisLock ?? 'free'} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Stage />);
