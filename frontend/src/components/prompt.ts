import { useSyncExternalStore } from 'react';

// The terminal prompt line at the bottom of every screen echoes what the user did.
let line = { cmd: '', out: '', n: 0 };
const subs = new Set<() => void>();

export function say(cmd: string, out = ''): void {
  line = { cmd, out, n: line.n + 1 };
  subs.forEach((f) => f());
}

export function usePromptLine() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => line,
    () => line,
  );
}

const PID_KEY = 'lvs.lastPerson';
export function rememberPerson(pid: number): void {
  try {
    localStorage.setItem(PID_KEY, String(pid));
  } catch {
    /* ignore */
  }
}
export function lastPerson(): number | null {
  try {
    const v = Number(localStorage.getItem(PID_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
