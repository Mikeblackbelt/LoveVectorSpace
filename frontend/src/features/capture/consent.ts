// Consent gating for the Android readers. Each reader is off until the user has read its
// explanation and agreed (stored per method, versioned so a changed explanation asks again),
// then switched it on, and then granted the OS access it needs.
import type { Capabilities } from './capabilities';
import type { ReaderMethod } from './types';

export const CONSENT_VERSION = 1;

export interface ConsentStore {
  get(method: ReaderMethod): boolean;
  set(method: ReaderMethod, agreed: boolean): void;
}

const key = (m: ReaderMethod) => `lvs_capture_consent_${m}`;

export const localConsent: ConsentStore = {
  get(m) {
    try {
      return localStorage.getItem(key(m)) === String(CONSENT_VERSION);
    } catch {
      return false;
    }
  },
  set(m, agreed) {
    try {
      if (agreed) localStorage.setItem(key(m), String(CONSENT_VERSION));
      else localStorage.removeItem(key(m));
    } catch {
      /* storage unavailable: consent will be asked again */
    }
  },
};

export type GateState =
  | 'unsupported' // not in this build
  | 'needs_consent' // explanation not yet agreed
  | 'off' // agreed but switched off
  | 'needs_access' // on, but the OS permission / service is not granted
  | 'paused' // on and granted, globally paused
  | 'active';

export function gateState(method: ReaderMethod, caps: Capabilities, consented: boolean): GateState {
  if (!caps[method] || !caps.status) return 'unsupported';
  if (!consented) return 'needs_consent';
  const s = caps.status.methods[method];
  if (!s.enabled) return 'off';
  if (!s.granted) return 'needs_access';
  if (caps.status.paused || s.idle) return 'paused';
  return 'active';
}

/** May the app switch this reader on right now? Only after consent, and only if supported. */
export function canEnable(method: ReaderMethod, caps: Capabilities, consented: boolean): boolean {
  const g = gateState(method, caps, consented);
  return g !== 'unsupported' && g !== 'needs_consent';
}
