import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { ArrowRight } from '../icons.jsx';
import { LightingSceneBar } from '../LightingSceneBar.jsx';
import { prefetchRoute } from '../../lib/route-manifest.js';
import { MAX_IMPORT_BYTES, sanitizeLayout, serializeLayout } from '../../lib/wall-studio.js';
import { safeJsonParse } from '../../security/sanitize.js';

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StudioToolbar({
  layout,
  canUndo,
  canRedo,
  notice,
  actions,
  busOn,
  onToggleBus,
  luxOn,
  onToggleLux,
  shareUrl,
  onShare,
  blueprintOpen,
  onOpenBlueprint,
  activeScene = null,
}) {
  const fileRef = useRef(null);
  const [armed, setArmed] = useState(false);
  const { addToast } = useToast();
  const count = layout.items.length;

  const exportLayout = () => {
    const { widthCm, heightCm } = layout.wall;
    downloadJson(`lumen-wall-${widthCm}x${heightCm}.json`, serializeLayout(layout));
    const text = `Exported ${count} ${count === 1 ? 'module' : 'modules'} as JSON.`;
    actions.announce(text);
    addToast(`Wall layout saved. ${text}`, 'success');
  };

  const importFile = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      actions.announce('Import rejected: file exceeds 100 KB.', 'warn');
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch {
      actions.announce('Import rejected: file could not be read.', 'warn');
      return;
    }

    const parsed = safeJsonParse(text, { fallback: null, maxLength: MAX_IMPORT_BYTES });
    const next = sanitizeLayout(parsed);
    if (!next) {
      actions.announce('Import rejected: not a Lumen wall layout.', 'warn');
      return;
    }
    const kept = next.items.length;
    const dropped = parsed.items.length - kept;
    const base = `Imported ${kept} ${kept === 1 ? 'module' : 'modules'}`;
    const result = dropped > 0 ? `${base}, ${dropped} rejected.` : `${base}.`;
    actions.importLayout(next, result);
    addToast(result, dropped > 0 ? 'warn' : 'success');
  };

  const warm3d = () => prefetchRoute('/room-3d');

  // Everyday edits and scenes sit on the main row with the bridge to the 3D
  // studio; the engineering keys drop to a quiet strip beneath it.
  return (
    <div className="studio-toolbar">
      <div className="studio-toolbar__row">
        <div className="studio-toolbar__cluster" role="group" aria-label="History and edit">
          <span className="studio-toolbar__caption" aria-hidden="true">
            Edit
          </span>
          <button
            type="button"
            className="tool-button"
            onClick={actions.undo}
            disabled={!canUndo}
            aria-keyshortcuts="Control+Z"
          >
            Undo
          </button>
          <button
            type="button"
            className="tool-button"
            onClick={actions.redo}
            disabled={!canRedo}
            aria-keyshortcuts="Control+Y"
          >
            Redo
          </button>
          <button
            type="button"
            className="tool-button tool-button--danger"
            data-armed={armed || undefined}
            disabled={count === 0}
            onBlur={() => setArmed(false)}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              actions.clear();
            }}
          >
            {armed ? `Confirm: clear ${count}` : 'Clear Wall'}
          </button>
        </div>

        <LightingSceneBar
          className="studio-toolbar__cluster"
          active={activeScene}
          disabled={count === 0}
          onApply={actions.applyScene}
        />

        <Link
          to="/room-3d"
          className="studio-toolbar__bridge"
          data-testid="studio-open-3d"
          title="Open the 3D Spatial Studio and stand in the room"
          onPointerEnter={warm3d}
          onFocus={warm3d}
        >
          Open in 3D Studio
          <ArrowRight />
        </Link>
      </div>

      <div className="studio-toolbar__row studio-toolbar__row--strip">
        <div
          className="studio-toolbar__cluster studio-toolbar__cluster--quiet"
          role="group"
          aria-label="Engineering overlays and export"
        >
          <span className="studio-toolbar__caption" aria-hidden="true">
            Engineering
          </span>
          <button
            type="button"
            className="tool-button"
            aria-pressed={busOn}
            data-testid="toggle-bus-topology"
            title="Show the 24V DC daisy-chain routing"
            onClick={onToggleBus}
          >
            24V Bus
          </button>
          <button
            type="button"
            className="tool-button"
            aria-pressed={luxOn}
            data-testid="toggle-lux-heatmap"
            title="Point-by-point illuminance with 100 / 250 / 500 lx iso-lux contours"
            onClick={onToggleLux}
          >
            Iso-Lux Map
          </button>
          <span className="studio-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="tool-button"
            aria-haspopup="dialog"
            aria-expanded={blueprintOpen}
            data-testid="open-blueprint-sheet"
            title="1:20 A3 elevation with drilling schedule, SVG and AutoCAD DXF export"
            onClick={(event) => onOpenBlueprint(event.currentTarget)}
          >
            Blueprint
          </button>
          <button
            type="button"
            className="tool-button"
            data-testid="copy-share-link"
            data-share-url={shareUrl || undefined}
            title="Copy a link that reopens this wall"
            onClick={onShare}
          >
            Share Link
          </button>
          <button type="button" className="tool-button" title="Download this wall as a Lumen JSON file" onClick={exportLayout}>
            Export JSON
          </button>
          <button
            type="button"
            className="tool-button"
            title="Open a Lumen JSON wall file"
            onClick={() => fileRef.current?.click()}
          >
            Import JSON
          </button>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            aria-label="Import layout file"
            data-testid="import-layout"
            onChange={importFile}
          />
        </div>

        <p className="studio-toolbar__notice" role="status" aria-live="polite" data-tone={notice.tone}>
          <span key={notice.serial} className="notice-transient" data-testid="studio-notice">
            {notice.text}
          </span>
        </p>
      </div>
    </div>
  );
}
