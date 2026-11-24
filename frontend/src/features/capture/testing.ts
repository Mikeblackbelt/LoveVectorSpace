// In-memory fakes of the native capture plugins, for tests. Not imported by app code.
import type { CaptureEnv, CaptureStatus, LvsCapturePlugin, LvsOcrPlugin, OcrPluginResult, QueuedCapture } from '../../native/capture';
import type { CaptureLink, ReaderMethod } from './types';

export class FakeCapture implements LvsCapturePlugin {
  links: CaptureLink[] = [];
  queue: QueuedCapture[] = [];
  enabled: Record<ReaderMethod, boolean> = { notify: false, sms: false, a11y: false };
  granted: Record<ReaderMethod, boolean> = { notify: false, sms: false, a11y: false };
  supported: Record<ReaderMethod, boolean> = { notify: true, sms: true, a11y: true };
  paused = false;
  calls: string[] = [];
  smsToQueue: QueuedCapture[] = [];

  private snapshot(): CaptureStatus {
    const m = (k: ReaderMethod) => ({ supported: this.supported[k], enabled: this.enabled[k], granted: this.granted[k] });
    return {
      methods: { notify: m('notify'), sms: m('sms'), a11y: m('a11y') },
      paused: this.paused,
      pausedReason: this.paused ? 'user' : null,
      queued: this.queue.length,
      notificationsGranted: true,
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
    this.links = [...o.links];
  }
  async setEnabled(o: { method: ReaderMethod; enabled: boolean }) {
    this.calls.push(`setEnabled:${o.method}:${o.enabled}`);
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
    return { sms: 'granted' as const };
  }
  async syncSms() {
    this.calls.push('syncSms');
    const n = this.smsToQueue.length;
    this.queue.push(...this.smsToQueue);
    this.smsToQueue = [];
    return { queued: n };
  }
  async drain(o: { max: number }) {
    return { items: this.queue.slice(0, o.max).map((x) => ({ ...x })) };
  }
  async ack(o: { ids: string[] }) {
    const before = this.queue.length;
    this.queue = this.queue.filter((x) => !o.ids.includes(x.id));
    return { removed: before - this.queue.length };
  }
  async deleteContact(o: { method: ReaderMethod; app: string; contact: string }) {
    this.calls.push(`deleteContact:${o.method}:${o.app}:${o.contact}`);
    return { removed: 0 };
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
    ...p,
  };
}
