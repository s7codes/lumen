import { LIGHTING_SCENES } from '../lib/lighting-scenes.js';

/** DALI-2 scene recall: one press sets every powered channel and the surface mode as one undo step. */
export function LightingSceneBar({ active, disabled = false, onApply, className = '' }) {
  return (
    <div
      className={`studio-toolbar__group scene-bar ${className}`.trim()}
      role="group"
      aria-label="DALI-2 lighting scenes"
      data-testid="lighting-scene-bar"
      data-active-scene={active ?? 'custom'}
    >
      <span className="scene-bar__label mono" aria-hidden="true">
        DALI-2
      </span>
      {LIGHTING_SCENES.map((scene) => (
        <button
          key={scene.id}
          type="button"
          className="tool-button scene-bar__button"
          aria-pressed={active === scene.id}
          aria-label={scene.label}
          title={`${scene.label}: task ${scene.task}% / accent ${scene.accent}%`}
          disabled={disabled}
          data-testid={`scene-preset-${scene.id}`}
          onClick={() => onApply(scene.id)}
        >
          {scene.short}
        </button>
      ))}
    </div>
  );
}
