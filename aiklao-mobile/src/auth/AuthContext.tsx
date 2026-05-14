import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { tokenStorage, StoredUser } from './tokenStorage';
import { lineLogin } from './lineLogin';
import { api } from '@/api/client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: StoredUser | null;
  signInWithLine: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<StoredUser | null>(null);

  // Restore session on app start
  useEffect(() => {
    (async () => {
      const jwt = await tokenStorage.getJwt();
      const storedUser = await tokenStorage.getUser();
      if (jwt && storedUser) {
        setUser(storedUser);
        setStatus('authenticated');
      } else {
        setStatus('unauthenticated');
      }
    })();
  }, []);

  const signInWithLine = useCallback(async () => {
    setStatus('loading');
    try {
      // 1. Run LINE OAuth → get id_token
      const { idToken } = await lineLogin();
      if (!idToken) throw new Error('LINE login cancelled');

      // 2. Exchange id_token → backend JWT
      const { data } = await api.post('/api/mobile/auth', { idToken });
      // Expected shape: { token, refreshToken?, user: {...} }

      await tokenStorage.setJwt(data.token);
      if (data.refreshToken) {
        await tokenStorage.setRefresh(data.refreshToken);
      }
      await tokenStorage.setUser(data.user);

      setUser(data.user);
      setStatus('authenticated');
    } catch (err) {
      console.warn('[auth] sign-in failed', err);
      setStatus('unauthenticated');
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    await tokenStorage.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, signInWithLine, signOut }),
    [status, user, signInWithLine, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
