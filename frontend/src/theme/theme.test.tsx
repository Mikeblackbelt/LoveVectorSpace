import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { acceptAuth, setTransport } from '../api/client';
import type { Metric } from '../api/types';
import { json, renderAt } from '../test/utils';
import { MetricName, Tag } from './Plain';
import { useTheme } from './ThemeProvider';
import { DEFAULT_AUTO, THEMES, nextTheme, resolveMotion, resolveTheme } from './themes';

function Probe() {
  const { theme, cycle, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => cycle()}>cycle</button>
      <button onClick={() => setTheme('journal')}>journal</button>
    </div>
  );
}

describe('themes', () => {
  it('has 9 themes in the design-system cycle order', () => {
    expect(THEMES).toEqual(['signal', 'pulse', 'riso', 'blueprint', 'journal', 'matcha', 'midnight', 'inkwell', 'crt']);
    expect(DEFAULT_AUTO.day).toBe('journal');
    expect(DEFAULT_AUTO.night).toBe('signal');
    expect(nextTheme('crt')).toBe('signal');
  });

  it('switches theme on the app root and persists to localStorage + /api/settings', async () => {
    const puts: unknown[] = [];
    setTransport(async (url, init) => {
      if (url.endsWith('/api/settings') && init.method === 'PUT') {
        puts.push(JSON.parse(init.body as string));
        return json({});
      }
      return json({ theme: 'signal', auto_theme: DEFAULT_AUTO, reduce_motion: false, contrast_boost: false, text_size: 'm' });
    });
    await acceptAuth({ access_token: 'x', expires_in: 900, user: { id: 'u', email: 'a@b', email_verified: true, display_name: null, role: 'user', providers: [], created_at: '' } });
    const { container } = renderAt(<Probe />);
    const root = container.querySelector('.lvs')!;
    expect(root.getAttribute('data-theme')).toBe('signal');
    await act(async () => fireEvent.click(screen.getByText('cycle')));
    expect(root.getAttribute('data-theme')).toBe('pulse');
    expect(JSON.parse(localStorage.getItem('lvs.prefs')!).theme).toBe('pulse');
    await waitFor(() => expect(puts).toContainEqual({ theme: 'pulse' }));
  });

  it('restores the saved theme from localStorage on start (fast path)', () => {
    localStorage.setItem('lvs.prefs', JSON.stringify({ theme: 'blueprint' }));
    renderAt(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('blueprint');
  });

  it('motion: explicit choice wins; otherwise gentle for OS reduce, account or inkwell', () => {
    expect(resolveMotion(null, { osReduce: false, accountReduce: false, theme: 'signal' })).toBe('full');
    expect(resolveMotion(null, { osReduce: true, accountReduce: false, theme: 'signal' })).toBe('gentle');
    expect(resolveMotion(null, { osReduce: false, accountReduce: false, theme: 'inkwell' })).toBe('gentle');
    expect(resolveMotion('full', { osReduce: true, accountReduce: true, theme: 'inkwell' })).toBe('full');
    expect(resolveMotion('off', { osReduce: false, accountReduce: false, theme: 'signal' })).toBe('off');
  });

  it('AUTO resolves by system appearance or time of day', () => {
    const auto = { ...DEFAULT_AUTO, day: 'riso' as const, night: 'crt' as const };
    expect(resolveTheme('auto', auto, { prefersLight: true, now: new Date() })).toBe('riso');
    expect(resolveTheme('auto', auto, { prefersLight: false, now: new Date() })).toBe('crt');
    const t = { ...auto, mode: 'time' as const };
    expect(resolveTheme('auto', t, { prefersLight: false, now: new Date(2026, 0, 1, 12) })).toBe('riso');
    expect(resolveTheme('auto', t, { prefersLight: true, now: new Date(2026, 0, 1, 22) })).toBe('crt');
  });

  it('journal shows Metric.plain_label and plain evidence words', async () => {
    const m: Metric = { id: 'initiation_share', label: 'initiation_share', plain_label: 'Who starts conversations', value: 0.6, per_speaker: null, evidence: 'heuristic', status: 'ok', note: '', band: 'no reference band' };
    renderAt(
      <>
        <Probe />
        <span data-testid="m"><MetricName m={m} /></span>
        <span data-testid="t"><Tag evidence="moderate" /></span>
      </>,
    );
    expect(screen.getByTestId('m').textContent).toBe('initiation_share');
    expect(screen.getByTestId('t').textContent).toBe('[MOD]');
    await act(async () => fireEvent.click(screen.getByText('journal')));
    expect(screen.getByTestId('m').textContent).toBe('Who starts conversations');
    expect(screen.getByTestId('t').textContent).toBe('moderate evidence');
  });
});
