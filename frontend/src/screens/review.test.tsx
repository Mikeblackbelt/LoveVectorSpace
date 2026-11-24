import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { clearSession, onSession, refreshOutcome, setNativeOverride, setTransport, streamAgent } from '../api/client';
import { subscribeEvents } from '../api/events';
import { bootstrapSession, getSession, resetSessionForTests } from '../api/session';
import { getAccessToken, setAccessToken, setRefreshStore } from '../api/tokens';
import type { AgentEvent, LiveEvent, PersonOverview } from '../api/types';
import { Shell } from '../components/Shell';
import { overviewFor } from '../mock/data';
import { mockFetch } from '../mock/server';
import { json, renderAt, useMockApi } from '../test/utils';
import { allowedNext } from './Auth';
import { DashboardScreen } from './Dashboard';
import { PeopleScreen } from './People';
import { clearPendingShare, pendingShare, setPendingShare } from './SharedImport';

const user = { id: 'u1', email: 'a@b.c', email_verified: true, display_name: null, role: 'user' as const, providers: [], created_at: '' };
const urls: string[] = [];

function memStore(initial: string | null) {
  const box = { v: initial };
  setRefreshStore({ get: async () => box.v, set: async (v) => void (box.v = v), clear: async () => void (box.v = null) });
  return box;
}

beforeEach(() => {
  useMockApi();
  resetSessionForTests();
  urls.length = 0;
});
afterEach(() => {
  setNativeOverride(null);
  setRefreshStore(null);
  // no request in any test may carry the access token in its URL
  expect(urls.filter((u) => /access_token/i.test(u))).toEqual([]);
});

function record(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  setTransport(async (url, init) => {
    urls.push(url);
    return handler(url, init);
  });
}

describe('I1: refresh failures are not logouts', () => {
  it('network error during refresh keeps the native refresh token and the session', async () => {
    setNativeOverride(true);
    const box = memStore('rt-1');
    const events: string[] = [];
    const off = onSession((e) => events.push(e.type));
    record(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await refreshOutcome()).kind).toBe('offline');
    expect(box.v).toBe('rt-1');
    expect(events).not.toContain('logged_out');
    expect(events).toContain('offline');
    off();
  });

  it('5xx during refresh keeps the token; 401 drops it', async () => {
    setNativeOverride(true);
    const box = memStore('rt-1');
    record(() => json({ error: { code: 'internal', message: 'x' } }, 502));
    expect((await refreshOutcome()).kind).toBe('offline');
    expect(box.v).toBe('rt-1');
    record(() => json({ error: { code: 'unauthenticated', message: 'x' } }, 401));
    expect((await refreshOutcome()).kind).toBe('denied');
    expect(box.v).toBeNull();
  });

  it('a 401 on a normal request with the server unreachable does not log out', async () => {
    setAccessToken('stale');
    const events: string[] = [];
    const off = onSession((e) => events.push(e.type));
    record((url) => (url.endsWith('/refresh') ? Promise.reject(new TypeError('offline')) : json({ error: { code: 'unauthenticated', message: '' } }, 401)));
    await expect(setTransportAndGet()).rejects.toMatchObject({ status: 401 });
    expect(events).not.toContain('logged_out');
    off();
  });

  it('cold-start bootstrap goes to "offline", not signed out, when the server is unreachable', async () => {
    record(() => Promise.reject(new TypeError('offline')));
    await bootstrapSession();
    expect(getSession().status).toBe('offline');
  });
});

async function setTransportAndGet() {
  const { api } = await import('../api/client');
  return api.get('/api/people');
}

describe('I2: per-user caches are cleared when the session ends', () => {
  it('logout clears the React Query cache and the pending shared file', async () => {
    const qc = new QueryClient();
    localStorage.setItem('lvs.mock.session', '1');
    render(<App skipIntro client={qc} />);
    await waitFor(() => expect(getSession().status).toBe('authed'));
    qc.setQueryData(['people'], [{ id: 99 }]);
    setPendingShare({ name: 'chat.txt', uri: 'content://x', mimeType: 'text/plain' });
    await act(async () => clearSession());
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    expect(pendingShare()).toBeNull();
    clearPendingShare();
  });
});

function DashRoute() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/p/:pid" element={<DashboardScreen />} />
        <Route path="/people" element={<PeopleScreen />} />
      </Route>
    </Routes>
  );
}

/** Every element showing the headline percent must have the range and the uncalibrated tag close by. */
function assertHeadlineTagged(root: HTMLElement, pct: number, lo: number, hi: number) {
  const re = new RegExp(`\\b${pct}\\s*%|\\b${pct} percent`);
  const hits = [...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) => re.test(el.textContent || '') && ![...el.children].some((c) => re.test(c.textContent || '')),
  );
  expect(hits.length).toBeGreaterThan(0);
  for (const el of hits) {
    let ok = false;
    let cur: HTMLElement | null = el;
    for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
      const t = cur.textContent || '';
      if (t.includes(String(lo)) && t.includes(String(hi)) && /UNCAL|uncalibrated|rough estimate/i.test(t)) {
        ok = true;
        break;
      }
    }
    expect(ok, `untagged headline: "${(el.textContent || '').slice(0, 80)}"`).toBe(true);
  }
}

describe('I3: the headline percent always carries its tag and range', () => {
  it('dashboard: hub, contributors line, calibrated note and ticker', async () => {
    const { container } = renderAt(<DashRoute />, { route: '/p/1' });
    await screen.findByTestId('headline');
    expect(container.querySelector('.sum-line')!.textContent).toMatch(/64% \(range 49–79\) \[UNCAL\]/);
    expect(container.querySelector('.cal .cmt')!.textContent).toMatch(/64% \(range 49–79\) \[UNCAL\]/);
    assertHeadlineTagged(container, 64, 49, 79);
  });

  it('people list rows', async () => {
    const { container } = renderAt(<DashRoute />, { route: '/people' });
    await screen.findByText('YU CHENG');
    assertHeadlineTagged(container, 64, 49, 79);
  });

  it('status ok with a null range renders "no range", never "null"', async () => {
    record((url, init) => {
      if (url.endsWith('/api/people/1/overview')) {
        const o: PersonOverview = overviewFor(1);
        o.success = { ...o.success, low: null, high: null };
        return json(o);
      }
      return mockFetch(url, init);
    });
    const { container } = renderAt(<DashRoute />, { route: '/p/1' });
    await screen.findByTestId('headline');
    expect(container.textContent).not.toMatch(/null/);
    expect(screen.getByTestId('headline').textContent).toMatch(/NOT AVAILABLE|no range/i);
    expect(container.querySelector('.sum-line')!.textContent).toContain('64% (no range) [UNCAL]');
  });
});

describe('401 → refresh → retry on the streaming paths', () => {
  it('streamAgent retries after a refresh', async () => {
    setAccessToken('old');
    const enc = new TextEncoder();
    record((url, init) => {
      if (url.endsWith('/api/auth/refresh')) return json({ access_token: 'new', expires_in: 900, user });
      const auth = new Headers(init.headers).get('Authorization');
      if (auth !== 'Bearer new') return json({ error: { code: 'unauthenticated', message: '' } }, 401);
      return new Response(new ReadableStream({ start: (c) => { c.enqueue(enc.encode('data: {"type":"done","message_id":1}\n\n')); c.close(); } }), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const got: AgentEvent[] = [];
    await streamAgent('/api/agent/threads/1/messages', { text: 'hi' }, (e) => got.push(e));
    expect(got).toEqual([{ type: 'done', message_id: 1 }]);
    expect(urls.filter((u) => u.endsWith('/messages'))).toHaveLength(2);
  });

  it('/api/events refreshes on 401 and reads the stream with the header, not a URL token', async () => {
    setAccessToken('old');
    const enc = new TextEncoder();
    record((url, init) => {
      if (url.endsWith('/api/auth/refresh')) return json({ access_token: 'new', expires_in: 900, user });
      if (new Headers(init.headers).get('Authorization') !== 'Bearer new') return json({ error: { code: 'unauthenticated', message: '' } }, 401);
      return new Response(new ReadableStream({ start: (c) => c.enqueue(enc.encode('data: {"type":"snapshot","person_id":1}\n\n')) }), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    const got: LiveEvent[] = [];
    const stop = subscribeEvents((e) => got.push(e));
    await waitFor(() => expect(got).toEqual([{ type: 'snapshot', person_id: 1 }]));
    stop();
    expect(getAccessToken()).toBe('new');
    expect(urls.every((u) => u.split('?')[0] === u || !u.includes('token'))).toBe(true);
  });
});

describe('allowedNext (open-redirect guard)', () => {
  it.each([
    ['/people', '/people'],
    ['/p/1/chat?x=1#y', '/p/1/chat?x=1#y'],
    [null, '/people'],
    ['', '/people'],
    ['//evil.example', '/people'],
    ['/\\evil.example', '/people'],
    ['\\\\evil.example', '/people'],
    ['https://evil.example/people', '/people'],
    ['javascript:alert(1)', '/people'],
    ['/%2F%2Fevil.example', '/people'],
    ['%2F%2Fevil.example', '/people'],
    ['/%5Cevil.example', '/people'],
    ['/auth/login', '/people'],
    ['/auth', '/people'],
    ['/people\n//evil', '/people'],
  ])('%s → %s', (raw, want) => {
    expect(allowedNext(raw as string | null)).toBe(want);
  });
});
