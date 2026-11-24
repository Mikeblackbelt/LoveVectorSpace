// Bridges to the app's own Capacitor plugins for phone capture.
//
//   LvsOcr      on-device text recognition (Android: ML Kit, iOS: Apple Vision). Both flavours.
//   LvsCapture  Android sideload flavour only: notification / SMS / accessibility readers,
//               linked contacts and the encrypted local queue. Absent from the store flavour,
//               so Capacitor.isPluginAvailable('LvsCapture') doubles as flavour detection.
//
// Plugins are registered lazily and every access goes through captureEnv(), which tests replace
// with fakes via setCaptureEnv().
import { Capacitor, registerPlugin, type PermissionState } from '@capacitor/core';
import type { CaptureLink, ReaderMethod, Role, TsPrecision } from '../features/capture/types';

export interface OcrPluginLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrPluginResult {
  width: number;
  height: number;
  blocks: { text: string; lines: OcrPluginLine[] }[];
}
export interface LvsOcrPlugin {
  /** Recognise text in a base64-encoded image (no data: prefix). The image is not stored. */
  recognize(o: { base64: string }): Promise<OcrPluginResult>;
}

export interface MethodStatus {
  supported: boolean;
  /** User switched it on in the app. */
  enabled: boolean;
  /** OS access granted (notification access, READ_SMS, accessibility service on). */
  granted: boolean;
  /** a11y only: auto-paused after 30 minutes without a linked chat (setPaused(false) resumes). */
  idle?: boolean;
}

export interface CaptureStatus {
  methods: Record<ReaderMethod, MethodStatus>;
  paused: boolean;
  pausedReason: 'user' | 'idle' | null;
  queued: number;
  /** The "capturing" notification can be shown. Readers are inactive natively without it. */
  notificationsGranted: boolean;
  /** A signed-in account owns the capture state (bindOwner). Nothing runs while false. */
  signedIn: boolean;
  /** Native consent version agreed per reader (0 = none). Enforced natively. */
  consent: Record<ReaderMethod, number>;
  /** Consent version the native side requires. */
  consentVersion: number;
  /** Messages dropped because the encrypted queue was full. */
  droppedForCap: number;
}

/** One message waiting in the native encrypted queue. */
export interface QueuedCapture {
  id: string;
  pid: number;
  source: string;
  tz: string;
  role: Role;
  text: string;
  ts_utc?: string;
  ts_local?: string;
  ts_precision: TsPrecision;
  /** Opaque contact key (method|app|normalised contact), for cancelling a contact's in-flight batch. */
  ck: string;
}

export interface LvsCapturePlugin {
  status(): Promise<CaptureStatus>;
  getLinks(): Promise<{ links: CaptureLink[] }>;
  /** Native validates: links need native consent; SMS numbers are stored as E.164. Returns what it refused. */
  setLinks(o: { links: CaptureLink[] }): Promise<{ links: CaptureLink[]; rejected: CaptureLink[] }>;
  /** Record consent (version) or withdraw it (0: reader off, its links removed). */
  setConsent(o: { method: ReaderMethod; version: number }): Promise<CaptureStatus>;
  /** Bind capture to the signed-in account; a different account's state is wiped first. */
  bindOwner(o: { userId: string }): Promise<{ result: 'bound' | 'same' | 'reset' }>;
  /** Sign-out / account deletion: forget everything, including the owner. */
  clearAll(): Promise<void>;
  /** Canonical form the SMS reader would store (E.164 or exact alphanumeric sender), or none. */
  normalizePhone(o: { number: string }): Promise<{ canonical?: string | null; alphanumeric: boolean }>;
  setEnabled(o: { method: ReaderMethod; enabled: boolean }): Promise<CaptureStatus>;
  setPaused(o: { paused: boolean }): Promise<CaptureStatus>;
  /** Open the system screen where the user grants access (notification access, accessibility, app info). */
  openSystemSettings(o: { method: ReaderMethod | 'app' }): Promise<void>;
  requestPermissions(o?: { permissions: ('sms' | 'notifications')[] }): Promise<Partial<Record<'sms' | 'notifications', PermissionState>>>;
  /** Read new SMS/MMS text for linked numbers into the queue. */
  syncSms(): Promise<{ queued: number }>;
  /** Oldest queued messages, decrypted, without removing them. Rejects unless userId owns the queue. */
  drain(o: { max: number; userId: string }): Promise<{ items: QueuedCapture[] }>;
  /** Remove uploaded (or permanently rejected) messages. */
  ack(o: { ids: string[] }): Promise<{ removed: number }>;
  /** Purge everything queued or remembered for one linked contact. */
  deleteContact(o: { method: ReaderMethod; app: string; contact: string }): Promise<{ removed: number }>;
}

export interface CaptureEnv {
  platform(): 'web' | 'android' | 'ios';
  isPluginAvailable(name: string): boolean;
  ocr(): LvsOcrPlugin;
  capture(): LvsCapturePlugin;
}

let ocrPlugin: LvsOcrPlugin | null = null;
let capturePlugin: LvsCapturePlugin | null = null;

const realEnv: CaptureEnv = {
  platform() {
    try {
      const p = Capacitor.getPlatform();
      return p === 'android' || p === 'ios' ? p : 'web';
    } catch {
      return 'web';
    }
  },
  isPluginAvailable(name) {
    try {
      return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name);
    } catch {
      return false;
    }
  },
  ocr() {
    return (ocrPlugin ??= registerPlugin<LvsOcrPlugin>('LvsOcr'));
  },
  capture() {
    return (capturePlugin ??= registerPlugin<LvsCapturePlugin>('LvsCapture'));
  },
};

let override: CaptureEnv | null = null;

/** Tests inject fake plugins here; pass null to restore the real ones. */
export function setCaptureEnv(e: CaptureEnv | null): void {
  override = e;
}

export function captureEnv(): CaptureEnv {
  return override ?? realEnv;
}
