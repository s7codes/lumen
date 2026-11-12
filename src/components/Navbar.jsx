import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useBag, useBagDrawer } from '../hooks/useBag.js';
import { useCommandPalette } from '../hooks/useCommandPalette.js';
import { useCurrentSection, useSectionLink } from '../hooks/useSectionLink.js';
import { prefetchRoute } from '../lib/route-manifest.js';
import { NAV_ROUTES } from '../lib/routes.js';
import { AuthModal } from './AuthModal.jsx';
import { BagDrawer } from './BagDrawer.jsx';
import { CommandPalette, PALETTE_SHORTCUT_LABEL } from './CommandPalette.jsx';
import { LumenMark, SearchGlyph } from './icons.jsx';
import { ModeSwitch } from './ModeSwitch.jsx';

function linkClass(current) {
  return current ? 'navbar__link active' : 'navbar__link';
}

/**
 * A primary link into an overview section: glides there, reads as the page
 * inside its workspace and as the location while the overview is scrolled
 * through its section.
 */
function SectionNavLink({ route, section }) {
  const { pathname } = useLocation();
  const onClick = useSectionLink(route.hash);
  const warm = () => prefetchRoute(route.prefetch);
  let current;
  if (pathname === route.activePath) current = 'page';
  else if (pathname === '/' && section === route.hash) current = 'location';
  return (
    <Link
      to={route.path}
      className={linkClass(current)}
      aria-current={current}
      data-testid={route.testId}
      onClick={onClick}
      onPointerEnter={warm}
      onFocus={warm}
    >
      {route.label}
    </Link>
  );
}

/** Overview stays current on the overview until the reader scrolls into a spied section. */
function OverviewNavLink({ route, section }) {
  const { pathname } = useLocation();
  const current = pathname === '/' && !section ? 'page' : undefined;
  const warm = () => prefetchRoute(route.path);
  return (
    <Link to="/" className={linkClass(current)} aria-current={current} onPointerEnter={warm} onFocus={warm}>
      {route.label}
    </Link>
  );
}

export function Navbar() {
  const section = useCurrentSection();
  const { count } = useBag();
  const { open: bagOpen, returnFocus, openBag, closeBag } = useBagDrawer();
  const bagTriggerRef = useRef(null);
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const signInRef = useRef(null);
  const accountRef = useRef(null);
  const focusAccount = useRef(false);
  const { open: paletteOpen, openPalette } = useCommandPalette();
  const paletteTriggerRef = useRef(null);

  const closeAuth = useCallback(() => setAuthOpen(false), []);
  const openAuth = useCallback(() => setAuthOpen(true), []);
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
                  {route.hash ? (
                    <SectionNavLink route={route} section={section} />
                  ) : route.path === '/' ? (
                    <OverviewNavLink route={route} section={section} />
                  ) : (
                    <NavLink
                      to={route.path}
                      className="navbar__link"
                      onPointerEnter={() => prefetchRoute(route.path)}
                      onFocus={() => prefetchRoute(route.path)}
                    >
                      {route.label}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <div className="navbar__controls">
            <button
              ref={paletteTriggerRef}
              type="button"
              className="palette-trigger"
              aria-label="Search commands"
              aria-haspopup="dialog"
              aria-expanded={paletteOpen}
              aria-keyshortcuts="Control+K Meta+K"
              data-testid="command-palette-trigger"
              title={`Search (${PALETTE_SHORTCUT_LABEL})`}
              onClick={() => openPalette(paletteTriggerRef.current)}
            >
              <SearchGlyph />
              <span className="palette-trigger__label">Search</span>
            </button>
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
              Cart <span className="bag-trigger__count">({count})</span>
            </button>
          </div>
        </div>
      </header>

      <BagDrawer open={bagOpen} onClose={closeBag} returnFocus={returnFocus} />
      <AuthModal open={authOpen} onClose={closeAuth} onSignedIn={onSignedIn} returnFocus={signInRef.current} />
      <CommandPalette onSignIn={openAuth} />
    </>
  );
}
