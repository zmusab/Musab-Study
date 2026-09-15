import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '@/types';
import { getProfile, saveProfile } from '@/data/repositories/profile';

/**
 * Thème clair / sombre / système.
 *
 * La préférence est persistée avec le profil, mais appliquée AVANT tout accès
 * à IndexedDB via un miroir dans `localStorage` (voir index.html) : sans cela,
 * l'application s'afficherait en clair pendant quelques images avant de
 * basculer en sombre — un « flash » très visible la nuit.
 */

const STORAGE_KEY = 'musab-study:theme';

interface ThemeContextValue {
  preference: ThemePreference;
  /** Thème réellement appliqué une fois « système » résolu. */
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme doit être utilisé dans un <ThemeProvider>');
  return context;
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Navigation privée : on retombe simplement sur « système ».
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Le mode « système » doit suivre les changements en direct (bascule
  // automatique jour/nuit d'iOS pendant une session de révision du soir).
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // Charge la préférence enregistrée dans le profil au démarrage.
  useEffect(() => {
    let cancelled = false;
    void getProfile().then((profile) => {
      if (!cancelled) setPreferenceState(profile.theme);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved: 'light' | 'dark' =
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    // Aligne la barre d'état iOS en mode application installée.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#121417' : '#f6f5f2');
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sans localStorage, on perd seulement l'anti-flash au démarrage.
    }
    void saveProfile({ theme: next });
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
