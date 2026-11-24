// In-memory fakes of the native capture plugins, for tests. Not imported by app code.
// FakeCapture mirrors the native rules: owner-checked drain, native consent for enable/link,
// E.164 SMS links, clearAll/bindOwner wipes.
import type { CaptureEnv, CaptureStatus, LvsCapturePlugin, LvsOcrPlugin, OcrPluginResult, QueuedCapture } from '../../native/capture';
import { contactKey } from './links';
import type { CaptureLink, ReaderMethod } from './types';

const NATIVE_CONSENT_VERSION = 1;

/** Fake E.164 normaliser (US numbering for national numbers). */
export function fakeE164(raw: string): string | null {
  const t = raw.trim();
  if (/[A-Za-z]/.test(t)) return /^(?=.*[A-Za-z])[A-Za-z0-9 ._&-]{2,11}$/.test(t) ? t : null;
  const d = t.replace(/\D/g, '');
  let e: string;
  if (t.startsWith('+')) e = '+' + d;
  else if (d.length === 10) e = '+1' + d;
  else if (d.length === 11 && d.startsWith('1')) e = '+' + d;
  else return null;
  return /^\+[1-9]\d{6,14}$/.test(e) ? e : null;
}

export class FakeCapture implements LvsCapturePlugin {
  owner: string | null = 'user-1';
  consent: Record<ReaderMethod, number> = { notify: 0, sms: 0, a11y: 0 };
  links: CaptureLink[] = [];
  queue: QueuedCapture[] = [];
  enabled: Record<ReaderMethod, boolean> = { notify: false, sms: false, a11y: false };
  granted: Record<ReaderMethod, boolean> = { notify: false, sms: false, a11y: false };
  supported: Record<ReaderMethod, boolean> = { notify: true, sms: true, a11y: true };
  notificationsGranted = true;
  droppedForCap = 0;
  paused = false;
  calls: string[] = [];
  smsToQueue: QueuedCapture[] = [];

  /** Test helper: agree to a reader natively. */
  agree(...ms: ReaderMethod[]) {
    ms.forEach((m) => (this.consent[m] = NATIVE_CONSENT_VERSION));
    return this;
  }

  private snapshot(): CaptureStatus {
    const m = (k: ReaderMethod) => ({ supported: this.supported[k], enabled: this.enabled[k], granted: this.granted[k] });
    return {
      methods: { notify: m('notify'), sms: m('sms'), a11y: m('a11y') },
      paused: this.paused,
      pausedReason: this.paused ? 'user' : null,
      queued: this.queue.length,
      notificationsGranted: this.notificationsGranted,
      signedIn: this.owner != null,
      consent: { ...this.consent },
      consentVersion: NATIVE_CONSENT_VERSION,
      droppedForCap: this.droppedForCap,
    };
  }
  async status() {
    return this.snapshot();
  }
  async getLinks() {
    return { links: [...this.links] };
  }
  async setLinks(o: { links: CaptureLink[] }) {
    this.calls.push('setLinks');
    const accepted: CaptureLink[] = [];
    const rejected: CaptureLink[] = [];
    for (const l of o.links) {
      if (!this.owner || this.consent[l.method] < NATIVE_CONSENT_VERSION) {
        rejected.push(l);
        continue;
      }
      if (l.method === 'sms') {
        const c = fakeE164(l.contact);
        if (!c) rejected.push(l);
        else accepted.push({ ...l, contact: c });
      } else accepted.push(l);
    }
    const gone = this.links.filter((x) => !accepted.some((a) => contactKey(a) === contactKey(x)));
    this.queue = this.queue.filter((q) => !gone.some((g) => contactKey(g) === q.ck));
    this.links = accepted;
    return { links: [...accepted], rejected };
  }
  async setConsent(o: { method: ReaderMethod; version: number }) {
    this.calls.push(`setConsent:${o.method}:${o.version}`);
    if (!this.owner && o.version > 0) throw new Error('Sign in first');
    this.consent[o.method] = o.version;
    if (o.version <= 0) {
      this.enabled[o.method] = false;
      this.links = this.links.filter((l) => l.method !== o.method);
    }
    return this.snapshot();
  }
  async bindOwner(o: { userId: string }) {
    this.calls.push(`bindOwner:${o.userId}`);
    if (this.owner === o.userId) return { result: 'same' as const };
    const had = this.owner != null;
    this.wipe();
    this.owner = o.userId;
    return { result: had ? ('reset' as const) : ('bound' as const) };
  }
  private wipe() {
    this.owner = null;
    this.consent = { notify: 0, sms: 0, a11y: 0 };
    this.links = [];
    this.queue = [];
    this.enabled = { notify: false, sms: false, a11y: false };
    this.paused = false;
  }
  async clearAll() {
    this.calls.push('clearAll');
    this.wipe();
  }
  async normalizePhone(o: { number: string }) {
    const c = fakeE164(o.number);
    return { canonical: c, alphanumeric: !!c && /[A-Za-z]/.test(c) };
  }
  async setEnabled(o: { method: ReaderMethod; enabled: boolean }) {
    this.calls.push(`setEnabled:${o.method}:${o.enabled}`);
    if (o.enabled && (!this.owner || this.consent[o.method] < NATIVE_CONSENT_VERSION)) throw new Error('Consent is required');
    this.enabled[o.method] = o.enabled;
    return this.snapshot();
  }
  async setPaused(o: { paused: boolean }) {
    this.calls.push(`setPaused:${o.paused}`);
    this.paused = o.paused;
    return this.snapshot();
  }
  async openSystemSettings(o: { method: ReaderMethod | 'app' }) {
    this.calls.push(`openSystemSettings:${o.method}`);
  }
  async requestPermissions(o?: { permissions: ('sms' | 'notifications')[] }) {
    this.calls.push(`requestPermissions:${(o?.permissions || []).join(',')}`);
    if (o?.permissions.includes('sms')) this.granted.sms = true;
    if (o?.permissions.includes('notifications')) this.notificationsGranted = true;
    return { sms: 'granted' as const, notifications: 'granted' as const };
  }
  async syncSms() {
    this.calls.push('syncSms');
    const n = this.smsToQueue.length;
    this.queue.push(...this.smsToQueue);
    this.smsToQueue = [];
    return { queued: n };
  }
  async drain(o: { max: number; userId: string }) {
    if (!this.owner || this.owner !== o.userId) throw new Error('The capture queue belongs to a different or signed-out account');
    return { items: this.queue.slice(0, o.max).map((x) => ({ ...x })) };
  }
  async ack(o: { ids: string[] }) {
    const before = this.queue.length;
    this.queue = this.queue.filter((x) => !o.ids.includes(x.id));
    return { removed: before - this.queue.length };
  }
  async deleteContact(o: { method: ReaderMethod; app: string; contact: string }) {
    this.calls.push(`deleteContact:${o.method}:${o.app}:${o.contact}`);
    const ck = contactKey({ method: o.method, app: o.app as CaptureLink['app'], contact: o.contact });
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => q.ck !== ck);
    return { removed: before - this.queue.length };
  }
}

export class FakeOcr implements LvsOcrPlugin {
  results: OcrPluginResult[] = [];
  calls = 0;
  async recognize() {
    const r = this.results[this.calls % Math.max(1, this.results.length)];
    this.calls++;
    return r;
  }
}

export function fakeEnv(o: {
  platform?: 'web' | 'android' | 'ios';
  plugins?: string[];
  capture?: LvsCapturePlugin;
  ocr?: LvsOcrPlugin;
}): CaptureEnv {
  const capture = o.capture ?? new FakeCapture();
  const ocr = o.ocr ?? new FakeOcr();
  return {
    platform: () => o.platform ?? 'android',
    isPluginAvailable: (n) => (o.plugins ?? ['LvsOcr', 'LvsCapture']).includes(n),
    capture: () => capture,
    ocr: () => ocr,
  };
}

let seq = 0;
export function queued(p: Partial<QueuedCapture> = {}): QueuedCapture {
  seq++;
  return {
    id: `q${seq}`,
    pid: 1,
    source: 'android_notify_whatsapp',
    tz: 'UTC',
    role: 'them',
    text: `message ${seq}`,
    ts_utc: `2026-11-18T10:${String(seq % 60).padStart(2, '0')}:00Z`,
    ts_precision: 'second',
    ck: 'notify|whatsapp|sam',
    ...p,
  };
}
