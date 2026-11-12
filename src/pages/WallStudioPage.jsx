import { useCallback, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader.jsx';
import { ProjectDiffModal } from '../components/ProjectDiffModal.jsx';
import { BlueprintSheetModal } from '../components/studio/BlueprintSheetModal.jsx';
import { StudioInspector } from '../components/studio/StudioInspector.jsx';
import { StudioPalette } from '../components/studio/StudioPalette.jsx';
import { StudioSummary } from '../components/studio/StudioSummary.jsx';
import { StudioToolbar } from '../components/studio/StudioToolbar.jsx';
import { WallStage } from '../components/studio/WallStage.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useCloudSave } from '../hooks/useCloudSave.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useDraftDiff } from '../hooks/useDraftDiff.js';
import { useHistoryShortcuts } from '../hooks/useHistoryShortcuts.js';
import { useLaunchedModule } from '../hooks/useLaunchedModule.js';
import { useProjectName } from '../hooks/useProjectName.js';
import { useSharedSceneLoader, useShareLink } from '../hooks/useSceneShare.js';
import { useWallStudio } from '../hooks/useWallStudio.js';
import { computeBusTopology } from '../lib/bus-topology.js';
import { plannerDiffSources } from '../lib/diff-sources.js';
import { computeWallLuxField, createWallLuxProbe } from '../lib/illuminance-field.js';
import { matchLightingScene } from '../lib/lighting-scenes.js';
import { computeEnvironmentalPhysics } from '../lib/room-physics.js';
import {
  aggregateBagLines,
  findConflicts,
  GRID_STEP_CM,
  FINE_STEP_CM,
  PX_PER_CM,
  summarizeWall,
} from '../lib/wall-studio.js';
import '../styles/pages.css';
import '../styles/studio.css';

function samePreview(a, b) {
  if (!a || !b || a.uid !== b.uid || a.spots.size !== b.spots.size) return false;
  for (const [uid, spot] of b.spots) {
    const prev = a.spots.get(uid);
    if (!prev || prev.xCm !== spot.xCm || prev.yCm !== spot.yCm) return false;
  }
  return true;
}

export default function WallStudioPage() {
  useDocumentTitle('Wall Studio');
  const [mode] = useDisplayMode();
  const { layout, selected, selectedUids, notice, canUndo, canRedo, actions } = useWallStudio();
  const { addMany } = useBag();
  const { openBag } = useBagDrawer();
  const [drag, setDrag] = useState(null);
  const [syncNote, setSyncNote] = useState('');
  const syncRef = useRef(null);
  const cloud = useCloudSave('wall');
  const project = useProjectName('wall');
  const [busOn, setBusOn] = useState(false);
  const [luxOn, setLuxOn] = useState(false);
  const shareLink = useShareLink('wall');
  const [blueprint, setBlueprint] = useState(null);
  const closeBlueprint = useCallback(() => setBlueprint(null), []);
  const draftDiff = useDraftDiff();
  const diffProjects = draftDiff.session?.projects ?? null;
  const diffView = useMemo(
    () => (diffProjects ? plannerDiffSources('wall', layout, project.name, diffProjects, cloud.record) : null),
    [diffProjects, layout, project.name, cloud.record],
  );

  useHistoryShortcuts(actions);
  useLaunchedModule(layout.items, actions);
  useSharedSceneLoader('wall', ({ state, name }) => {
    project.change(name);
    const count = state.items.length;
    actions.importLayout(state, `Loaded shared scene ${name}: ${count} ${count === 1 ? 'module' : 'modules'}.`);
  });

  // While dragging, geometry, conflicts and readouts follow the preview
  // positions of the dragged module or group; the history only receives the
  // final drop.
  const live = useMemo(() => {
    if (!drag) return layout;
    return {
      ...layout,
      items: layout.items.map((item) => {
        const spot = drag.spots.get(item.uid);
        return spot ? { ...item, xCm: spot.xCm, yCm: spot.yCm } : item;
      }),
    };
  }, [layout, drag]);
  const dragUids = useMemo(() => (drag ? [...drag.spots.keys()] : []), [drag]);

  const conflicts = useMemo(() => findConflicts(live), [live]);
  const summary = useMemo(() => summarizeWall(layout), [layout]);
  const bus = useMemo(() => computeBusTopology(live), [live]);
  const physics = useMemo(() => computeEnvironmentalPhysics(layout), [layout]);
  // Follows the drag preview, so the photometric field moves with the module.
  const luxMap = useMemo(
    () => (luxOn ? { field: computeWallLuxField(live), probe: createWallLuxProbe(live) } : null),
    [luxOn, live],
  );
  const activeScene = useMemo(() => matchLightingScene(layout.items, layout.wall.surface), [layout]);
  const showBus = mode === 'technical' || busOn;
  const liveSelected = selected ? (live.items.find((item) => item.uid === selected.uid) ?? null) : null;
  const liveSelection = useMemo(() => {
    const wanted = new Set(selectedUids);
    return live.items.filter((item) => wanted.has(item.uid));
  }, [live, selectedUids]);

  const preview = (next) => {
    setDrag((prev) => (next === null ? null : samePreview(prev, next) ? prev : next));
  };

  // A null uid means the bare wall has focus: act on the whole selection.
  const inGroup = (uid) => selectedUids.length > 1 && (uid === null || selectedUids.includes(uid));

  const nudge = (uid, dx, dy) => {
    if (inGroup(uid)) {
      actions.moveGroup(selectedUids, dx, dy);
      return;
    }
    const item = layout.items.find((entry) => entry.uid === (uid ?? selectedUids[0]));
    if (item && !item.locked) actions.update(item.uid, { xCm: item.xCm + dx, yCm: item.yCm + dy });
  };

  const remove = (uid) => {
    if (inGroup(uid)) actions.removeMany(selectedUids);
    else if (uid ?? selectedUids[0]) actions.remove(uid ?? selectedUids[0]);
  };

  const syncToBag = () => {
    const lines = aggregateBagLines(layout.items);
    if (lines.length === 0) return;
    addMany(lines, project.commit());
    const modules = layout.items.length;
    setSyncNote(
      `Synced ${modules} ${modules === 1 ? 'module' : 'modules'} as ${lines.length} cart ${lines.length === 1 ? 'line' : 'lines'}.`,
    );
    openBag(syncRef.current);
  };

  const { wall } = layout;

  return (
    <>
      <PageHeader
        index="03"
        section="Wall Studio"
        title="Wall Studio"
        lede="A to-scale 2D elevation planner. Mount parts from the index, drag them into place, check clearances against the wall and roof slope, then send the bill of materials to the cart."
        meta={[
          ['Scale', `1 cm = ${PX_PER_CM} px`],
          ['Snap', `${wall.snap ? GRID_STEP_CM : FINE_STEP_CM} cm`],
          ['Wall', `${wall.widthCm} x ${wall.heightCm} cm`],
        ]}
      />

      <div className="studio-layout container" data-mode={mode}>
        <div className="studio-layout__main">
          <WallStage
            layout={live}
            conflicts={conflicts}
            selectedUid={selected?.uid ?? null}
            selectedUids={selectedUids}
            dragUid={drag?.uid ?? null}
            dragUids={dragUids}
            technical={mode === 'technical'}
            busTopology={showBus ? bus : null}
            luxMap={luxMap}
            toolbar={
              <StudioToolbar
                layout={layout}
                canUndo={canUndo}
                canRedo={canRedo}
                notice={notice}
                actions={actions}
                busOn={busOn}
                onToggleBus={() => setBusOn((on) => !on)}
                luxOn={luxOn}
                onToggleLux={() => setLuxOn((on) => !on)}
                shareUrl={shareLink.shareUrl}
                onShare={() => shareLink.share(layout, project.commit())}
                blueprintOpen={blueprint !== null}
                onOpenBlueprint={(trigger) => setBlueprint({ trigger, name: project.commit() })}
                activeScene={activeScene}
              />
            }
            onSelect={actions.select}
            onToggleSelect={actions.toggleSelect}
            onSelectMany={actions.selectMany}
            onSelectAll={actions.selectAll}
            onDragPreview={preview}
            onDragCommit={(uid, xCm, yCm) => actions.update(uid, { xCm, yCm })}
            onGroupCommit={actions.moveGroup}
            onNudge={nudge}
            onRemove={remove}
          />
          <StudioSummary
            summary={summary}
            bus={bus}
            physics={physics}
            conflictCount={conflicts.size}
            syncNote={syncNote}
            syncRef={syncRef}
            cloudStatus={cloud.status}
            project={project}
            onSave={() => cloud.save(layout, project.commit())}
            onSync={syncToBag}
            onCompare={(trigger) => {
              project.commit();
              draftDiff.open(trigger);
            }}
          />
        </div>

        <div className="studio-layout__palette">
          <StudioPalette layout={layout} actions={actions} />
        </div>

        <div className="studio-layout__inspector">
          <StudioInspector
            layout={live}
            item={liveSelected}
            selection={liveSelection}
            conflicts={conflicts}
            actions={actions}
          />
        </div>
      </div>

      <BlueprintSheetModal
        open={blueprint !== null}
        onClose={closeBlueprint}
        layout={layout}
        projectName={blueprint?.name ?? ''}
        returnFocus={blueprint?.trigger ?? null}
      />

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
