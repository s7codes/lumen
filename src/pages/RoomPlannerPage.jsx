import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader.jsx';
import { RoomControls } from '../components/room3d/RoomControls.jsx';
import { RoomInspector } from '../components/room3d/RoomInspector.jsx';
import { RoomSummary } from '../components/room3d/RoomSummary.jsx';
import { RoomToolbar } from '../components/room3d/RoomToolbar.jsx';
import { RoomViewport } from '../components/room3d/RoomViewport.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useRoom3d } from '../hooks/useRoom3d.js';
import { exportToWallStudio, findRoomConflicts, getFurniture } from '../lib/room-3d.js';
import { aggregateBagLines, summarizeWall } from '../lib/wall-studio.js';
import '../styles/pages.css';
import '../styles/studio.css';
import '../styles/room3d.css';

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

export default function RoomPlannerPage() {
  useDocumentTitle('Room Planner');
  const [mode] = useDisplayMode();
  const { state, selected, notice, actions } = useRoom3d();
  const { addMany } = useBag();
  const { openBag } = useBagDrawer();
  const [status, setStatus] = useState('');
  const syncRef = useRef(null);

  const conflicts = useMemo(() => findRoomConflicts(state), [state]);
  const summary = useMemo(() => summarizeWall(state), [state]);
  const { room } = state;

  const pushToWall = () => {
    const { layout, moved, capped } = exportToWallStudio(state);
    const { widthCm, heightCm } = layout.wall;
    let text = `Pushed ${plural(layout.items.length, 'module')} to Wall Studio, wall ${widthCm} x ${heightCm} cm.`;
    if (capped) text += ` Wall capped at ${widthCm} cm; ${plural(moved, 'module')} pulled inside.`;
    setStatus(text);
    actions.announce(text, capped && moved > 0 ? 'warn' : 'info');
  };

  const syncToBag = () => {
    const lines = aggregateBagLines(state.items);
    if (lines.length === 0) return;
    addMany(lines, 'Room 3D');
    setStatus(`Synced ${plural(state.items.length, 'module')} as ${plural(lines.length, 'bag line')}.`);
    openBag(syncRef.current);
  };

  return (
    <>
      <PageHeader
        index="03"
        section="3D Room"
        title="Room Planner"
        lede="A dimensioned room with the main wall at Z 0. Mount parts in three dimensions, check clearances against a floor reference, and move the wall between the 2D studio, the room and the bag."
        meta={[
          ['Engine', 'Perspective SVG / no WebGL'],
          ['Units', 'cm'],
          ['Room', `${room.widthCm} x ${room.depthCm} x ${room.heightCm} cm`],
          ['Reference', getFurniture(room.furniture).label],
        ]}
      />

      <div className="room3d-layout container" data-mode={mode}>
        <div className="room3d-layout__main">
          <RoomViewport
            state={state}
            conflicts={conflicts}
            selectedUid={selected?.uid ?? null}
            technical={mode === 'technical'}
            toolbar={<RoomToolbar camera={state.camera} notice={notice} onCamera={actions.setCamera} />}
            onSelect={actions.select}
            onCameraCommit={actions.setCamera}
          />
          <RoomSummary
            summary={summary}
            conflictCount={conflicts.size}
            status={status}
            syncRef={syncRef}
            onImport={() => {
              actions.importWall();
              setStatus('');
            }}
            onExport={pushToWall}
            onSync={syncToBag}
          />
        </div>

        <div className="room3d-layout__controls">
          <RoomControls state={state} actions={actions} />
        </div>

        <div className="room3d-layout__inspector">
          <RoomInspector state={state} item={selected} conflicts={conflicts} actions={actions} />
        </div>
      </div>
    </>
  );
}
