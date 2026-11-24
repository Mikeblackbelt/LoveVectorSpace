import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { ImportResult } from '../../api/types';
import { importMessages, SOURCE_RE, sourceFor } from './api';
import { detectCapabilities, NO_CAPS } from './capabilities';
import { canEnable, gateState, localConsent } from './consent';
import { normContact, removeLink, upsertLink, validateLink } from './links';
import { toOcrImage } from './ocr';
import { flushQueue } from './queue';
import { fakeEnv, FakeCapture, queued } from './testing';
import type { ImportMessagesBody } from './types';

const OK: ImportResult = { unit_id: 'u', added: 1, merged: 0, skipped_non_english: 0, one_sided: true, job_id: 1 };

describe('flushQueue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('groups by person+source+tz, posts, and acks only after success', async () => {
    const cap = new FakeCapture();
    cap.queue = [
      queued({ pid: 1, source: 'android_notify_whatsapp' }),
      queued({ pid: 1, source: 'android_notify_whatsapp' }),
      queued({ pid: 2, source: 'android_sms', role: 'me', ts_utc: undefined, ts_local: '2026-11-18T09:00:00', ts_precision: 'approx' }),
    ];
    const calls: [number, ImportMessagesBody][] = [];
    const r = await flushQueue(cap, async (pid, body) => {
      calls.push([pid, body]);
      return OK;
    });
    expect(r).toMatchObject({ uploaded: 3, imports: 2, dropped: 0, kept: 0 });
    expect(cap.queue).toEqual([]);
    expect(calls.map(([p, b]) => [p, b.source, b.messages.length])).toEqual([[1, 'android_notify_whatsapp', 2], [2, 'android_sms', 1]]);
    expect(calls[1][1].messages[0]).toEqual({ ts_local: '2026-11-18T09:00:00', ts_precision: 'approx', role: 'me', text: expect.any(String) });
    expect(calls[0][1].messages[0]).not.toHaveProperty('ts_local');
  });

  it('keeps everything queued on a transient failure (offline / 401 / 5xx)', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued(), queued()];
    const r = await flushQueue(cap, async () => {
      throw new ApiError(503, 'unavailable', 'down');
    });
    expect(r).toMatchObject({ uploaded: 0, kept: 2, error: 'down' });
    expect(cap.queue).toHaveLength(2);
    const r2 = await flushQueue(cap, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(r2.kept).toBe(2);
    expect(cap.queue).toHaveLength(2);
  });

  it('drops permanently rejected batches (400/404) and blank text so the queue never jams', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued({ pid: 9 }), queued({ pid: 1, text: '   ' }), queued({ pid: 1 })];
    const r = await flushQueue(cap, async (pid) => {
      if (pid === 9) throw new ApiError(404, 'not_found', 'person');
      return OK;
    });
    expect(r).toMatchObject({ uploaded: 1, dropped: 2 });
    expect(cap.queue).toEqual([]);
  });

  it('drains in batches until empty, and concurrent calls share one run', async () => {
    const cap = new FakeCapture();
    cap.queue = Array.from({ length: 7 }, () => queued());
    const up = vi.fn(async () => OK);
    const [a, b] = await Promise.all([flushQueue(cap, up, { batch: 3 }), flushQueue(cap, up, { batch: 3 })]);
    expect(a).toBe(b);
    expect(a.uploaded).toBe(7);
    expect(up).toHaveBeenCalledTimes(3);
  });
});

describe('importMessages', () => {
  it('validates the source like the server', async () => {
    expect(SOURCE_RE.test('screenshot_import')).toBe(true);
    expect(SOURCE_RE.test(sourceFor('a11y', 'google_messages'))).toBe(true);
    expect(sourceFor('sms', 'sms')).toBe('android_sms');
    expect(sourceFor('notify', 'tinder')).toBe('android_notify_tinder');
    expect(SOURCE_RE.test('android_notify_')).toBe(false);
    await expect(importMessages(1, { source: 'evil', tz: 'UTC', messages: [] })).rejects.toThrow(/Unknown capture source/);
  });
});

describe('detectCapabilities (flavour detection)', () => {
  it('web has nothing', async () => {
    expect(await detectCapabilities(fakeEnv({ platform: 'web' }))).toEqual(NO_CAPS);
  });
  it('iOS: screenshot import only', async () => {
    const c = await detectCapabilities(fakeEnv({ platform: 'ios', plugins: ['LvsOcr'] }));
    expect(c).toMatchObject({ flavour: 'ios', screenshot: true, notify: false, sms: false, a11y: false });
  });
  it('Android store flavour: no LvsCapture plugin, readers hidden', async () => {
    const c = await detectCapabilities(fakeEnv({ plugins: ['LvsOcr'] }));
    expect(c).toMatchObject({ flavour: 'store', screenshot: true, notify: false, sms: false, a11y: false, status: null });
  });
  it('Android sideload flavour: readers the plugin reports as supported', async () => {
    const cap = new FakeCapture();
    cap.supported.sms = false;
    const c = await detectCapabilities(fakeEnv({ capture: cap }));
    expect(c).toMatchObject({ flavour: 'sideload', screenshot: true, notify: true, sms: false, a11y: true });
  });
  it('a failing status() hides the readers instead of crashing', async () => {
    const cap = new FakeCapture();
    cap.status = async () => {
      throw new Error('boom');
    };
    expect(await detectCapabilities(fakeEnv({ capture: cap }))).toMatchObject({ flavour: 'sideload', notify: false, a11y: false });
  });
});

describe('consent gating', () => {
  it('walks unsupported -> needs_consent -> off -> needs_access -> active/paused', async () => {
    const cap = new FakeCapture();
    const caps = async () => detectCapabilities(fakeEnv({ capture: cap }));
    expect(gateState('a11y', NO_CAPS, true)).toBe('unsupported');
    expect(gateState('a11y', await caps(), false)).toBe('needs_consent');
    expect(canEnable('a11y', await caps(), false)).toBe(false);
    expect(gateState('a11y', await caps(), true)).toBe('off');
    expect(canEnable('a11y', await caps(), true)).toBe(true);
    cap.enabled.a11y = true;
    expect(gateState('a11y', await caps(), true)).toBe('needs_access');
    cap.granted.a11y = true;
    expect(gateState('a11y', await caps(), true)).toBe('active');
    cap.paused = true;
    expect(gateState('a11y', await caps(), true)).toBe('paused');
  });
  it('consent is stored per method and versioned', () => {
    expect(localConsent.get('a11y')).toBe(false);
    localConsent.set('a11y', true);
    expect(localConsent.get('a11y')).toBe(true);
    expect(localConsent.get('notify')).toBe(false);
    localStorage.setItem('lvs_capture_consent_sms', '0');
    expect(localConsent.get('sms')).toBe(false);
    localConsent.set('a11y', false);
    expect(localConsent.get('a11y')).toBe(false);
  });
});

describe('links', () => {
  it('normalises, validates and upserts', () => {
    expect(normContact('sms', ' +1 (555) 010-2030 ')).toBe('+15550102030');
    expect(normContact('notify', '  Sam   R ')).toBe('Sam R');
    expect(validateLink({ method: 'sms', app: 'sms', contact: '123', pid: 1 })).toMatch(/phone/);
    expect(validateLink({ method: 'a11y', app: 'hinge', contact: ' ', pid: 1 })).toMatch(/chat name/);
    expect(validateLink({ method: 'a11y', app: 'hinge', contact: 'Sam', pid: 0 })).toMatch(/person/);
    expect(validateLink({ method: 'notify', app: 'tinder', contact: 'Sam', pid: 3 })).toBeNull();
    let ls = upsertLink([], { method: 'notify', app: 'tinder', contact: 'Sam', pid: 1 });
    ls = upsertLink(ls, { method: 'notify', app: 'tinder', contact: ' sam ', pid: 2 });
    ls = upsertLink(ls, { method: 'notify', app: 'whatsapp', contact: 'Sam', pid: 1 });
    expect(ls).toEqual([
      { method: 'notify', app: 'tinder', contact: 'sam', pid: 2 },
      { method: 'notify', app: 'whatsapp', contact: 'Sam', pid: 1 },
    ]);
    expect(removeLink(ls, { method: 'notify', app: 'tinder', contact: 'SAM', pid: 0 })).toHaveLength(1);
  });
});

describe('toOcrImage', () => {
  it('flattens blocks to lines and drops empty boxes', () => {
    expect(toOcrImage({
      width: 10, height: 20,
      blocks: [{ text: 'a b', lines: [{ text: 'a', x: 0, y: 0, w: 1, h: 1 }, { text: '', x: 0, y: 0, w: 1, h: 1 }] },
        { text: 'c', lines: [{ text: 'c', x: 0, y: 0, w: 0, h: 1 }] }],
    })).toEqual({ width: 10, height: 20, lines: [{ text: 'a', x: 0, y: 0, w: 1, h: 1 }] });
  });
});
