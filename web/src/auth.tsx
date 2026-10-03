import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api.ts';
import type { Employee } from './types.ts';

interface AuthState {
  user: Employee | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isManager: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(!!getToken());

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (getToken()) {
      api<Employee>('/me')
        .then(setUser)
        .catch(() => setToken(null))
        .finally(() => setLoading(false));
    }
    window.addEventListener('smartassign:logout', logout);
    return () => window.removeEventListener('smartassign:logout', logout);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: Employee }>('/auth/login', { body: { email, password } });
    setToken(res.token);
    setUser(res.user);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, isManager: user?.role !== 'employee' && !!user, isAdmin: user?.role === 'admin' }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider отсутствует');
  return v;
}
