import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { NAV_ROUTES } from '../lib/routes.js';
import { AuthModal } from './AuthModal.jsx';
import { BagDrawer } from './BagDrawer.jsx';
import { LumenMark } from './icons.jsx';
import { ModeSwitch } from './ModeSwitch.jsx';

export function Navbar() {
  const { count } = useBag();
  const { open: bagOpen, returnFocus, openBag, closeBag } = useBagDrawer();
  const bagTriggerRef = useRef(null);
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const signInRef = useRef(null);
  const accountRef = useRef(null);
  const focusAccount = useRef(false);

  const closeAuth = useCallback(() => setAuthOpen(false), []);
  const onSignedIn = useCallback(() => {
    focusAccount.current = true;
    setAuthOpen(false);
  }, []);

  // The Sign In trigger unmounts on success, so focus lands on its successor.
  useEffect(() => {
    if (user && focusAccount.current) {
      focusAccount.current = false;
      accountRef.current?.focus();
    }
  }, [user]);

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
            {user ? (
              <NavLink
                ref={accountRef}
                to="/account"
                className="account-trigger"
                data-testid="account-link"
                title={`Signed in as ${user.email}`}
              >
                Account
              </NavLink>
            ) : (
              <button
                ref={signInRef}
                type="button"
                className="account-trigger"
                aria-haspopup="dialog"
                aria-expanded={authOpen}
                data-testid="sign-in"
                onClick={() => setAuthOpen(true)}
              >
                Sign In
              </button>
            )}
            <button
              ref={bagTriggerRef}
              type="button"
              className="bag-trigger"
              aria-haspopup="dialog"
              aria-expanded={bagOpen}
              aria-controls="bag-drawer"
              onClick={() => openBag(bagTriggerRef.current)}
            >
              Bag <span className="bag-trigger__count">({count})</span>
            </button>
          </div>
        </div>
      </header>

      <BagDrawer open={bagOpen} onClose={closeBag} returnFocus={returnFocus} />
      <AuthModal open={authOpen} onClose={closeAuth} onSignedIn={onSignedIn} returnFocus={signInRef.current} />
    </>
  );
}
