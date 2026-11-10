import { getFinish, PRODUCTS } from '../../data/products.js';
import { WALL_PRESETS } from '../../data/wall-presets.js';
import { formatUsd, padIndex } from '../../lib/format.js';
import { MAX_WALL_ITEMS, productFits, SLOPE_CM, WALL_HEIGHT, WALL_WIDTH } from '../../lib/wall-studio.js';
import { clampNumber } from '../../security/sanitize.js';
import { Disclosure, NumberField, PanelSection, Switch } from './controls.jsx';

const SURFACE_OPTIONS = [
  { id: 'ambient', label: 'Ambient Dark' },
  { id: 'daylight', label: 'Daylight Elevation' },
];

function dimension(range) {
  return (value) => clampNumber(Math.round(value), range.min, range.max, range.initial);
}

function WallSettings({ wall, onWall }) {
  return (
    <PanelSection index="01" title="Wall">
      <Disclosure label="Dimensions" summary={`${wall.widthCm} x ${wall.heightCm} cm`} testId="wall-dimensions">
        <div className="studio-fields">
          <NumberField
            label="Width (cm)"
            value={wall.widthCm}
            min={WALL_WIDTH.min}
            max={WALL_WIDTH.max}
            normalize={dimension(WALL_WIDTH)}
            onCommit={(widthCm) => onWall({ widthCm })}
            testId="wall-width"
          />
          <NumberField
            label="Height (cm)"
            value={wall.heightCm}
            min={WALL_HEIGHT.min}
            max={WALL_HEIGHT.max}
            normalize={dimension(WALL_HEIGHT)}
            onCommit={(heightCm) => onWall({ heightCm })}
            testId="wall-height"
          />
        </div>
        <p className="studio-panel__note mono">
          W {WALL_WIDTH.min}-{WALL_WIDTH.max} / H {WALL_HEIGHT.min}-{WALL_HEIGHT.max} cm
        </p>
      </Disclosure>

      <div className="studio-switches">
        <Switch label="Grid snap" hint="5 cm" checked={wall.snap} onChange={(snap) => onWall({ snap })} />
        <Switch
          label="Attic slope"
          hint={`${SLOPE_CM} x ${SLOPE_CM} cm`}
          checked={wall.slope}
          onChange={(slope) => onWall({ slope })}
        />
      </div>

      <fieldset className="studio-segment">
        <legend className="field__label">Surface</legend>
        <div className="studio-segment__track">
          {SURFACE_OPTIONS.map((option) => (
            <label key={option.id} className="studio-segment__option">
              <input
                type="radio"
                name="wall-surface"
                value={option.id}
                checked={wall.surface === option.id}
                onChange={() => onWall({ surface: option.id })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </PanelSection>
  );
}

function ComponentList({ wall, full, onMount }) {
  return (
    <PanelSection index="02" title="Components">
      <ul className="palette-list">
        {PRODUCTS.map((product, i) => {
          const finish = getFinish(product.defaultFinish);
          const fits = productFits(product, wall);
          const blocked = !fits || full;
          let note = formatUsd(product.priceUsd);
          if (!fits) note = 'Exceeds wall';
          else if (full) note = 'Wall full';
          return (
            <li key={product.id}>
              <button
                type="button"
                className="palette-item"
                disabled={blocked}
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
                    {padIndex(i + 1)} / {product.dimsCm.w} x {product.dimsCm.h} cm / {product.watts} W
                  </span>
                </span>
                <span className="palette-item__price mono">{note}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </PanelSection>
  );
}

function PresetList({ onPreset }) {
  return (
    <PanelSection index="03" title="Presets">
      <ul className="preset-list">
        {WALL_PRESETS.map((preset) => (
          <li key={preset.id}>
            <button
              type="button"
              className="preset-item"
              data-preset={preset.id}
              aria-label={`Load preset ${preset.name}`}
              onClick={() => onPreset(preset.id)}
            >
              <span className="preset-item__name">{preset.name}</span>
              <span className="preset-item__meta mono">
                {preset.items.length} modules / {preset.wall.widthCm} x {preset.wall.heightCm} cm
                {preset.wall.slope ? ' / slope' : ''}
              </span>
              <span className="preset-item__summary">{preset.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

export function StudioPalette({ layout, actions }) {
  return (
    <aside className="studio-panel studio-palette" aria-label="Studio palette">
      <WallSettings wall={layout.wall} onWall={actions.setWall} />
      <ComponentList wall={layout.wall} full={layout.items.length >= MAX_WALL_ITEMS} onMount={actions.mount} />
      <PresetList onPreset={actions.loadPreset} />
    </aside>
  );
}
