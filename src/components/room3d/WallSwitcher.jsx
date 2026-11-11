import { ROOM_WALLS, WALL_LABELS } from '../../lib/room-3d.js';
import { PlanWallGlyph } from '../icons.jsx';

/**
 * Active wall selector for the four-wall room. The pressed tab is the wall
 * the camera faces and the one new parts mount on; each tab carries the
 * number of modules hung on it.
 */
export function WallSwitcher({ active, counts, onChange }) {
  return (
    <div className="room3d-walls" role="group" aria-label="Active wall" data-testid="active-wall-switcher" data-active-wall={active}>
      {ROOM_WALLS.map((wall) => {
        const count = counts[wall] ?? 0;
        return (
          <button
            key={wall}
            type="button"
            className="room3d-walls__tab"
            aria-pressed={active === wall}
            aria-label={`${WALL_LABELS[wall]}, ${count} ${count === 1 ? 'module' : 'modules'}`}
            data-testid={`wall-tab-${wall}`}
            data-wall={wall}
            data-count={count}
            onClick={() => onChange(wall)}
          >
            <PlanWallGlyph wall={wall} />
            <span className="room3d-walls__label">{WALL_LABELS[wall]}</span>
            <span className="room3d-walls__badge" data-testid={`wall-count-${wall}`} data-empty={count === 0 || undefined}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
