import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { createSession, loadSession, persistSession, SESSION_STORAGE_KEY, validateCredentials } from '../lib/auth.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadSession);

  // Writing on mount also drops a tampered session payload.
  useEffect(() => {
    persistSession(user);
  }, [user]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== null && !event.key.endsWith(SESSION_STORAGE_KEY)) return;
      setUser(loadSession());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const signIn = useCallback(({ email, password }) => {
    const errors = validateCredentials({ email, password });
    const session = Object.keys(errors).length === 0 ? createSession(email) : null;
    if (!session) return { ok: false, errors };
    setUser(session);
    return { ok: true, user: session, errors: {} };
  }, []);

  const signOut = useCallback(() => setUser(null), []);

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
