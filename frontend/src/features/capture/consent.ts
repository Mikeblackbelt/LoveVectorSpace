// Consent gating for the Android readers. The source of truth is NATIVE: the plugin stores the
// agreed consent version per reader and refuses setEnabled(true)/setLinks without it, and the
// services check it too. The JS mirror below only exists so sign-out can clear it as well.
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
      /* storage unavailable */
    }
  },
};

export function clearLocalConsents(): void {
  (['notify', 'sms', 'a11y'] as ReaderMethod[]).forEach((m) => localConsent.set(m, false));
}

/** Has the user agreed to this reader's current explanation (native record)? */
export function nativeConsented(method: ReaderMethod, caps: Capabilities): boolean {
  const s = caps.status;
  if (!s) return false;
  return (s.consent?.[method] ?? 0) >= (s.consentVersion ?? CONSENT_VERSION);
}

export type GateState =
  | 'unsupported' // not in this build
  | 'needs_consent' // explanation not yet agreed (natively)
  | 'off' // agreed but switched off
  | 'needs_access' // on, but the OS permission / service is not granted
  | 'needs_notifications' // on and granted, but the "capturing" notification can't be shown: inactive
  | 'paused' // globally paused, or the chat reader's idle pause
  | 'active';

export function gateState(method: ReaderMethod, caps: Capabilities): GateState {
  if (!caps[method] || !caps.status) return 'unsupported';
  const s = caps.status.methods[method];
  if (!nativeConsented(method, caps)) return 'needs_consent';
  if (!s.enabled) return 'off';
  if (!s.granted) return 'needs_access';
  if (!caps.status.notificationsGranted) return 'needs_notifications';
  if (caps.status.paused || s.idle) return 'paused';
  return 'active';
}

/** May the app switch this reader on right now? Only after native consent, and only if supported. */
export function canEnable(method: ReaderMethod, caps: Capabilities): boolean {
  const g = gateState(method, caps);
  return g !== 'unsupported' && g !== 'needs_consent';
}
