import { useSyncExternalStore } from 'react';
import { isOffline, onSession, refreshOutcome } from './client';
import type { User } from './types';

export type SessionState =
  | { status: 'unknown'; user: null }
  | { status: 'authed'; user: User }
  | { status: 'anon'; user: null }
  /** cold start could not reach the server; the refresh credential is kept for a retry */
  | { status: 'offline'; user: null };

let state: SessionState = { status: 'unknown', user: null };
let offline = false;
const subs = new Set<() => void>();
const offSubs = new Set<() => void>();

function set(s: SessionState) {
  state = s;
  subs.forEach((f) => f());
}

onSession((e) => {
  if (e.type === 'authed') set({ status: 'authed', user: e.user });
  else if (e.type === 'logged_out') set({ status: 'anon', user: null });
  else {
    offline = e.type === 'offline';
    offSubs.forEach((f) => f());
  }
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

/** True while the API is unreachable (network error / 5xx). Used for the offline banner. */
export function useOffline(): boolean {
  return useSyncExternalStore(
    (f) => {
      offSubs.add(f);
      return () => offSubs.delete(f);
    },
    () => offline || isOffline(),
    () => offline,
  );
}

let booting: Promise<void> | null = null;
/**
 * Cold start: try the refresh credential once (web cookie / native secure storage).
 * A rejection means signed out; an unreachable server means "offline" — never a logout.
 */
export function bootstrapSession(): Promise<void> {
  if (!booting) {
    booting = refreshOutcome().then((o) => {
      if (o.kind === 'denied') set({ status: 'anon', user: null });
      else if (o.kind === 'offline') set({ status: 'offline', user: null });
    });
  }
  return booting;
}

/** Offline screen "Try again". */
export function retryBootstrap(): Promise<void> {
  booting = null;
  set({ status: 'unknown', user: null });
  return bootstrapSession();
}

/** Tests only. */
export function resetSessionForTests(): void {
  booting = null;
  offline = false;
  state = { status: 'unknown', user: null };
}
