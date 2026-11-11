import { useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
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

  return (
    <div className="studio-toolbar">
      <div className="studio-toolbar__group" role="group" aria-label="History">
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
      </div>

      <div className="studio-toolbar__group" role="group" aria-label="Layout file">
        <button type="button" className="tool-button" onClick={exportLayout}>
          Export JSON
        </button>
        <button type="button" className="tool-button" onClick={() => fileRef.current?.click()}>
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
        <button
          type="button"
          className="tool-button"
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
          {armed ? `Confirm: clear ${count}` : 'Clear wall'}
        </button>
      </div>

      <div className="studio-toolbar__group" role="group" aria-label="Overlay and sharing">
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
      </div>

      <p className="studio-toolbar__notice mono" role="status" aria-live="polite" data-tone={notice.tone}>
        <span key={notice.serial} className="notice-transient" data-testid="studio-notice">
          {notice.text}
        </span>
      </p>
    </div>
  );
}
