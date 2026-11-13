import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useToast } from '../contexts/ToastContext.jsx';
import { useBagDrawer } from '../hooks/useBag.js';
import { CommandPaletteContext, useCommandPalette } from '../hooks/useCommandPalette.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { useDisplayMode } from '../hooks/useDisplayMode.js';
import { useModalDialog } from '../hooks/useModalDialog.js';
import { buildCommandIndex, QUERY_MAX, searchCommands } from '../lib/command-index.js';
import { MODE_LABELS } from '../lib/display-mode.js';
import { padIndex } from '../lib/format.js';
import { getCurrency } from '../lib/quote.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { getProduct } from '../data/products.js';
import { CommandGlyph, ModuleGlyph, SearchGlyph, WorkspaceGlyph } from './icons.jsx';
import { ProductThumbGlyph } from './ProductThumbGlyph.jsx';
import '../styles/command-palette.css';

const GROUP_GLYPHS = { workspaces: WorkspaceGlyph, modules: ModuleGlyph, commands: CommandGlyph };

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const PALETTE_SHORTCUT_LABEL = IS_APPLE ? 'Cmd+K' : 'Ctrl+K';

function isPaletteShortcut(event) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    typeof event.key === 'string' &&
    event.key.toLowerCase() === 'k'
  );
}

/**
 * Owns the palette's open state and the global Ctrl+K / Cmd+K shortcut. The
 * shortcut toggles the palette from anywhere, but never stacks it on top of
 * another modal (cart drawer, sign-in dialog).
 */
export function CommandPaletteProvider({ children }) {
  const [state, setState] = useState({ open: false, returnFocus: null });
  const openRef = useRef(false);

  const openPalette = useCallback((returnFocus = null) => setState({ open: true, returnFocus }), []);
  const closePalette = useCallback(() => setState((prev) => (prev.open ? { ...prev, open: false } : prev)), []);

  useEffect(() => {
    openRef.current = state.open;
  }, [state.open]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (openRef.current) {
        closePalette();
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      const focused = document.activeElement;
      openPalette(focused instanceof HTMLElement && focused !== document.body ? focused : null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPalette, closePalette]);

  const value = useMemo(
    () => ({ open: state.open, returnFocus: state.returnFocus, openPalette, closePalette }),
    [state, openPalette, closePalette],
  );

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>;
}

export function CommandPalette({ onSignIn }) {
  const { open, returnFocus, closePalette } = useCommandPalette();
  if (!open) return null;
  return <PaletteDialog returnFocus={returnFocus} onClose={closePalette} onSignIn={onSignIn} />;
}

function PaletteDialog({ returnFocus, onClose, onSignIn }) {
  const uid = useId();
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { openBag } = useBagDrawer();
  const { user } = useAuth();
  const [mode, setMode] = useDisplayMode();
  const [currency, setCurrency] = useCurrency();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useModalDialog({ open: true, panelRef, initialFocusRef: inputRef, returnFocus, onClose });

  const index = useMemo(() => buildCommandIndex({ mode, currency, signedIn: Boolean(user) }), [mode, currency, user]);
  const groups = useMemo(() => searchCommands(index, query), [index, query]);
  const flat = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  const position = useMemo(() => new Map(flat.map((entry, i) => [entry.id, i])), [flat]);
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const activeEntry = activeIndex >= 0 ? flat[activeIndex] : null;
  const listId = `${uid}-list`;
  const optionId = (id) => `${uid}-${id}`;

  useEffect(() => {
    if (!activeEntry) return;
    document.getElementById(`${uid}-${activeEntry.id}`)?.scrollIntoView({ block: 'nearest' });
    if (activeEntry.prefetch) prefetchRoute(activeEntry.prefetch);
  }, [activeEntry, uid]);

  const run = (entry) => {
    if (!entry) return;
    const { action } = entry;
    onClose();
    if (action.type === 'navigate') {
      navigate(action.path);
    } else if (action.type === 'sign-in') {
      onSignIn();
    } else if (action.type === 'mode') {
      setMode(action.mode);
      addToast(`Display mode: ${MODE_LABELS[action.mode]}.`, 'info');
    } else if (action.type === 'currency') {
      setCurrency(action.code);
      addToast(`Quote currency set to ${action.code}, ${getCurrency(action.code).label}.`, 'success');
    } else if (action.type === 'cart') {
      openBag(returnFocus);
    }
  };

  const onKeyDown = (event) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(activeEntry);
    }
  };

  return (
    <div className="palette-root">
      <div className="palette-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="palette palette-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        data-mode={mode}
      >
        <div className="palette__search">
          <SearchGlyph className="palette__search-glyph" />
          <input
            ref={inputRef}
            className="palette__input"
            data-testid="command-palette-input"
            type="text"
            role="combobox"
            aria-label="Search lighting, furniture, or pages"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeEntry ? optionId(activeEntry.id) : undefined}
            placeholder="Search lighting, furniture, or pages..."
            value={query}
            maxLength={QUERY_MAX}
            autoComplete="off"
            spellCheck="false"
            onChange={(event) => {
              setQuery(event.target.value.slice(0, QUERY_MAX));
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="palette__kbd">Esc</kbd>
        </div>

        <div id={listId} className="palette__list" role="listbox" aria-label="Results">
          {groups.map((group) => {
            const Glyph = GROUP_GLYPHS[group.id];
            return (
              <div key={group.id} className="palette__group" role="group" aria-labelledby={`${uid}-${group.id}-label`}>
                <div id={`${uid}-${group.id}-label`} className="palette__group-label" role="presentation">
                  <span>{group.label}</span>
                  <span className="palette__group-count tech-only">{padIndex(group.entries.length)}</span>
                </div>
                {group.entries.map((entry) => {
                  const i = position.get(entry.id);
                  const selected = i === activeIndex;
                  const product = entry.productId ? getProduct(entry.productId) : null;
                  return (
                    <div
                      key={entry.id}
                      id={optionId(entry.id)}
                      className="palette__option"
                      role="option"
                      aria-selected={selected}
                      data-testid="command-palette-item"
                      data-group={group.id}
                      data-active={selected || undefined}
                      onPointerMove={() => {
                        if (!selected) setActive(i);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => run(entry)}
                    >
                      {product ? (
                        <span className="palette__glyph palette__glyph--product">
                          <ProductThumbGlyph product={product} finish={product.defaultFinish} size="sm" />
                        </span>
                      ) : (
                        <span className="palette__glyph">
                          <Glyph />
                        </span>
                      )}
                      <span className="palette__text">
                        <span className="palette__label">{entry.label}</span>
                        <span className="palette__detail">
                          <span className="palette__summary">{entry.summary}</span>
                          {entry.detail !== entry.summary && (
                            <span className="palette__code tech-only" data-testid="command-palette-code">
                              {entry.detail}
                            </span>
                          )}
                        </span>
                      </span>
                      {entry.price ? (
                        <span className="palette__meta palette__price" data-testid="command-palette-price">
                          <span className="tech-only">{entry.metaTech}</span>
                          {entry.price}
                        </span>
                      ) : (
                        entry.meta && (
                          <span className="palette__meta" data-badge={entry.badge || undefined}>
                            {entry.meta}
                          </span>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {flat.length === 0 && (
          <p className="palette__empty" role="status" data-testid="command-palette-empty">
            No match. Try a product name, a page or a currency code.
          </p>
        )}

        <footer className="palette__footer" data-testid="command-palette-footer">
          <span className="palette__hint">Up/Down to navigate - Enter to open - Esc to close</span>
          <span className="visually-hidden" aria-live="polite" data-testid="command-palette-count">
            {flat.length} {flat.length === 1 ? 'result' : 'results'}
          </span>
        </footer>
      </div>
    </div>
  );
}
