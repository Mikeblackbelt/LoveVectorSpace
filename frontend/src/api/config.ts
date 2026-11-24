import { Capacitor } from '@capacitor/core';

export const API_MODE: 'mock' | 'live' = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'live';

/** Absolute API origin. Empty on the web (same origin); required for native builds. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platform(): 'web' | 'android' | 'ios' {
  try {
    const p = Capacitor.getPlatform();
    return p === 'android' || p === 'ios' ? p : 'web';
  } catch {
    return 'web';
  }
}

export function apiUrl(path: string): string {
  return API_BASE + path;
}
