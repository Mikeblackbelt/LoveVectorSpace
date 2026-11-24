import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { ImportResult } from '../../api/types';
import config from '../../../capacitor.config';
import { importMessages, SOURCE_RE, sourceFor } from './api';
import { bytesOf, MAX_TEXT, splitBatches, truncateText } from './batches';
import { detectCapabilities, NO_CAPS } from './capabilities';
import { canEnable, gateState, localConsent, nativeConsented } from './consent';
import { contactKey, normContact, normName, removeLink, upsertLink, validateLink } from './links';
import { toOcrImage } from './ocr';
import { cancelContactUploads, flushQueue } from './queue';
import { fakeEnv, FakeCapture, queued } from './testing';
import type { ImportMessagesBody } from './types';

const OK: ImportResult = { unit_id: 'u', added: 1, merged: 0, skipped_non_english: 0, one_sided: true, job_id: 1 };
const U = 'user-1';

describe('capacitor config', () => {
  it('turns bridge logging off on both platforms (no plugin data in logs)', () => {
    expect(config.loggingBehavior).toBe('none');
    expect(config.android?.loggingBehavior).toBe('none');
    expect(config.ios?.loggingBehavior).toBe('none');
  });
});

describe('flushQueue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('groups by person+source+tz+contact, posts, and acks only after success', async () => {
    const cap = new FakeCapture();
    cap.queue = [
      queued({ pid: 1, source: 'android_notify_whatsapp' }),
      queued({ pid: 1, source: 'android_notify_whatsapp' }),
      queued({ pid: 2, source: 'android_sms', role: 'me', ts_utc: undefined, ts_local: '2026-11-18T09:00:00', ts_precision: 'approx', ck: 'sms|sms|+15550102030' }),
    ];
    const calls: [number, ImportMessagesBody][] = [];
    const r = await flushQueue(cap, U, async (pid, body) => {
      calls.push([pid, body]);
      return OK;
    });
    expect(r).toMatchObject({ uploaded: 3, imports: 2, dropped: 0, kept: 0 });
    expect(cap.queue).toEqual([]);
    expect(calls.map(([p, b]) => [p, b.source, b.messages.length])).toEqual([[1, 'android_notify_whatsapp', 2], [2, 'android_sms', 1]]);
    expect(calls[1][1].messages[0]).toEqual({ ts_local: '2026-11-18T09:00:00', ts_precision: 'approx', role: 'me', text: expect.any(String) });
    expect(calls[0][1].messages[0]).not.toHaveProperty('ts_local');
  });

  it('refuses to drain for a different or signed-out account', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued()];
    const up = vi.fn(async () => OK);
    const r = await flushQueue(cap, 'someone-else', up);
    expect(r.error).toMatch(/different or signed-out/);
    expect(up).not.toHaveBeenCalled();
    expect(cap.queue).toHaveLength(1);
    cap.owner = null;
    expect((await flushQueue(cap, U, up)).uploaded).toBe(0);
  });

  it('keeps everything queued on a transient failure (offline / 401 / 5xx)', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued(), queued()];
    const r = await flushQueue(cap, U, async () => {
      throw new ApiError(503, 'unavailable', 'down');
    });
    expect(r).toMatchObject({ uploaded: 0, kept: 2, error: 'down' });
    expect(cap.queue).toHaveLength(2);
    const r2 = await flushQueue(cap, U, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(r2.kept).toBe(2);
    expect(cap.queue).toHaveLength(2);
  });

  it('drops a batch for a deleted person (404) and blank text', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued({ pid: 9 }), queued({ pid: 1, text: '   ' }), queued({ pid: 1 })];
    const r = await flushQueue(cap, U, async (pid) => {
      if (pid === 9) throw new ApiError(404, 'not_found', 'person');
      return OK;
    });
    expect(r).toMatchObject({ uploaded: 1, dropped: 2 });
    expect(cap.queue).toEqual([]);
  });

  it('422 isolates only the bad message instead of dropping the batch', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued({ text: 'a' }), queued({ text: 'BAD' }), queued({ text: 'c' }), queued({ text: 'd' })];
    const sent: string[] = [];
    const r = await flushQueue(cap, U, async (_pid, body) => {
      if (body.messages.some((m) => m.text === 'BAD')) throw new ApiError(422, 'invalid_input', 'bad', 'messages');
      sent.push(...body.messages.map((m) => m.text));
      return OK;
    });
    expect(r).toMatchObject({ uploaded: 3, dropped: 1 });
    expect(sent.sort()).toEqual(['a', 'c', 'd']);
    expect(cap.queue).toEqual([]);
  });

  it('413 splits the batch and retries', async () => {
    const cap = new FakeCapture();
    cap.queue = Array.from({ length: 8 }, () => queued());
    const sizes: number[] = [];
    const r = await flushQueue(cap, U, async (_pid, body) => {
      if (body.messages.length > 2) throw new ApiError(413, 'too_large', 'too large');
      sizes.push(body.messages.length);
      return OK;
    });
    expect(r.uploaded).toBe(8);
    expect(sizes).toEqual([2, 2, 2, 2]);
  });

  it('truncates long text to 4000 characters before upload', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued({ text: 'x'.repeat(5000) })];
    let len = 0;
    await flushQueue(cap, U, async (_p, body) => {
      len = body.messages[0].text.length;
      return OK;
    });
    expect(len).toBe(MAX_TEXT);
  });

  it('a per-contact delete aborts that contact’s in-flight batch', async () => {
    const cap = new FakeCapture();
    cap.queue = [queued({ ck: 'notify|whatsapp|sam' }), queued({ ck: 'notify|whatsapp|alex', pid: 2 })];
    const aborted: number[] = [];
    const r = await flushQueue(cap, U, (pid, _b, signal) => new Promise<ImportResult>((resolve, reject) => {
      if (pid === 1) {
        signal?.addEventListener('abort', () => {
          aborted.push(pid);
          reject(new DOMException('aborted', 'AbortError'));
        });
        // The user deletes Sam's captured data while this upload is in flight.
        setTimeout(() => {
          void cap.deleteContact({ method: 'notify', app: 'whatsapp', contact: 'Sam' });
          cancelContactUploads('notify|whatsapp|sam');
        }, 5);
      } else resolve(OK);
    }));
    expect(aborted).toEqual([1]);
    expect(r.uploaded).toBe(1); // Alex's batch still went up
    expect(cap.queue).toEqual([]);
  });

  it('drains in batches until empty, and concurrent calls share one run', async () => {
    const cap = new FakeCapture();
    cap.queue = Array.from({ length: 7 }, () => queued());
    const up = vi.fn(async () => OK);
    const [a, b] = await Promise.all([flushQueue(cap, U, up, { batch: 3 }), flushQueue(cap, U, up, { batch: 3 })]);
    expect(a).toBe(b);
    expect(a.uploaded).toBe(7);
    expect(up).toHaveBeenCalledTimes(3);
  });
});

describe('batches', () => {
  it('splits by count and by encoded bytes; keeps surrogate pairs whole', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ msg: { ts_utc: 'x', ts_precision: 'second' as const, role: 'me' as const, text: `m${String(i).padStart(2, '0')}` } }));
    expect(splitBatches(items, 0, 10).map((b) => b.length)).toEqual([10, 10, 5]);
    const one = bytesOf(items[0].msg) + 1;
    expect(splitBatches(items, 0, 1000, one * 4).map((b) => b.length)).toEqual([4, 4, 4, 4, 4, 4, 1]);
    const emoji = 'a'.repeat(MAX_TEXT - 1) + '😀';
    expect(truncateText(emoji).length).toBe(MAX_TEXT - 1);
    expect(truncateText('short')).toBe('short');
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

describe('consent gating (native source of truth)', () => {
  it('walks unsupported -> needs_consent -> off -> needs_access -> needs_notifications -> active/paused', async () => {
    const cap = new FakeCapture();
    const caps = async () => detectCapabilities(fakeEnv({ capture: cap }));
    expect(gateState('a11y', NO_CAPS)).toBe('unsupported');
    expect(gateState('a11y', await caps())).toBe('needs_consent');
    expect(canEnable('a11y', await caps())).toBe(false);
    localConsent.set('a11y', true); // a JS-only flag is NOT consent
    expect(gateState('a11y', await caps())).toBe('needs_consent');
    cap.agree('a11y');
    expect(nativeConsented('a11y', await caps())).toBe(true);
    expect(gateState('a11y', await caps())).toBe('off');
    expect(canEnable('a11y', await caps())).toBe(true);
    cap.enabled.a11y = true;
    expect(gateState('a11y', await caps())).toBe('needs_access');
    cap.granted.a11y = true;
    cap.notificationsGranted = false;
    expect(gateState('a11y', await caps())).toBe('needs_notifications');
    cap.notificationsGranted = true;
    expect(gateState('a11y', await caps())).toBe('active');
    cap.paused = true;
    expect(gateState('a11y', await caps())).toBe('paused');
  });
  it('the accessibility idle auto-pause shows as paused for that reader only', async () => {
    const cap = new FakeCapture().agree('notify', 'a11y');
    cap.enabled = { notify: true, sms: false, a11y: true };
    cap.granted = { notify: true, sms: false, a11y: true };
    const base = await cap.status();
    cap.status = async () => ({ ...base, methods: { ...base.methods, a11y: { ...base.methods.a11y, idle: true } } });
    const c = await detectCapabilities(fakeEnv({ capture: cap }));
    expect(gateState('a11y', c)).toBe('paused');
    expect(gateState('notify', c)).toBe('active');
  });
});

describe('links', () => {
  it('normalises, validates and upserts', () => {
    expect(normContact('sms', ' +1 (555) 010-2030 ')).toBe('+15550102030');
    expect(normContact('notify', '  Sam   R ')).toBe('Sam R');
    expect(validateLink({ method: 'sms', app: 'sms', contact: '5550102030', pid: 1 })).toMatch(/country code/);
    expect(validateLink({ method: 'sms', app: 'sms', contact: '+15550102030', pid: 1 })).toBeNull();
    expect(validateLink({ method: 'sms', app: 'sms', contact: 'Uber', pid: 1 })).toBeNull();
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
  it('contact keys match the native normalisation', () => {
    const wrapped = String.fromCharCode(0x2068) + 'Sam' + String.fromCharCode(0xa0) + ' R' + String.fromCharCode(0x2069);
    expect(normName(wrapped)).toBe('sam r');
    expect(contactKey({ method: 'notify', app: 'whatsapp', contact: wrapped })).toBe('notify|whatsapp|sam r');
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
