import { getFinish, PRODUCTS } from '../../data/products.js';
import { formatUsd, padIndex } from '../../lib/format.js';
import { FURNITURE, LIGHTING_MODES, ROOM_DEPTH, ROOM_HEIGHT, ROOM_WIDTH } from '../../lib/room-3d.js';
import { MAX_WALL_ITEMS } from '../../lib/wall-studio.js';
import { clampNumber } from '../../security/sanitize.js';
import { Disclosure, NumberField, PanelSection } from '../studio/controls.jsx';

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

function RoomSettings({ room, onRoom }) {
  return (
    <PanelSection index="01" title="Room">
      <Disclosure
        label="Dimensions"
        summary={`${room.widthCm} x ${room.depthCm} x ${room.heightCm} cm`}
        testId="room-dimensions"
      >
        <div className="room3d-fields">
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
        <p className="studio-panel__note mono">
          W {ROOM_WIDTH.min}-{ROOM_WIDTH.max} / D {ROOM_DEPTH.min}-{ROOM_DEPTH.max} / H {ROOM_HEIGHT.min}-
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

function ComponentList({ full, onMount }) {
  return (
    <PanelSection index="02" title="Components">
      <ul className="palette-list">
        {PRODUCTS.map((product, i) => {
          const finish = getFinish(product.defaultFinish);
          const { w, h, d } = product.dimsCm;
          return (
            <li key={product.id}>
              <button
                type="button"
                className="palette-item"
                disabled={full}
                data-product={product.id}
                aria-label={`Mount ${product.name}`}
                onClick={() => onMount(product.id)}
              >
                <span
                  className="palette-item__swatch"
                  style={{ '--swatch': finish.hex, '--swatch-hi': finish.highlight, '--swatch-lo': finish.shade }}
                  aria-hidden="true"
                />
                <span className="palette-item__body">
                  <span className="palette-item__name">{product.name}</span>
                  <span className="palette-item__meta mono">
                    {padIndex(i + 1)} / {w} x {h} x {d} cm / {product.watts} W
                  </span>
                </span>
                <span className="palette-item__price mono">{full ? 'Wall full' : formatUsd(product.priceUsd)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

export function RoomControls({ state, actions }) {
  return (
    <aside className="studio-panel room3d-controls" aria-label="Room controls">
      <RoomSettings room={state.room} onRoom={actions.setRoom} />
      <ComponentList full={state.items.length >= MAX_WALL_ITEMS} onMount={actions.mount} />
    </aside>
  );
}
