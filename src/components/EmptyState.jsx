import { Link } from 'react-router-dom';
import { ArrowRight } from './icons.jsx';
import '../styles/empty-state.css';

// Isometric unit cube, 44 units on edge. The hidden corner projects onto the
// front top corner at (80, 66), so the dashed back edges all leave from there.
function CubeArt() {
  return (
    <>
      <path className="empty-art__floor" d="M80 53 141 88 80 123 19 88Z" />
      <path className="empty-art__hidden" d="M80 66 42 88M80 66 118 88M80 66V22" />
      <path className="empty-art__edge" d="M80 22 118 44V88L80 110 42 88V44Z" pathLength="1" />
      <path className="empty-art__edge" d="M42 44 80 66 118 44M80 66V110" pathLength="1" />
      <path className="empty-art__accent" d="M99 66V88" />
      <path className="empty-art__dim" d="M30 44V88M27 44H33M27 88H33" />
    </>
  );
}

// Front elevation of an unfurnished wall: rail, one shelf slab, a pendant.
function ShelfArt() {
  return (
    <>
      <path className="empty-art__floor" d="M12 124H148" />
      <path className="empty-art__hidden" d="M24 18H136V124M24 18V124" />
      <path className="empty-art__edge" d="M36 72H124V77H36Z" pathLength="1" />
      <path className="empty-art__edge" d="M54 100H106V105H54Z" pathLength="1" />
      <path className="empty-art__edge" d="M110 18V44M102 44H118L114 52H106Z" pathLength="1" />
      <path className="empty-art__accent" d="M106 56H114" />
      <path className="empty-art__dim" d="M36 84H124M36 81V87M124 81V87" />
    </>
  );
}

// Unissued spec sheet: header band, ruled lines, a blank total.
function SheetArt() {
  return (
    <>
      <path className="empty-art__floor" d="M38 124H130" />
      <path className="empty-art__edge" d="M46 14H114V120H46Z" pathLength="1" />
      <path className="empty-art__edge" d="M46 32H114" pathLength="1" />
      <path className="empty-art__hidden" d="M56 46H104M56 56H104M56 66H92M56 76H104M56 86H84" />
      <path className="empty-art__accent" d="M90 104H104" />
      <path className="empty-art__dim" d="M56 22H76" />
    </>
  );
}

const ART = { cube: CubeArt, shelf: ShelfArt, sheet: SheetArt };

/**
 * Empty state: a hairline drawing, one line of copy and the next action.
 * `actions` is a list of { to, label, primary }. Pass `art={null}` for the
 * bare typographic version (the account register carries no drawings).
 */
export function EmptyState({ art = 'cube', title, body, actions = [], testId, compact = false }) {
  const Art = art === null ? null : (ART[art] ?? CubeArt);
  return (
    <div className="empty-state" data-compact={compact || undefined} data-bare={Art ? undefined : true} data-testid={testId}>
      {Art && (
        <svg className="empty-art" viewBox="0 0 160 136" fill="none" aria-hidden="true" focusable="false">
          <Art />
        </svg>
      )}
      <div className="empty-state__copy">
        <p className="empty-state__title">{title}</p>
        {body && <p className="empty-state__body mono">{body}</p>}
      </div>
      {actions.length > 0 && (
        <div className="empty-state__actions">
          {actions.map(({ to, label, primary }) => (
            <Link key={to} to={to} className={primary ? 'button button--primary' : 'button'}>
              {label}
              {primary && <ArrowRight />}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
