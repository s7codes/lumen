import { useId } from 'react';
import { getFinish, getProduct } from '../../data/products.js';
import { dimFactor, sanitizeDimPct } from '../../lib/dimming.js';
import { formatInt, formatUsd, formatWatts } from '../../lib/format.js';
import { getFurniture, ROOM_WALLS, roomWall, WALL_LABELS, wallOf, wallSpanCm } from '../../lib/room-3d.js';
import { AXIS_LOCK_LABELS, AXIS_LOCKS } from '../../lib/room-raycast.js';
import { clampToWall } from '../../lib/wall-studio.js';
import '../../styles/product.css';
import { ProductThumbGlyph } from '../ProductThumbGlyph.jsx';
import { DimmingSlider, FinishPicker, NumberField, PanelSection, Switch } from '../studio/controls.jsx';

function conflictText(conflict, items, room) {
  if (!conflict) return 'Clear';
  if (conflict.bounds) return 'Exceeds wall';
  const parts = [];
  if (conflict.furniture) parts.push(`Collides with ${getFurniture(room.furniture).label}`);
  if (conflict.overlaps.length > 0) {
    const names = conflict.overlaps.map((uid) => {
      const other = items.find((entry) => entry.uid === uid);
      return other ? getProduct(other.productId).name : uid;
    });
    parts.push(`Overlaps ${names.join(', ')}`);
  }
  return parts.join(' / ');
}

function FocusGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
      <path d="M6 6h4v4H6z" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

/** Scene outliner: modules grouped by wall, each with a Focus in 3D key that swings the view to its wall. */
function ModuleList({ items, activeWall, conflicts, onSelect, onFocus }) {
  return (
    <PanelSection title="Modules" hint={items.length > 0 ? 'Scene outliner, grouped by wall.' : undefined}>
      {items.length === 0 ? (
        <p className="studio-panel__empty">No modules in the room yet. Pick a wall, then mount a component or load the 2D wall.</p>
      ) : (
        <div className="room3d-outliner" data-testid="room-module-list">
          {ROOM_WALLS.map((wall) => {
            const onWall = items.filter((item) => wallOf(item) === wall);
            const active = wall === activeWall;
            return (
              <section
                key={wall}
                className="room3d-outliner__group"
                data-testid={`outliner-${wall}`}
                data-wall={wall}
                data-count={onWall.length}
                data-active={active || undefined}
                aria-label={`${WALL_LABELS[wall]}, ${onWall.length} ${onWall.length === 1 ? 'module' : 'modules'}`}
              >
                <h3 className="room3d-outliner__heading">
                  <span className="room3d-outliner__wall">{WALL_LABELS[wall]}</span>
                  {active && <span className="room3d-outliner__badge mono">Active</span>}
                  <span className="room3d-outliner__count mono">{String(onWall.length).padStart(2, '0')}</span>
                </h3>
                {onWall.length === 0 ? (
                  <p className="room3d-outliner__empty mono">Empty</p>
                ) : (
                  <ul className="module-list room3d-outliner__list">
                    {onWall.map((item) => {
                      const product = getProduct(item.productId);
                      const finish = getFinish(item.finish);
                      return (
                        <li key={item.uid} className="room3d-outliner__row">
                          <button
                            type="button"
                            className="module-list__item"
                            data-uid={item.uid}
                            data-wall={wall}
                            data-active-wall={active || undefined}
                            data-conflict={conflicts.has(item.uid) || undefined}
                            onClick={() => onSelect(item.uid)}
                          >
                            <ProductThumbGlyph
                              product={product}
                              finish={item.finish}
                              lit={item.led !== false}
                              size="sm"
                              className="module-list__glyph"
                            />
                            <span className="module-list__name">{product.name}</span>
                            <span className="module-list__meta">
                              {WALL_LABELS[wall]} / {finish.label}
                              <span className="module-list__coords mono"> / {item.xCm}, {item.yCm}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="room3d-outliner__focus"
                            data-focus-uid={item.uid}
                            data-testid="outliner-focus"
                            aria-label="Focus in 3D"
                            title={`Focus ${product.name} in 3D`}
                            onClick={() => onFocus(item.uid)}
                          >
                            <FocusGlyph />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </PanelSection>
  );
}

const LOCK_SHORT = Object.freeze({ free: 'Free XY', x: 'Lock X', y: 'Lock Y' });

function AxisLockSelect({ value, onChange }) {
  const id = useId();
  return (
    <fieldset className="studio-segment room3d-lock" data-testid="gizmo-lock-mode" data-value={value}>
      <legend className="field__label">Axis Gizmo Lock</legend>
      <div className="studio-segment__track room3d-lock__track">
        {AXIS_LOCKS.map((lock) => (
          <label key={lock} className="studio-segment__option" title={AXIS_LOCK_LABELS[lock]}>
            <input
              type="radio"
              name={`${id}-lock`}
              value={lock}
              checked={value === lock}
              aria-label={AXIS_LOCK_LABELS[lock]}
              data-testid={`gizmo-lock-${lock}`}
              onChange={() => onChange(lock)}
            />
            <span>{LOCK_SHORT[lock]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NUDGES = Object.freeze([
  { id: 'up', label: 'up', steps: [0, 1], path: 'M8 12V4M4.5 7.5 8 4l3.5 3.5' },
  { id: 'left', label: 'left', steps: [-1, 0], path: 'M12 8H4M7.5 4.5 4 8l3.5 3.5' },
  { id: 'down', label: 'down', steps: [0, -1], path: 'M8 4v8M4.5 8.5 8 12l3.5-3.5' },
  { id: 'right', label: 'right', steps: [1, 0], path: 'M4 8h8M8.5 4.5 12 8l-3.5 3.5' },
]);

function NudgePad({ snapCm, onNudge }) {
  return (
    <div className="room3d-nudge" role="group" aria-label={`Nudge ${snapCm} cm`}>
      <span className="room3d-nudge__caption field__label">Nudge {snapCm} cm</span>
      <div className="room3d-nudge__pad">
        {NUDGES.map((nudge) => (
          <button
            key={nudge.id}
            type="button"
            className="tool-button room3d-nudge__key"
            data-dir={nudge.id}
            data-testid={`gizmo-nudge-${nudge.id}`}
            aria-label={`Nudge ${nudge.label} ${snapCm} cm`}
            onClick={() => onNudge(nudge.steps[0], nudge.steps[1])}
          >
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
              <path d={nudge.path} stroke="currentColor" strokeWidth="1.25" strokeLinecap="square" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function WallSelect({ value, onChange }) {
  const id = useId();
  return (
    <div className="field studio-field room3d-wall-field">
      <label className="field__label" htmlFor={id}>
        Mounted on
      </label>
      <select
        id={id}
        className="field__input field__select"
        value={value}
        data-testid="module-wall-select"
        onChange={(event) => onChange(event.target.value)}
      >
        {ROOM_WALLS.map((wall) => (
          <option key={wall} value={wall}>
            {WALL_LABELS[wall]}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModuleDetail({ item, state, conflict, actions, axisLock, snapCm, onAxisLock, onNudge }) {
  const product = getProduct(item.productId);
  const { room, items } = state;
  const wallId = wallOf(item);
  const wall = roomWall(room, wallId);
  const span = wallSpanCm(room, wallId);
  const { w, h, d } = product.dimsCm;
  const lit = product.watts > 0;
  const position = (x, y) => clampToWall(product, wall, Math.round(x), Math.round(y));

  return (
    <div className="studio-inspector__detail">
      <PanelSection title="Module">
        <p className="studio-inspector__name" data-testid="room-inspector-name">
          {product.name}
        </p>
        <p className="studio-inspector__meta mono" data-testid="room-inspector-dims">
          {product.sku} / W {w} x H {h} x D {d} cm
        </p>
        <p className="studio-inspector__wall" data-testid="room-inspector-wall" data-wall={wallId}>
          {WALL_LABELS[wallId]}
        </p>
        <p
          className="studio-inspector__status mono"
          data-state={conflict ? 'conflict' : 'clear'}
          data-testid="room-inspector-status"
        >
          {conflictText(conflict, items, room)}
        </p>
        <button
          type="button"
          className="tool-button room3d-inspector__focus"
          data-testid="inspector-focus"
          title={`Turn the view to the ${WALL_LABELS[wallId]}`}
          onClick={() => actions.focus(item.uid)}
        >
          <FocusGlyph />
          Focus in 3D
        </button>
      </PanelSection>

      <PanelSection title="Finish & Light">
        <FinishPicker product={product} finishId={item.finish} onChange={(finish) => actions.update(item.uid, { finish })} />
        <Switch
          label="24V LED channel"
          hint={lit ? (item.led ? 'On' : 'Off') : 'Passive'}
          checked={lit && item.led}
          disabled={!lit}
          onChange={(led) => actions.update(item.uid, { led })}
          testId="room-led-channel"
        />
        {lit && (
          <DimmingSlider
            value={sanitizeDimPct(item.dimPct)}
            onCommit={(dimPct) => actions.update(item.uid, { dimPct })}
            hint={item.led ? '' : 'Channel off / level held for the next scene'}
          />
        )}
        <p className="studio-panel__note mono" data-testid="room-module-output">
          {lit
            ? `${formatWatts(product.watts * dimFactor(item))} W / ${formatInt(Math.round(product.lumens * dimFactor(item)))} lm at ${sanitizeDimPct(item.dimPct)}% / ${product.kelvin} K / CRI ${product.cri}`
            : 'No light source / bus hardware'}
        </p>
      </PanelSection>

      <PanelSection title="Transform" className="studio-inspector__position">
        <WallSelect value={wallId} onChange={(next) => actions.update(item.uid, { wall: next })} />
        <div className="studio-fields">
          <NumberField
            label="Left X (cm)"
            value={item.xCm}
            min={0}
            max={span - w}
            normalize={(x) => position(x, item.yCm).xCm}
            onCommit={(xCm) => actions.update(item.uid, { xCm })}
            testId="room-module-x"
          />
          <NumberField
            label="Bottom Y (cm)"
            value={item.yCm}
            min={0}
            max={room.heightCm - h}
            normalize={(y) => position(item.xCm, y).yCm}
            onCommit={(yCm) => actions.update(item.uid, { yCm })}
            testId="room-module-y"
          />
        </div>
        <dl className="studio-anchors mono">
          <div className="studio-anchors__row">
            <dt>Along wall</dt>
            <dd>
              {item.xCm} - {item.xCm + w} / {span}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Height</dt>
            <dd>
              {item.yCm} - {item.yCm + h}
            </dd>
          </div>
          <div className="studio-anchors__row">
            <dt>Off wall</dt>
            <dd>0 - {d}</dd>
          </div>
        </dl>
        <AxisLockSelect value={axisLock} onChange={onAxisLock} />
        <NudgePad snapCm={snapCm} onNudge={onNudge} />
      </PanelSection>

      <PanelSection title="Actions">
        <dl className="studio-inspector__price mono">
          <div>
            <dt>Unit price</dt>
            <dd>{formatUsd(product.priceUsd)}</dd>
          </div>
        </dl>
        <div className="studio-actions">
          <button type="button" className="tool-button tool-button--danger" onClick={() => actions.remove(item.uid)}>
            Remove
          </button>
          <button type="button" className="tool-button" onClick={() => actions.select(null)}>
            Done
          </button>
        </div>
      </PanelSection>
    </div>
  );
}

export function RoomInspector({
  state,
  item,
  activeWall,
  conflicts,
  actions,
  axisLock = 'free',
  snapCm = 5,
  onAxisLock = () => {},
  onNudge = () => {},
}) {
  return (
    <aside className="studio-panel studio-inspector" aria-label="Room inspector" data-testid="room-inspector">
      {item ? (
        <ModuleDetail
          item={item}
          state={state}
          conflict={conflicts.get(item.uid)}
          actions={actions}
          axisLock={axisLock}
          snapCm={snapCm}
          onAxisLock={onAxisLock}
          onNudge={onNudge}
        />
      ) : (
        <ModuleList
          items={state.items}
          activeWall={activeWall}
          conflicts={conflicts}
          onSelect={actions.select}
          onFocus={actions.focus}
        />
      )}
    </aside>
  );
}
