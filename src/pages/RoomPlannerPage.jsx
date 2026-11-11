import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader.jsx';
import { RoomControls } from '../components/room3d/RoomControls.jsx';
import { RoomInspector } from '../components/room3d/RoomInspector.jsx';
import { RoomSummary } from '../components/room3d/RoomSummary.jsx';
import { RoomToolbar } from '../components/room3d/RoomToolbar.jsx';
import { RoomViewport } from '../components/room3d/RoomViewport.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useCloudSave } from '../hooks/useCloudSave.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useLaunchedModule } from '../hooks/useLaunchedModule.js';
import { useProjectName } from '../hooks/useProjectName.js';
import { useRoom3d } from '../hooks/useRoom3d.js';
import { useSharedSceneLoader, useShareLink } from '../hooks/useSceneShare.js';
import { computeBusTopology } from '../lib/bus-topology.js';
import { downloadText } from '../lib/download.js';
import { buildRoomObj, countObjObjects, OBJ_MIME, objFilename } from '../lib/obj-export.js';
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
  const { addToast } = useToast();
  const [status, setStatus] = useState('');
  const [wireframe, setWireframe] = useState(false);
  const syncRef = useRef(null);
  const cloud = useCloudSave('room');
  const project = useProjectName('room');
  const shareLink = useShareLink('room');
  useLaunchedModule(state.items, actions);
  useSharedSceneLoader('room', ({ state: shared, name }) => {
    project.change(name);
    actions.replace(shared, `Loaded shared scene ${name}: ${plural(shared.items.length, 'module')}.`);
    setStatus('');
  });

  const conflicts = useMemo(() => findRoomConflicts(state), [state]);
  const summary = useMemo(() => summarizeWall(state), [state]);
  const bus = useMemo(() => computeBusTopology(state), [state]);
  const { room } = state;

  const pushToWall = () => {
    const { layout, moved, capped } = exportToWallStudio(state);
    const { widthCm, heightCm } = layout.wall;
    let text = `Pushed ${plural(layout.items.length, 'module')} to Wall Studio, wall ${widthCm} x ${heightCm} cm.`;
    if (capped) text += ` Wall capped at ${widthCm} cm; ${plural(moved, 'module')} pulled inside.`;
    setStatus(text);
    actions.announce(text, capped && moved > 0 ? 'warn' : 'info');
    addToast(`Room saved to Wall Studio: ${plural(layout.items.length, 'module')}.`, capped && moved > 0 ? 'warn' : 'success');
  };

  const syncToBag = () => {
    const lines = aggregateBagLines(state.items);
    if (lines.length === 0) return;
    addMany(lines, project.commit());
    setStatus(`Synced ${plural(state.items.length, 'module')} as ${plural(lines.length, 'cart line')}.`);
    openBag(syncRef.current);
  };

  const exportObj = () => {
    const name = project.commit();
    const text = buildRoomObj(state, name);
    downloadText(objFilename(name), text, OBJ_MIME);
    const detail = `${plural(state.items.length, 'module')}, ${plural(countObjObjects(text), 'object')}`;
    setStatus(`Exported Wavefront OBJ: ${detail}, cm units.`);
    addToast(`${name} exported as Wavefront .OBJ. ${detail}.`, 'success');
  };

  return (
    <>
      <PageHeader
        index="03"
        section="3D Room"
        title="Room Planner"
        lede="A dimensioned room with the main wall at Z 0. Mount parts in three dimensions, check clearances against a floor reference, and move the wall between the 2D studio, the room and the cart."
        meta={[
          ['Engine', 'WebGL 2 / React Three Fiber'],
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
            wireframe={wireframe}
            toolbar={<RoomToolbar camera={state.camera} notice={notice} onCamera={actions.setCamera} />}
            onSelect={actions.select}
            onCameraCommit={actions.setCamera}
            onWireframe={setWireframe}
          />
          <RoomSummary
            summary={summary}
            bus={bus}
            shareUrl={shareLink.shareUrl}
            onShare={() => shareLink.share(state, project.commit())}
            conflictCount={conflicts.size}
            status={status}
            syncRef={syncRef}
            cloudStatus={cloud.status}
            onImport={() => {
              actions.importWall();
              setStatus('');
            }}
            project={project}
            onExport={pushToWall}
            onExportObj={exportObj}
            onSave={() => cloud.save(state, project.commit())}
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
