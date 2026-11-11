import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader.jsx';
import { StudioInspector } from '../components/studio/StudioInspector.jsx';
import { StudioPalette } from '../components/studio/StudioPalette.jsx';
import { StudioSummary } from '../components/studio/StudioSummary.jsx';
import { StudioToolbar } from '../components/studio/StudioToolbar.jsx';
import { WallStage } from '../components/studio/WallStage.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useCloudSave } from '../hooks/useCloudSave.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { useLaunchedModule } from '../hooks/useLaunchedModule.js';
import { useProjectName } from '../hooks/useProjectName.js';
import { useSharedSceneLoader, useShareLink } from '../hooks/useSceneShare.js';
import { useWallStudio } from '../hooks/useWallStudio.js';
import { computeBusTopology } from '../lib/bus-topology.js';
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

const TEXT_ENTRY = 'textarea, select, [contenteditable="true"], input:not([type="radio"]):not([type="checkbox"])';

function useHistoryShortcuts(actions) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(`${TEXT_ENTRY}, [role="dialog"]`)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        actions.undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        actions.redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}

export default function WallStudioPage() {
  useDocumentTitle('Wall Studio');
  const [mode] = useDisplayMode();
  const { layout, selected, notice, canUndo, canRedo, actions } = useWallStudio();
  const { addMany } = useBag();
  const { openBag } = useBagDrawer();
  const [drag, setDrag] = useState(null);
  const [syncNote, setSyncNote] = useState('');
  const syncRef = useRef(null);
  const cloud = useCloudSave('wall');
  const project = useProjectName('wall');
  const [busOn, setBusOn] = useState(false);
  const shareLink = useShareLink('wall');

  useHistoryShortcuts(actions);
  useLaunchedModule(layout.items, actions);
  useSharedSceneLoader('wall', ({ state, name }) => {
    project.change(name);
    const count = state.items.length;
    actions.importLayout(state, `Loaded shared scene ${name}: ${count} ${count === 1 ? 'module' : 'modules'}.`);
  });

  // While dragging, geometry, conflicts and readouts follow the preview
  // position; the history only receives the final drop.
  const live = useMemo(() => {
    if (!drag) return layout;
    return {
      ...layout,
      items: layout.items.map((item) => (item.uid === drag.uid ? { ...item, xCm: drag.xCm, yCm: drag.yCm } : item)),
    };
  }, [layout, drag]);

  const conflicts = useMemo(() => findConflicts(live), [live]);
  const summary = useMemo(() => summarizeWall(layout), [layout]);
  const bus = useMemo(() => computeBusTopology(live), [live]);
  const physics = useMemo(() => computeEnvironmentalPhysics(layout), [layout]);
  const showBus = mode === 'technical' || busOn;
  const liveSelected = selected ? (live.items.find((item) => item.uid === selected.uid) ?? null) : null;

  const preview = (next) => {
    setDrag((prev) => {
      if (next === null) return null;
      return prev && prev.uid === next.uid && prev.xCm === next.xCm && prev.yCm === next.yCm ? prev : next;
    });
  };

  const nudge = (uid, dx, dy) => {
    const item = layout.items.find((entry) => entry.uid === uid);
    if (item && !item.locked) actions.update(uid, { xCm: item.xCm + dx, yCm: item.yCm + dy });
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
        index="04"
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
            dragUid={drag?.uid ?? null}
            technical={mode === 'technical'}
            busTopology={showBus ? bus : null}
            toolbar={
              <StudioToolbar
                layout={layout}
                canUndo={canUndo}
                canRedo={canRedo}
                notice={notice}
                actions={actions}
                busOn={busOn}
                onToggleBus={() => setBusOn((on) => !on)}
                shareUrl={shareLink.shareUrl}
                onShare={() => shareLink.share(layout, project.commit())}
              />
            }
            onSelect={actions.select}
            onDragPreview={preview}
            onDragCommit={(uid, xCm, yCm) => actions.update(uid, { xCm, yCm })}
            onNudge={nudge}
            onRemove={actions.remove}
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
          />
        </div>

        <div className="studio-layout__palette">
          <StudioPalette layout={layout} actions={actions} />
        </div>

        <div className="studio-layout__inspector">
          <StudioInspector layout={live} item={liveSelected} conflicts={conflicts} actions={actions} />
        </div>
      </div>
    </>
  );
}
