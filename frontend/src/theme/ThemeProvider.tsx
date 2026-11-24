import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { settingsApi } from '../api/endpoints';
import { useSession } from '../api/session';
import type { ThemeName, ThemeSetting } from '../api/types';
import { applyNativeTheme } from '../native/native';
import {
  DEFAULT_PREFS, THEMES, hasPendingPrefs, isTheme, setPendingPrefs, loadLocalPrefs, nextTheme, resolveTheme, saveLocalPrefs, type ThemePrefs,
} from './themes';

interface ThemeCtx {
  /** the theme on screen right now (preview wins over the saved choice) */
  theme: ThemeName;
  /** the saved setting, may be "auto" */
  setting: ThemeSetting;
  prefs: ThemePrefs;
  journal: boolean;
  reducedMotion: boolean;
  setTheme: (t: ThemeSetting) => void;
  cycle: () => ThemeName;
  update: (p: Partial<ThemePrefs>) => void;
  setPreview: (t: ThemeName | null) => void;
  popoverOpen: boolean;
  setPopoverOpen: (v: boolean) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

function mq(q: string): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches;
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const [prefs, setPrefs] = useState<ThemePrefs>(() => loadLocalPrefs());
  const [preview, setPreview] = useState<ThemeName | null>(null);
  const [prefersLight, setPrefersLight] = useState(() => mq('(prefers-color-scheme: light)'));
  const [systemReduce, setSystemReduce] = useState(() => mq('(prefers-reduced-motion: reduce)'));
  const [now, setNow] = useState(() => new Date());
  const [popoverOpen, setPopoverOpen] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const touched = useRef(false);

  // system appearance + reduced motion listeners
  useEffect(() => {
    if (!window.matchMedia) return;
    const a = window.matchMedia('(prefers-color-scheme: light)');
    const b = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fa = () => setPrefersLight(a.matches);
    const fb = () => setSystemReduce(b.matches);
    a.addEventListener?.('change', fa);
    b.addEventListener?.('change', fb);
    return () => {
      a.removeEventListener?.('change', fa);
      b.removeEventListener?.('change', fb);
    };
  }, []);

  // time-of-day AUTO re-evaluates every minute
  useEffect(() => {
    if (prefs.theme !== 'auto' || prefs.auto_theme.mode !== 'time') return;
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, [prefs.theme, prefs.auto_theme.mode]);

  // pull the server copy once per signed-in user (localStorage is only the fast path)
  useEffect(() => {
    if (session.status !== 'authed') return;
    if (loadedFor.current === session.user.id) return;
    loadedFor.current = session.user.id;
    settingsApi
      .get()
      .then((s) => {
        // a choice made while loading, or while signed out (pending flag), wins over the server copy
        if (hasPendingPrefs()) {
          const { theme, auto_theme, reduce_motion, contrast_boost, text_size } = loadLocalPrefs();
          settingsApi.put({ theme, auto_theme, reduce_motion, contrast_boost, text_size }).then(() => setPendingPrefs(false), () => undefined);
          return;
        }
        if (touched.current) return;
        const next: ThemePrefs = {
          theme: s.theme === 'auto' || isTheme(s.theme) ? s.theme : DEFAULT_PREFS.theme,
          auto_theme: { ...DEFAULT_PREFS.auto_theme, ...s.auto_theme },
          reduce_motion: !!s.reduce_motion,
          contrast_boost: !!s.contrast_boost,
          text_size: s.text_size || 'm',
        };
        setPrefs(next);
        saveLocalPrefs(next);
      })
      .catch(() => {
        /* keep local prefs */
      });
  }, [session]);

  const authed = session.status === 'authed';
  const update = useCallback(
    (p: Partial<ThemePrefs>) => {
      touched.current = true;
      setPrefs((old) => {
        const next = { ...old, ...p, auto_theme: { ...old.auto_theme, ...(p.auto_theme || {}) } };
        saveLocalPrefs(next);
        return next;
      });
      if (authed) settingsApi.put(p).catch(() => setPendingPrefs(true));
      else setPendingPrefs(true);
    },
    [authed],
  );

  const resolved = resolveTheme(prefs.theme, prefs.auto_theme, { prefersLight, now });
  const theme = preview ?? resolved;
  const reducedMotion = prefs.reduce_motion || systemReduce;

  const setTheme = useCallback((t: ThemeSetting) => update({ theme: t }), [update]);
  const cycle = useCallback(() => {
    const n = nextTheme(resolved);
    update({ theme: n });
    return n;
  }, [resolved, update]);

  // reflect on <html>/<body> (background behind the app, overscroll) and native chrome
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-app-theme', theme);
    el.style.colorScheme = THEMES.includes(theme) && (theme === 'riso' || theme === 'journal') ? 'light' : 'dark';
    const root = document.querySelector<HTMLElement>('.lvs');
    if (root) {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      if (bg) {
        document.body.style.background = bg;
        el.style.background = bg;
        void applyNativeTheme(bg, theme === 'riso' || theme === 'journal');
      }
    }
  }, [theme, prefs.contrast_boost]);

  const value = useMemo<ThemeCtx>(
    () => ({
      theme, setting: prefs.theme, prefs, journal: theme === 'journal', reducedMotion,
      setTheme, cycle, update, setPreview, popoverOpen, setPopoverOpen,
    }),
    [theme, prefs, reducedMotion, setTheme, cycle, update, popoverOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside ThemeProvider');
  return c;
}

/** Root attributes for the single app root <div class="lvs">. */
export function useRootAttrs() {
  const { theme, prefs, reducedMotion } = useTheme();
  return {
    'data-theme': theme,
    'data-motion': reducedMotion ? 'reduce' : 'full',
    'data-contrast': prefs.contrast_boost ? 'boost' : 'normal',
    'data-text-size': prefs.text_size,
  } as const;
}
