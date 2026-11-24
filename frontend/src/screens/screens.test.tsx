import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setTransport } from '../api/client';
import { Shell, MOBILE_KEYS } from '../components/Shell';
import { mockFetch } from '../mock/server';
import { json, renderAt, useMockApi } from '../test/utils';
import { ChatScreen } from './Chat';
import { DashboardScreen } from './Dashboard';
import { ImportDialog } from './Sources';
import { Route, Routes } from 'react-router-dom';

beforeEach(() => useMockApi());

function DashRoute() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/p/:pid" element={<DashboardScreen />} />
        <Route path="/p/:pid/chat" element={<ChatScreen />} />
      </Route>
    </Routes>
  );
}

describe('dashboard', () => {
  it('puts the safety block first, with plain-text resources and no tel:/sms: links', async () => {
    const { container } = renderAt(<DashRoute />, { route: '/p/2' });
    const block = await screen.findByTestId('safety-block');
    const main = container.querySelector('main.grid')!;
    expect(main.firstElementChild).toContainElement(block);
    // nothing in the main grid comes before the warning
    expect(main.firstElementChild!.querySelector('[data-testid="safety-block"]')).toBe(block);
    const res = within(block).getByTestId('safety-resources');
    expect(res.textContent).toContain('1-800-799-7233');
    expect(res.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('a[href^="tel:"], a[href^="sms:"]')).toHaveLength(0);
    expect(block.textContent).toContain('It is not therapy, counselling, or a crisis service.');
    expect(block.textContent).toContain('[ CONCERN ]'.replace(/\[ | \]/g, '').trim());
  });

  it('always shows the headline with its uncalibrated tag and range', async () => {
    renderAt(<DashRoute />, { route: '/p/1' });
    const hub = await screen.findByTestId('headline');
    expect(hub.textContent).toContain('[ UNCALIBRATED ]');
    expect(hub.textContent).toMatch(/RANGE\s*49\s*─+\s*79/);
    expect(hub.textContent).toContain('64 percent, uncalibrated, range 49 to 79');
    expect(screen.getByTestId('headline-tag').textContent).toContain('uncalibrated estimate: hand-set weights, not fitted to outcomes');
    expect(screen.getByTestId('calibrated').textContent).toContain('needs 20 more labelled outcomes');
    expect(screen.queryByTestId('safety-block')).toBeNull();
  });

  it('shows insufficient data instead of a number for Jordan, still tagged', async () => {
    renderAt(<DashRoute />, { route: '/p/3' });
    const hub = await screen.findByTestId('headline');
    expect(hub.textContent).toContain('[ INSUFFICIENT DATA ]');
    expect(screen.getByTestId('headline-tag').textContent).toContain('uncalibrated estimate');
  });

  it('hatches uncovered weeks and tags every signal with evidence', async () => {
    const { container } = renderAt(<DashRoute />, { route: '/p/1' });
    await screen.findByTestId('headline');
    expect(container.querySelectorAll('[data-testid="gap"]').length).toBeGreaterThan(0);
    const rows = container.querySelectorAll('table.sig tbody tr[id^="metric-"]');
    expect(rows.length).toBeGreaterThan(7);
    rows.forEach((r) => expect(r.querySelector('.tag')).not.toBeNull());
    expect(container.textContent).toContain('no reference band');
  });

  it('phone bottom bar has at most 5 items', async () => {
    const { container } = renderAt(<DashRoute />, { route: '/p/1' });
    await screen.findByTestId('headline');
    const bar = container.querySelector('nav.mbar')!;
    expect(bar.querySelectorAll('a').length).toBeLessThanOrEqual(5);
    expect(MOBILE_KEYS.length).toBeLessThanOrEqual(5);
  });
});

describe('import', () => {
  it('will not import until "which name is you" is answered', async () => {
    const posts: string[] = [];
    setTransport(async (url, init) => {
      if (init.method === 'POST') posts.push(url);
      return mockFetch(url, init);
    });
    renderAt(<ImportDialog pid={1} onClose={() => undefined} />);
    const file = new File(['12/11/2026, 21:04 - Alex: hi\n12/11/2026, 21:05 - Yu Cheng: hey!\n'], 'WhatsApp Chat - Yu Cheng.txt', { type: 'text/plain' });
    await act(async () => fireEvent.change(screen.getByLabelText(/DROP/i, { selector: 'input' }), { target: { files: [file] } }));
    await screen.findByText('Yu Cheng', { exact: false, selector: 'label' });
    const go = screen.getByRole('button', { name: /IMPORT$/ });
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(posts.filter((u) => u.endsWith('/imports'))).toHaveLength(0);
    fireEvent.click(screen.getByLabelText(/Alex/));
    expect(go).not.toBeDisabled();
    await act(async () => fireEvent.click(go));
    await waitFor(() => expect(posts.filter((u) => u.endsWith('/imports'))).toHaveLength(1));
  });
});

describe('agent chat', () => {
  it('renders streamed tokens and tool-call chips as SSE frames arrive', async () => {
    const enc = new TextEncoder();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setTransport(async (url, init) => {
      if (url.endsWith('/messages') && init.method === 'POST') {
        const body = new ReadableStream<Uint8Array>({
          async start(c) {
            c.enqueue(enc.encode('data: {"type":"tool_call","name":"get_person_overview","args":{"person_id":1}}\n\n'));
            c.enqueue(enc.encode('data: {"type":"tool_result","name":"get_person_overview","ok":true,"summary":"loaded"}\n\ndata: {"type":"tok'));
            c.enqueue(enc.encode('en","text":"Ask them "}\n\n'));
            await gate;
            c.enqueue(enc.encode('data: {"type":"token","text":"about Saturday."}\n\ndata: {"type":"done","message_id":99}\n\n'));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return mockFetch(url, init);
    });
    renderAt(<DashRoute />, { route: '/p/1/chat' });
    await screen.findByText(/They've accepted 3 of your last 4 plans/);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'what should I say?' } });
    await act(async () => fireEvent.submit(screen.getByLabelText('Message').closest('form')!));
    await screen.findByText(/Ask them/);
    expect(screen.getByTestId('transcript').textContent).not.toContain('about Saturday.');
    const chips = screen.getAllByTestId('tool-chips');
    expect(chips[chips.length - 1].textContent).toContain('get_person_overview');
    await act(async () => release());
    await screen.findByText(/Ask them about Saturday\./);
  });

  it('shows the agent_unavailable state on 503 and keeps hangout logging', async () => {
    setTransport(async (url, init) => {
      if (url.includes('/agent/')) return json({ error: { code: 'agent_unavailable', message: 'off' } }, 503);
      return mockFetch(url, init);
    });
    renderAt(<DashRoute />, { route: '/p/1/chat' });
    expect(await screen.findByTestId('agent-unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /LOG A HANGOUT/ }));
    expect(await screen.findByText(/question 1 of/)).toBeInTheDocument();
  });
});
