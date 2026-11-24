import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { api, setTransport } from '../api/client';
import { peopleApi } from '../api/endpoints';
import { googleStartUrl } from '../api/social';
import { mockFetch } from '../mock/server';
import { json, renderAt, useMockApi } from '../test/utils';
import { VerifyScreen } from './Auth';
import { ImportDialog } from './Sources';

beforeEach(() => useMockApi());

describe('dating imports', () => {
  it('shows a match picker, requires a match and sends match_id; one-sided matches show the partial note', async () => {
    const forms: FormData[] = [];
    setTransport(async (url, init) => {
      if (url.endsWith('/imports') && init.body instanceof FormData) forms.push(init.body);
      return mockFetch(url, init);
    });
    renderAt(<ImportDialog pid={1} onClose={() => undefined} />);
    const file = new File([JSON.stringify({ matches: [{ match_id: 'abc', label: 'Match with R.', messages: [1, 2, 3] }, { match_id: 'def', label: 'Match with K.' }] })], 'tinder-data.json', { type: 'application/json' });
    await act(async () => fireEvent.change(screen.getByLabelText(/DROP/i, { selector: 'input' }), { target: { files: [file] } }));
    const picker = await screen.findByTestId('match-picker');
    expect(picker.textContent).toContain('Match with R.');
    expect(picker.textContent).toContain('[ONE-SIDED]');
    expect(screen.queryByText(/WHICH NAME IS YOU/)).toBeNull();
    const go = screen.getByRole('button', { name: /IMPORT$/ });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Match with R\./));
    expect(screen.getByText(/coverage is partial/)).toBeInTheDocument();
    await act(async () => fireEvent.click(go));
    await waitFor(() => expect(forms).toHaveLength(1));
    expect(forms[0].get('match_id')).toBe('abc');
    expect(forms[0].getAll('me_names')).toEqual([]);
  });

  it('client posts structured capture messages to /imports/messages', async () => {
    const r = await peopleApi.importMessages(1, { source: 'android_sms', tz: 'UTC', messages: [{ ts_utc: '2026-11-20T10:00:00Z', ts_precision: 'minute', role: 'them', text: 'hi' }] });
    expect(r.added).toBe(1);
    expect(r.unit_id).toContain('android_sms');
  });
});

describe('auth link alignment', () => {
  it('accepts the email-link token from the fragment (#token=) as well as ?token=', async () => {
    const tokens: string[] = [];
    setTransport(async (url, init) => {
      if (url.endsWith('/verify-email')) tokens.push(JSON.parse(init.body as string).token);
      return mockFetch(url, init);
    });
    renderAt(<VerifyScreen />, { route: '/auth/verify#token=frag123' });
    await waitFor(() => expect(tokens).toEqual(['frag123']));
    expect(await screen.findByText(/email verified/)).toBeInTheDocument();
  });

  it('web Google sign-up passes the invite to /api/auth/google/start', () => {
    expect(googleStartUrl('/people', 'LVS-7Q4K')).toBe('/api/auth/google/start?invite=LVS-7Q4K&redirect=%2Fpeople');
    expect(googleStartUrl('/people')).toBe('/api/auth/google/start?redirect=%2Fpeople');
  });
});

describe('503 unavailable', () => {
  it('waits Retry-After and retries once', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      if (n === 1) {
        const r = json({ error: { code: 'unavailable', message: 'busy' } }, 503);
        r.headers.set('Retry-After', '1');
        return r;
      }
      return json({ ok: true });
    });
    await expect(api.get('/api/people')).resolves.toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it('does not retry agent_unavailable', async () => {
    let n = 0;
    setTransport(async () => {
      n++;
      return json({ error: { code: 'agent_unavailable', message: 'off' } }, 503);
    });
    await expect(api.get('/api/people/1/agent/threads')).rejects.toMatchObject({ code: 'agent_unavailable' });
    expect(n).toBe(1);
  });
});
