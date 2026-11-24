import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { json } from '../test/utils';
import { api, refreshOnce, setNativeOverride, setTransport } from './client';
import { readSSE } from './sse';
import { getAccessToken, setAccessToken, setRefreshStore } from './tokens';

const user = { id: 'u1', email: 'a@b.c', email_verified: true, display_name: null, role: 'user', providers: ['password'], created_at: '' };

type Call = { url: string; method: string; headers: Headers; body: unknown };

function recorder(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  setTransport(async (url, init) => {
    const c = { url, method: (init.method || 'GET').toUpperCase(), headers: new Headers(init.headers), body: init.body };
    calls.push(c);
    return handler(c, calls.length);
  });
  return calls;
}

beforeEach(() => {
  setNativeOverride(false);
  setAccessToken(null);
});
afterEach(() => {
  setNativeOverride(null);
  setRefreshStore(null);
});

describe('auth refresh + retry', () => {
  it('on 401 refreshes once, then retries with the new access token', async () => {
    setAccessToken('old');
    const calls = recorder((c) => {
      if (c.url.endsWith('/api/auth/refresh')) return json({ access_token: 'new', expires_in: 900, user });
      if (c.headers.get('Authorization') === 'Bearer old') return json({ error: { code: 'unauthenticated', message: 'expired' } }, 401);
      return json([{ id: 1 }]);
    });
    const r = await api.get<{ id: number }[]>('/api/people');
    expect(r).toEqual([{ id: 1 }]);
    expect(calls.map((c) => c.url)).toEqual(['/api/people', '/api/auth/refresh', '/api/people']);
    expect(calls[2].headers.get('Authorization')).toBe('Bearer new');
    expect(getAccessToken()).toBe('new');
  });

  it('shares one refresh between concurrent 401s (refresh tokens rotate)', async () => {
    setAccessToken('old');
    let refreshes = 0;
    recorder(async (c) => {
      if (c.url.endsWith('/api/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return json({ access_token: 'new', expires_in: 900, user });
      }
      if (c.headers.get('Authorization') !== 'Bearer new') return json({ error: { code: 'unauthenticated', message: 'x' } }, 401);
      return json({ ok: true });
    });
    await Promise.all([api.get('/api/a'), api.get('/api/b'), api.get('/api/c')]);
    expect(refreshes).toBe(1);
  });

  it('gives up (no loop) when refresh fails', async () => {
    setAccessToken('old');
    const calls = recorder(() => json({ error: { code: 'unauthenticated', message: 'no' } }, 401));
    await expect(api.get('/api/people')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(2);
    expect(getAccessToken()).toBeNull();
  });
});

describe('CSRF + client headers', () => {
  it('sends X-CSRF-Token from lvs_csrf on cookie-authenticated writes, not on reads', async () => {
    document.cookie = 'lvs_csrf=abc123; path=/';
    const calls = recorder(() => json({}));
    await api.get('/api/settings');
    await api.put('/api/settings', { theme: 'riso' });
    await api.del('/api/tokens/1');
    expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
    expect(calls[1].headers.get('X-CSRF-Token')).toBe('abc123');
    expect(calls[2].headers.get('X-CSRF-Token')).toBe('abc123');
  });

  it('web refresh is a cookie POST carrying the CSRF header and no body', async () => {
    document.cookie = 'lvs_csrf=tok; path=/';
    const calls = recorder(() => json({ access_token: 'a', expires_in: 900, user }));
    await refreshOnce();
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.get('X-CSRF-Token')).toBe('tok');
    expect(calls[0].body).toBeUndefined();
  });

  it('native: X-Client header and refresh token in the JSON body, rotated token stored', async () => {
    setNativeOverride(true);
    let stored: string | null = 'rt-1';
    setRefreshStore({ get: async () => stored, set: async (v) => { stored = v; }, clear: async () => { stored = null; } });
    const calls = recorder(() => json({ access_token: 'a', expires_in: 900, refresh_token: 'rt-2', user }));
    await refreshOnce();
    expect(calls[0].headers.get('X-Client')).toBe('native');
    expect(JSON.parse(calls[0].body as string)).toEqual({ refresh_token: 'rt-1' });
    expect(stored).toBe('rt-2');
    await api.post('/api/people', { pseudonym: 'x', mode: 'potential' });
    expect(calls[1].headers.get('X-Client')).toBe('native');
    expect(calls[1].headers.get('X-CSRF-Token')).toBeNull();
  });
});

describe('SSE parser', () => {
  it('buffers frames split across chunk boundaries', async () => {
    const enc = new TextEncoder();
    const parts = ['data: {"type":"tok', 'en","text":"he"}\n', '\ndata: {"type":"done","message_id":1}\r\n\r\n', ': keepalive\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        parts.forEach((p) => c.enqueue(enc.encode(p)));
        c.close();
      },
    });
    const got: string[] = [];
    await readSSE(body, (d) => got.push(d));
    expect(got.map((g) => JSON.parse(g).type)).toEqual(['token', 'done']);
  });
});
