import { useSyncExternalStore } from 'react';
import { onSession, refreshOnce } from './client';
import type { User } from './types';

export type SessionState =
  | { status: 'unknown'; user: null }
  | { status: 'authed'; user: User }
  | { status: 'anon'; user: null };

let state: SessionState = { status: 'unknown', user: null };
const subs = new Set<() => void>();

function set(s: SessionState) {
  state = s;
  subs.forEach((f) => f());
}

onSession((e) => {
  if (e.type === 'authed') set({ status: 'authed', user: e.user });
  else set({ status: 'anon', user: null });
});

export function getSession(): SessionState {
  return state;
}

export function setUser(user: User): void {
  set({ status: 'authed', user });
}

export function useSession(): SessionState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}

let booting: Promise<void> | null = null;
/** Cold start: try the refresh credential once (web cookie / native secure storage). */
export function bootstrapSession(): Promise<void> {
  if (!booting) {
    booting = refreshOnce().then((r) => {
      if (!r) set({ status: 'anon', user: null });
    });
  }
  return booting;
}

/** Tests only. */
export function resetSessionForTests(): void {
  booting = null;
  state = { status: 'unknown', user: null };
}
