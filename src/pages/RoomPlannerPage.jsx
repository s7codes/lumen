import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectDiffModal } from '../components/ProjectDiffModal.jsx';
import { RoomControls } from '../components/room3d/RoomControls.jsx';
import { RoomInspector } from '../components/room3d/RoomInspector.jsx';
import { RoomSummary } from '../components/room3d/RoomSummary.jsx';
import { RoomToolbar } from '../components/room3d/RoomToolbar.jsx';
import { RoomViewport } from '../components/room3d/RoomViewport.jsx';
import { StudioHeader } from '../components/room3d/StudioHeader.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useCloudSave } from '../hooks/useCloudSave.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useDraftDiff } from '../hooks/useDraftDiff.js';
import { useHistoryShortcuts } from '../hooks/useHistoryShortcuts.js';
import { useLaunchedModule } from '../hooks/useLaunchedModule.js';
import { useProjectName } from '../hooks/useProjectName.js';
import { useRoom3d } from '../hooks/useRoom3d.js';
import { useSharedSceneLoader, useShareLink } from '../hooks/useSceneShare.js';
import { useWallDrag } from '../hooks/useWallDrag.js';
import { computeBusTopology } from '../lib/bus-topology.js';
import { plannerDiffSources } from '../lib/diff-sources.js';
import { computeFloorLuxField } from '../lib/illuminance-field.js';
import { matchLightingScene, roomSurface } from '../lib/lighting-scenes.js';
import { computeEnvironmentalPhysics } from '../lib/room-physics.js';
import { downloadText } from '../lib/download.js';
import { buildRoomObj, countObjObjects, OBJ_MIME, objFilename } from '../lib/obj-export.js';
import { DEFAULT_ROOM_WALL, exportToWallStudio, findRoomConflicts, unrolledRoom, WALL_LABELS } from '../lib/room-3d.js';
import { FREE_SNAP_CM, GRID_SNAP_CM, sanitizeAxisLock } from '../lib/room-raycast.js';
import {
  CAMERA_MODE_LABELS,
  defaultStance,
  DEFAULT_CAMERA_MODE,
  eyeIlluminance,
  lookWalk,
  sanitizeCameraMode,
  sanitizeWalk,
  stepWalk,
  turnWalk,
  WALL_LOOK_HEADING,
} from '../lib/room-walkthrough.js';
import { aggregateBagLines, summarizeWall } from '../lib/wall-studio.js';
import '../styles/pages.css';
import '../styles/studio.css';
import '../styles/room3d.css';

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

function sameStance(a, b) {
  return a.xCm === b.xCm && a.zCm === b.zCm && a.headingDeg === b.headingDeg && a.pitchDeg === b.pitchDeg;
}

export default function RoomPlannerPage() {
  useDocumentTitle('Room Planner');
  const [mode] = useDisplayMode();
  const { state, selected, activeWall, counts, notice, canUndo, canRedo, actions } = useRoom3d();
  const { addMany } = useBag();
  const { openBag } = useBagDrawer();
  const { addToast } = useToast();
  const [status, setStatus] = useState('');
  const [wireframe, setWireframe] = useState(false);
  const [floorLuxOn, setFloorLuxOn] = useState(false);
  const [cameraMode, setCameraMode] = useState(DEFAULT_CAMERA_MODE);
  const [walk, setWalk] = useState(() => defaultStance(state.room, activeWall));
  const [snapOn, setSnapOn] = useState(true);
  const [axisLock, setAxisLock] = useState('free');
  const [zen, setZen] = useState(false);
  const syncRef = useRef(null);
  const cloud = useCloudSave('room');
  const project = useProjectName('room');
  const shareLink = useShareLink('room');
  const draftDiff = useDraftDiff();
  const diffProjects = draftDiff.session?.projects ?? null;
  const diffView = useMemo(
    () => (diffProjects ? plannerDiffSources('room', state, project.name, diffProjects, cloud.record) : null),
    [diffProjects, state, project.name, cloud.record],
  );
  useHistoryShortcuts(actions);
  useLaunchedModule(state.items, actions);
  useSharedSceneLoader('room', ({ state: shared, name }) => {
    project.change(name);
    actions.replace(shared, `Loaded shared scene ${name}: ${plural(shared.items.length, 'module')}.`);
    setStatus('');
  });

  const snapCm = snapOn ? GRID_SNAP_CM : FREE_SNAP_CM;
  const drag = useWallDrag({
    state,
    selectedUid: selected?.uid ?? null,
    snapCm,
    axisLock,
    onCommit: actions.move,
  });

  const conflicts = useMemo(() => findRoomConflicts(state), [state]);
  const summary = useMemo(() => summarizeWall(state), [state]);
  // The daisy-chain runs around the room: the four walls are unrolled into one elevation.
  const bus = useMemo(() => computeBusTopology(unrolledRoom(state)), [state]);
  const physics = useMemo(() => computeEnvironmentalPhysics(state), [state]);
  const floorLux = useMemo(() => (floorLuxOn ? computeFloorLuxField(state) : null), [floorLuxOn, state]);
  const activeScene = useMemo(() => matchLightingScene(state.items, roomSurface(state.room)), [state.items, state.room]);
  const { room } = state;
  const eyeLux = useMemo(() => eyeIlluminance({ room: state.room, items: state.items }, walk), [state.room, state.items, walk]);

  // A new envelope or floor reference pushes the observer back into free floor.
  useEffect(() => {
    setWalk((current) => {
      const next = sanitizeWalk(current, room);
      return sameStance(next, current) ? current : next;
    });
  }, [room]);

  // At eye level the view turns to face whichever wall becomes active.
  useEffect(() => {
    if (cameraMode !== 'inside') return;
    setWalk((current) => ({ ...current, headingDeg: WALL_LOOK_HEADING[activeWall], pitchDeg: 0 }));
  }, [activeWall, cameraMode]);

  const onWall = useCallback(
    (wall) => {
      if (wall === activeWall && cameraMode === 'inside') {
        setWalk((current) => ({ ...current, headingDeg: WALL_LOOK_HEADING[wall], pitchDeg: 0 }));
      }
      actions.setWall(wall);
    },
    [actions, activeWall, cameraMode],
  );

  const onCameraMode = useCallback(
    (next) => {
      const lens = sanitizeCameraMode(next);
      if (lens === cameraMode) return;
      setCameraMode(lens);
      actions.announce(`${CAMERA_MODE_LABELS[lens]} lens.`);
    },
    [actions, cameraMode],
  );

  const walkActions = useMemo(
    () => ({
      step: (move) => setWalk((current) => stepWalk(current, room, move)),
      turn: (delta) => setWalk((current) => turnWalk(current, delta)),
      reset: () => setWalk(defaultStance(room, activeWall)),
      look: ({ headingDeg, pitchDeg }) => setWalk((current) => lookWalk(current, headingDeg, pitchDeg)),
    }),
    [room, activeWall],
  );

  const pushToWall = () => {
    const { layout, moved, capped } = exportToWallStudio(state, activeWall);
    const { widthCm, heightCm } = layout.wall;
    const which = activeWall === DEFAULT_ROOM_WALL ? '' : `${WALL_LABELS[activeWall]} `;
    let text = `Pushed ${layout.items.length} ${which}${layout.items.length === 1 ? 'module' : 'modules'} to Wall Studio, wall ${widthCm} x ${heightCm} cm.`;
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
      <div className="room3d-workstation" data-mode={mode} data-zen={zen || undefined} data-camera-mode={cameraMode}>
        <StudioHeader
          room={room}
          activeWall={activeWall}
          counts={counts}
          onWall={onWall}
          cameraMode={cameraMode}
          onCameraMode={onCameraMode}
          snapOn={snapOn}
          onSnap={setSnapOn}
          zen={zen}
          onZen={setZen}
        />

        <div className="room3d-layout room3d-workstation__body">
          <div className="room3d-layout__controls" inert={zen}>
            <RoomControls state={state} activeWall={activeWall} actions={actions} />
          </div>

          <div className="room3d-layout__main">
            <RoomViewport
              state={state}
              activeWall={activeWall}
              counts={counts}
              conflicts={conflicts}
              selectedUid={selected?.uid ?? null}
              technical={mode === 'technical'}
              wireframe={wireframe}
              floorLux={floorLux}
              cameraMode={cameraMode}
              walk={walk}
              eyeLux={eyeLux}
              drag={drag}
              axisLock={axisLock}
              toolbar={
                <RoomToolbar
                  camera={state.camera}
                  cameraMode={cameraMode}
                  notice={notice}
                  onCamera={actions.setCamera}
                  activeScene={activeScene}
                  sceneDisabled={state.items.length === 0}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  wallLabel={WALL_LABELS[activeWall]}
                  wallCount={counts[activeWall]}
                  onApplyScene={actions.applyScene}
                  onUndo={actions.undo}
                  onRedo={actions.redo}
                  onClearWall={actions.clearWall}
                />
              }
              onSelect={actions.select}
              onCameraCommit={actions.setCamera}
              onWireframe={setWireframe}
              onFloorLux={setFloorLuxOn}
              onWall={onWall}
              onCameraMode={onCameraMode}
              onWalkStep={walkActions.step}
              onWalkTurn={walkActions.turn}
              onWalkReset={walkActions.reset}
              onWalkLook={walkActions.look}
            />
          </div>

          <div className="room3d-layout__inspector" inert={zen}>
            <RoomInspector
              state={state}
              item={selected}
              activeWall={activeWall}
              conflicts={conflicts}
              actions={actions}
              axisLock={axisLock}
              snapCm={snapCm}
              onAxisLock={(lock) => setAxisLock(sanitizeAxisLock(lock))}
              onNudge={drag.nudgeCommit}
            />
          </div>
        </div>

        <div className="room3d-workstation__dock">
          <RoomSummary
            summary={summary}
            bus={bus}
            physics={physics}
            floorLux={floorLux}
            shareUrl={shareLink.shareUrl}
            onShare={() => shareLink.share(state, project.commit())}
            conflictCount={conflicts.size}
            wallLabel={WALL_LABELS[activeWall]}
            wallCount={counts[activeWall]}
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
            onCompare={(trigger) => {
              project.commit();
              draftDiff.open(trigger);
            }}
          />
        </div>
      </div>

      <ProjectDiffModal
        open={draftDiff.session !== null}
        onClose={draftDiff.close}
        sources={diffView?.sources ?? null}
        baseId={diffView?.baseId}
        targetId={diffView?.targetId}
        returnFocus={draftDiff.session?.trigger ?? null}
        title="Draft against Cloud Revision"
      />
    </>
  );
}
