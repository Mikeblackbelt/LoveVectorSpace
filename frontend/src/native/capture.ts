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
  notificationsGranted: boolean;
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
}

export interface LvsCapturePlugin {
  status(): Promise<CaptureStatus>;
  getLinks(): Promise<{ links: CaptureLink[] }>;
  setLinks(o: { links: CaptureLink[] }): Promise<void>;
  setEnabled(o: { method: ReaderMethod; enabled: boolean }): Promise<CaptureStatus>;
  setPaused(o: { paused: boolean }): Promise<CaptureStatus>;
  /** Open the system screen where the user grants access (notification access, accessibility, app info). */
  openSystemSettings(o: { method: ReaderMethod | 'app' }): Promise<void>;
  requestPermissions(o?: { permissions: ('sms' | 'notifications')[] }): Promise<Partial<Record<'sms' | 'notifications', PermissionState>>>;
  /** Read new SMS/MMS text for linked numbers into the queue. */
  syncSms(): Promise<{ queued: number }>;
  /** Oldest queued messages, decrypted, without removing them. */
  drain(o: { max: number }): Promise<{ items: QueuedCapture[] }>;
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
