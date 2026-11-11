import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { closeSession, openSession } from '../api/client.js';
import {
  createSession,
  loadSession,
  loadSessionToken,
  persistSession,
  persistSessionToken,
  SESSION_STORAGE_KEY,
  validateCredentials,
} from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadSession);

  // Writing on mount also drops a tampered session payload, and its token with it.
  useEffect(() => {
    persistSession(user);
    if (!user) persistSessionToken(null);
  }, [user]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== null && !event.key.endsWith(SESSION_STORAGE_KEY)) return;
      setUser(loadSession());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /**
   * Validates locally, then opens a signed session on the Lumen Cloud API.
   * When the API is unreachable the visitor still gets a device-only guest
   * session, so the account shell keeps working offline.
   */
  const signIn = useCallback(async ({ email, password }) => {
    const errors = validateCredentials({ email, password });
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    let session;
    try {
      session = await openSession({ email, password });
    } catch (error) {
      return { ok: false, errors: { email: error?.name === 'ApiError' ? error.message : 'Sign-in failed. Try again.' } };
    }
    const next = session?.user ?? createSession(email);
    persistSessionToken(session?.token ?? null);
    setUser(next);
    return { ok: true, user: next, errors: {}, offline: !session, claimed: session?.claimed ?? null };
  }, []);

  const signOut = useCallback(() => {
    const token = loadSessionToken();
    persistSessionToken(null);
    setUser(null);
    if (token) closeSession(token);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be called inside <AuthProvider>.');
  return auth;
}

/** Route guard: signed-out visitors land on the overview. */
export function RequireAuth({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/" replace />;
}
