import type { AutoTheme, Settings, ThemeName, ThemeSetting } from '../api/types';

/** Cycle order from the design system: signal → pulse → riso → blueprint → journal → matcha → midnight → inkwell → crt. */
export const THEMES: ThemeName[] = ['signal', 'pulse', 'riso', 'blueprint', 'journal', 'matcha', 'midnight', 'inkwell', 'crt'];

export const THEME_META: Record<ThemeName, { label: string; blurb: string; plain: string; light: boolean }> = {
  signal: { label: 'SIGNAL', blurb: 'swiss print · default', plain: 'Print', light: false },
  pulse: { label: 'PULSE', blurb: 'neon night · pink', plain: 'Neon', light: false },
  riso: { label: 'RISO', blurb: 'zine · playful', plain: 'Zine', light: true },
  blueprint: { label: 'BLUEPRINT', blurb: 'drawing · technical', plain: 'Blueprint', light: false },
  journal: { label: 'JOURNAL', blurb: 'notebook · plain language', plain: 'Notebook', light: true },
  matcha: { label: 'MATCHA', blurb: 'tea house · calm', plain: 'Calm', light: true },
  midnight: { label: 'MIDNIGHT', blurb: 'navy + gold · refined', plain: 'Night sky', light: false },
  inkwell: { label: 'INKWELL', blurb: 'high contrast · accessible', plain: 'High contrast', light: true },
  crt: { label: 'CRT', blurb: 'amber phosphor · retro', plain: 'Retro', light: false },
};

export function isTheme(v: unknown): v is ThemeName {
  return typeof v === 'string' && (THEMES as string[]).includes(v);
}

export function nextTheme(t: ThemeName): ThemeName {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
}

export const DEFAULT_AUTO: AutoTheme = { mode: 'system', day: 'journal', night: 'signal', day_start: '07:00', day_end: '19:00' };

export type Motion = 'full' | 'gentle' | 'off';
export const MOTIONS: Motion[] = ['full', 'gentle', 'off'];

export type ThemePrefs = Pick<Settings, 'theme' | 'auto_theme' | 'reduce_motion' | 'contrast_boost' | 'text_size'>;

export const DEFAULT_PREFS: ThemePrefs = {
  theme: 'signal',
  auto_theme: DEFAULT_AUTO,
  reduce_motion: false,
  contrast_boost: false,
  text_size: 'm',
};

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Resolve an AUTO setting to a concrete theme for a given moment and system scheme. */
export function resolveTheme(setting: ThemeSetting, auto: AutoTheme, opts: { prefersLight: boolean; now: Date }): ThemeName {
  if (setting !== 'auto') return isTheme(setting) ? setting : 'signal';
  if (auto.mode === 'system') return opts.prefersLight ? auto.day : auto.night;
  const t = opts.now.getHours() * 60 + opts.now.getMinutes();
  const a = minutes(auto.day_start);
  const b = minutes(auto.day_end);
  const isDay = a <= b ? t >= a && t < b : t >= a || t < b;
  return isDay ? auto.day : auto.night;
}

const LS_KEY = 'lvs.prefs';

export function loadLocalPrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<ThemePrefs>;
    return {
      theme: p.theme === 'auto' || isTheme(p.theme) ? p.theme : 'signal',
      auto_theme: { ...DEFAULT_AUTO, ...(p.auto_theme || {}) },
      reduce_motion: !!p.reduce_motion,
      contrast_boost: !!p.contrast_boost,
      text_size: p.text_size === 's' || p.text_size === 'l' ? p.text_size : 'm',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveLocalPrefs(p: ThemePrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the server copy still persists */
  }
}

const PENDING_KEY = 'lvs.prefs.pending';
/** Set when prefs changed while signed out (or a PUT failed): pushed to the server on next sign-in. */
export function setPendingPrefs(v: boolean): void {
  try {
    if (v) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
export function hasPendingPrefs(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

// Motion: Full / Gentle / Off, stored as `lvs-motion`. An explicit choice always wins;
// otherwise Gentle when the OS asks for reduced motion, the account asks for it, or the theme is inkwell.
const MOTION_KEY = 'lvs-motion';
export function loadMotion(): Motion | null {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    return v === 'full' || v === 'gentle' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}
export function saveMotion(m: Motion | null): void {
  try {
    if (m) localStorage.setItem(MOTION_KEY, m);
    else localStorage.removeItem(MOTION_KEY);
  } catch {
    /* ignore */
  }
}
export function resolveMotion(explicit: Motion | null, o: { osReduce: boolean; accountReduce: boolean; theme: ThemeName }): Motion {
  if (explicit) return explicit;
  return o.osReduce || o.accountReduce || o.theme === 'inkwell' ? 'gentle' : 'full';
}
