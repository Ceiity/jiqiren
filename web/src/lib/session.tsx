import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, get, put, setUnauthorizedHandler } from './api';
import type { Preferences, PublicConfig, User } from './types';
import { setShareBase } from '../features/actions';

export const DEFAULT_PREFS: Preferences = {
  themeMode: 'system',
  accentColor: '#007AFF',
  colorStyle: 'vivid',
  motion: 'full',
  density: 'comfortable',
  defaultView: 'grid',
  sidebarExpanded: true,
  uploadConcurrency: 3,
  chunkSizeMB: 8,
  uploadRetries: 3,
  defaultUploadFolderId: null,
  downloadBehavior: 'preview',
  zipMultiple: true,
  shareDefaultExpire: '7d',
  shareDefaultAllowDownload: true,
  shareDefaultPassword: 'none',
};

const LS_PREFS = 'nl_prefs';

function loadLocalPrefs(): Preferences {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(LS_PREFS) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface MeResponse {
  user: User;
  preferences: Preferences;
  csrf: string;
}

interface SessionCtx {
  config: PublicConfig | undefined;
  user: User | null;
  loading: boolean;
  prefs: Preferences;
  updatePrefs: (patch: Partial<Preferences>) => void;
  setSession: (r: MeResponse) => void;
  logout: () => Promise<void>;
  refreshMe: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Preferences>(loadLocalPrefs);
  const config = useQuery({ queryKey: ['public-config'], queryFn: () => get<PublicConfig>('/api/public/config'), staleTime: 60_000 });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await get<MeResponse>('/api/me');
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
    retry: 1,
  });

  // server prefs win on login
  const serverPrefs = me.data?.preferences;
  useEffect(() => {
    if (serverPrefs) {
      setPrefs({ ...DEFAULT_PREFS, ...serverPrefs });
      localStorage.setItem(LS_PREFS, JSON.stringify(serverPrefs));
    }
  }, [serverPrefs]);

  useEffect(() => {
    setShareBase(config.data?.publicUrl ?? '');
    if (config.data?.siteName) document.title = config.data.siteName;
  }, [config.data]);

  useEffect(() => {
    setUnauthorizedHandler(() => qc.setQueryData(['me'], null));
  }, [qc]);

  const pending = useRef<Partial<Preferences>>({});
  const timer = useRef<number>();
  const loggedIn = !!me.data?.user;
  const updatePrefs = useCallback(
    (patch: Partial<Preferences>) => {
      setPrefs((p) => {
        const next = { ...p, ...patch };
        try {
          localStorage.setItem(LS_PREFS, JSON.stringify(next));
        } catch {
          /* quota */
        }
        return next;
      });
      if (!loggedIn) return;
      pending.current = { ...pending.current, ...patch };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const body = pending.current;
        pending.current = {};
        put<Preferences>('/api/me/preferences', body)
          .then((saved) => qc.setQueryData<MeResponse | null>(['me'], (old) => (old ? { ...old, preferences: saved } : old)))
          .catch(() => {});
      }, 400);
    },
    [loggedIn, qc],
  );

  const setSession = useCallback((r: MeResponse) => qc.setQueryData(['me'], r), [qc]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
    qc.clear();
    qc.setQueryData(['me'], null);
  }, [qc]);

  const value = useMemo<SessionCtx>(
    () => ({
      config: config.data,
      user: me.data?.user ?? null,
      loading: me.isLoading || config.isLoading,
      prefs,
      updatePrefs,
      setSession,
      logout,
      refreshMe: () => qc.invalidateQueries({ queryKey: ['me'] }),
    }),
    [config.data, me.data, me.isLoading, config.isLoading, prefs, updatePrefs, setSession, logout, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

export const usePrefs = () => {
  const { prefs, updatePrefs } = useSession();
  return [prefs, updatePrefs] as const;
};

export function useUser(): User {
  const { user } = useSession();
  if (!user) throw new Error('not logged in');
  return user;
}
