import { useCallback, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { NAV_ROUTES } from '../lib/routes.js';
import { BagDrawer } from './BagDrawer.jsx';
import { LumenMark } from './icons.jsx';
import { ModeSwitch } from './ModeSwitch.jsx';

const BAG_COUNT = 0;

export function Navbar() {
  const [bagOpen, setBagOpen] = useState(false);
  const bagTriggerRef = useRef(null);
  const closeBag = useCallback(() => setBagOpen(false), []);

  // The drawer renders outside <header>: the navbar's backdrop-filter would
  // otherwise become the containing block for its position: fixed panel.
  return (
    <>
      <header className="navbar">
        <div className="navbar__inner container">
          <Link to="/" className="navbar__brand" aria-label="Lumen overview">
            <LumenMark />
            <span className="navbar__wordmark">Lumen</span>
          </Link>

          <nav className="navbar__nav" aria-label="Primary">
            <ul className="navbar__links">
              {NAV_ROUTES.map((route) => (
                <li key={route.path}>
                  <NavLink to={route.path} end={route.path === '/'} className="navbar__link">
                    <span className="navbar__link-index">{route.index}</span>
                    <span className="navbar__link-sep" aria-hidden="true">
                      /
                    </span>
                    <span>{route.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          <div className="navbar__controls">
            <ModeSwitch />
            <button
              ref={bagTriggerRef}
              type="button"
              className="bag-trigger"
              aria-haspopup="dialog"
              aria-expanded={bagOpen}
              aria-controls="bag-drawer"
              onClick={() => setBagOpen(true)}
            >
              Bag <span className="bag-trigger__count">({BAG_COUNT})</span>
            </button>
          </div>
        </div>
      </header>

      <BagDrawer open={bagOpen} onClose={closeBag} returnFocusRef={bagTriggerRef} />
    </>
  );
}
