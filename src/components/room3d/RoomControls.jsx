import { PRODUCTS } from '../../data/products.js';
import { formatUsd } from '../../lib/format.js';
import {
  FURNITURE,
  LIGHTING_MODES,
  ROOM_DEPTH,
  ROOM_HEIGHT,
  ROOM_SIZE_PRESETS,
  ROOM_WIDTH,
  roomSizePreset,
  WALL_LABELS,
} from '../../lib/room-3d.js';
import { MAX_WALL_ITEMS } from '../../lib/wall-studio.js';
import { clampNumber } from '../../security/sanitize.js';
import { Disclosure, NumberField, PaletteItem, PanelSection } from '../studio/controls.jsx';

function dimension(range) {
  return (value) => clampNumber(Math.round(value), range.min, range.max, range.initial);
}

function Segment({ legend, name, options, value, onChange, columns = 2 }) {
  return (
    <fieldset className="studio-segment room3d-segment">
      <legend className="field__label">{legend}</legend>
      <div className="studio-segment__track" data-columns={columns}>
        {options.map((option) => (
          <label key={option.id} className="studio-segment__option">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** One press sets width, depth and ceiling together; an edited envelope leaves every pill up. */
function ScalePresets({ room, onRoom }) {
  const active = roomSizePreset(room);
  return (
    <div className="room3d-scale" role="group" aria-labelledby="room-scale-label" data-testid="room-size-presets">
      <p id="room-scale-label" className="field__label">
        Room scale
      </p>
      <div className="room3d-scale__track">
        {ROOM_SIZE_PRESETS.map(({ id, label, widthCm, depthCm, heightCm }) => (
          <button
            key={id}
            type="button"
            className="room3d-scale__pill"
            aria-pressed={active === id}
            data-testid={`room-preset-${id}`}
            onClick={() => onRoom({ widthCm, depthCm, heightCm })}
          >
            <span className="room3d-scale__name">{label}</span>
            <span className="room3d-scale__dims mono">
              {widthCm} x {depthCm} x {heightCm}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoomSettings({ room, onRoom }) {
  return (
    <PanelSection title="Envelope & Lighting">
      <ScalePresets room={room} onRoom={onRoom} />
      <Disclosure
        label="Dimensions"
        summary={`${room.widthCm} x ${room.depthCm} x ${room.heightCm} cm`}
        testId="room-dimensions"
      >
        <div className="room3d-fields dimension-fields">
          <NumberField
            label="Width (cm)"
            value={room.widthCm}
            min={ROOM_WIDTH.min}
            max={ROOM_WIDTH.max}
            normalize={dimension(ROOM_WIDTH)}
            onCommit={(widthCm) => onRoom({ widthCm })}
            testId="room-width"
          />
          <NumberField
            label="Depth (cm)"
            value={room.depthCm}
            min={ROOM_DEPTH.min}
            max={ROOM_DEPTH.max}
            normalize={dimension(ROOM_DEPTH)}
            onCommit={(depthCm) => onRoom({ depthCm })}
            testId="room-depth"
          />
          <NumberField
            label="Ceiling (cm)"
            value={room.heightCm}
            min={ROOM_HEIGHT.min}
            max={ROOM_HEIGHT.max}
            normalize={dimension(ROOM_HEIGHT)}
            onCommit={(heightCm) => onRoom({ heightCm })}
            testId="room-height"
          />
        </div>
        <p className="studio-panel__note">
          Width {ROOM_WIDTH.min}-{ROOM_WIDTH.max}, depth {ROOM_DEPTH.min}-{ROOM_DEPTH.max}, ceiling {ROOM_HEIGHT.min}-
          {ROOM_HEIGHT.max} cm
        </p>
      </Disclosure>

      <Segment
        legend="Lighting"
        name="room-lighting"
        options={LIGHTING_MODES}
        value={room.lighting}
        onChange={(lighting) => onRoom({ lighting })}
      />
      <Segment
        legend="Floor reference"
        name="room-furniture"
        options={FURNITURE}
        value={room.furniture}
        onChange={(furniture) => onRoom({ furniture })}
      />
    </PanelSection>
  );
}

function ComponentList({ full, wallLabel, onMount }) {
  return (
    <PanelSection title="Asset Shelf" hint={`One click mounts a part on the ${wallLabel}.`}>
      <ul className="palette-list" data-testid="room-palette" data-target-wall={wallLabel}>
        {PRODUCTS.map((product) => (
          <li key={product.id}>
            <PaletteItem
              product={product}
              note={full ? 'Room full' : formatUsd(product.priceUsd)}
              disabled={full}
              withDepth
              onMount={onMount}
            />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

export function RoomControls({ state, activeWall, actions }) {
  return (
    <aside className="studio-panel room3d-controls" aria-label="Room controls">
      <RoomSettings room={state.room} onRoom={actions.setRoom} />
      <ComponentList
        full={state.items.length >= MAX_WALL_ITEMS}
        wallLabel={WALL_LABELS[activeWall]}
        onMount={actions.mount}
      />
    </aside>
  );
}
