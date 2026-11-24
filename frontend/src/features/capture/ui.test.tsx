import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTransport } from '../../api/client';
import { mockFetch } from '../../mock/server';
import { setCaptureEnv } from '../../native/capture';
import { json, renderAt, useMockApi } from '../../test/utils';
import { syncAndFlush } from './CaptureFlusher';
import { W, H, layout } from './fixtures';
import { PhoneCapturePane } from './PhoneCapture';
import { ScreenshotImportKey } from './ScreenshotImport';
import { fakeEnv, FakeCapture, FakeOcr, queued } from './testing';
import type { ImportMessagesBody } from './types';

let posted: { url: string; body: ImportMessagesBody }[] = [];

beforeEach(() => {
  useMockApi();
  posted = [];
  setTransport(async (url, init) => {
    if (/\/imports\/messages$/.test(url)) {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return json({ unit_id: 'import:x', added: 2, merged: 0, skipped_non_english: 0, one_sided: false, job_id: 1 }, 201);
    }
    return mockFetch(url, init);
  });
});
afterEach(() => setCaptureEnv(null));

describe('PhoneCapturePane', () => {
  it('web: explains the phone apps, offers no readers', async () => {
    setCaptureEnv(fakeEnv({ platform: 'web' }));
    renderAt(<PhoneCapturePane />);
    expect(await screen.findByText(/Available in the iPhone and Android apps/)).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/)).toBeInTheDocument();
    expect(screen.queryByText(/NOTIFY READER|Notification reader/)).not.toBeInTheDocument();
  });

  it('store flavour: screenshot import only, readers hidden', async () => {
    setCaptureEnv(fakeEnv({ plugins: ['LvsOcr'] }));
    renderAt(<PhoneCapturePane />);
    expect(await screen.findByText(/This is the Play Store build/)).toBeInTheDocument();
    expect(screen.queryByText(/A11Y READER|Accessibility chat reader/)).not.toBeInTheDocument();
  });

  it('sideload: accessibility reader is off until the consent screen is agreed, then needs Android access', async () => {
    const cap = new FakeCapture();
    setCaptureEnv(fakeEnv({ capture: cap }));
    renderAt(<PhoneCapturePane />);
    // Every reader starts behind its explanation.
    expect(await screen.findAllByRole('button', { name: /SET UP|Read how it works/ })).toHaveLength(3);
    expect(screen.getByTestId('cap-state-a11y')).toHaveTextContent(/OFF/);

    fireEvent.click(document.getElementById('btn-cap-setup-a11y')!);
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByText(/Password fields or anything you are typing/)).toBeInTheDocument();
    const agree = within(dlg).getByRole('button', { name: /AGREE|Agree/ });
    expect(agree).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('checkbox'));
    fireEvent.click(agree);
    await waitFor(() => expect(cap.calls).toContain('setEnabled:a11y:true'));
    expect(localStorage.getItem('lvs_capture_consent_a11y')).toBe('1');
    await waitFor(() => expect(screen.getByTestId('cap-state-a11y')).toHaveTextContent(/NEEDS ACCESS/));
    fireEvent.click(document.getElementById('btn-cap-grant-a11y')!);
    expect(cap.calls).toContain('openSystemSettings:a11y');
  });

  it('links a contact, unlinks it (purging its queue), and pauses', async () => {
    const cap = new FakeCapture();
    cap.enabled.notify = true;
    cap.granted.notify = true;
    localStorage.setItem('lvs_capture_consent_notify', '1');
    setCaptureEnv(fakeEnv({ capture: cap }));
    renderAt(<PhoneCapturePane />);
    await waitFor(() => expect(screen.getByTestId('cap-state-notify')).toHaveTextContent(/CAPTURING/));
    fireEvent.change(document.getElementById('cap-notify-app')!, { target: { value: 'tinder' } });
    fireEvent.change(document.getElementById('cap-notify-contact')!, { target: { value: '  Sam  ' } });
    fireEvent.click(document.getElementById('btn-cap-link-notify')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Choose a person/);
    await screen.findByRole('option', { name: 'Sam' });
    fireEvent.change(document.getElementById('cap-notify-person')!, { target: { value: '2' } });
    fireEvent.click(document.getElementById('btn-cap-link-notify')!);
    await waitFor(() => expect(cap.links).toEqual([{ method: 'notify', app: 'tinder', contact: 'Sam', pid: 2 }]));
    expect(await screen.findByText(/Tinder → Sam/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unlink Sam' }));
    await waitFor(() => expect(cap.links).toEqual([]));
    expect(cap.calls).toContain('deleteContact:notify:tinder:Sam');

    fireEvent.click(document.getElementById('btn-cap-pause')!);
    await waitFor(() => expect(cap.calls).toContain('setPaused:true'));
    await waitFor(() => expect(screen.getByTestId('cap-state-notify')).toHaveTextContent(/PAUSED/));
  });
});

describe('ScreenshotImportKey', () => {
  it('is hidden on the web', async () => {
    setCaptureEnv(fakeEnv({ platform: 'web' }));
    const { container } = renderAt(<ScreenshotImportKey pid={2} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('#btn-shots-open')).toBeNull();
  });

  it('OCR -> review (flip, drop) -> POST imports/messages with only reviewed text', async () => {
    const ocr = new FakeOcr();
    const lines = layout([
      { sep: 'Yesterday' },
      { role: 'them', lines: ['did you get home ok'], time: '11:02 PM' },
      { role: 'me', lines: ['yes thanks for tonight'], time: '11:05 PM' },
      { role: 'them', lines: ['same time next week?'], time: '11:07 PM' },
    ]);
    ocr.results = [{ width: W, height: H, blocks: [{ text: '', lines }] }];
    setCaptureEnv(fakeEnv({ platform: 'ios', plugins: ['LvsOcr'], ocr }));
    renderAt(<ScreenshotImportKey pid={2} />);
    fireEvent.click(await screen.findByRole('button', { name: /IMPORT SCREENSHOTS|Import screenshots/ }));
    const file = new File([new Uint8Array([1, 2, 3])], 'shot1.png', { type: 'image/png', lastModified: new Date(2026, 10, 18, 9).getTime() });
    await userEvent.upload(document.getElementById('shots-file') as HTMLInputElement, file);
    const list = await screen.findByRole('list', { name: 'Messages found' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(ocr.calls).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /Message 1 is from them/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Drop message 3' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message 2 text' }), { target: { value: 'yes!! thanks for tonight' } });
    fireEvent.click(document.getElementById('btn-shots-import')!);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toMatch(/\/api\/people\/2\/imports\/messages$/);
    expect(posted[0].body).toMatchObject({
      source: 'screenshot_import',
      messages: [
        { ts_local: '2026-11-17T23:02:00', ts_precision: 'approx', role: 'me', text: 'did you get home ok' },
        { ts_local: '2026-11-17T23:05:00', ts_precision: 'approx', role: 'me', text: 'yes!! thanks for tonight' },
      ],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('syncAndFlush', () => {
  it('sideload: syncs SMS when enabled and uploads the queue; store/web: no-op', async () => {
    const cap = new FakeCapture();
    cap.enabled.sms = true;
    cap.granted.sms = true;
    cap.smsToQueue = [queued({ source: 'android_sms', role: 'me', pid: 1 })];
    expect(await syncAndFlush(fakeEnv({ capture: cap }))).toBe(1);
    expect(cap.calls).toContain('syncSms');
    expect(posted[0].body.source).toBe('android_sms');
    expect(await syncAndFlush(fakeEnv({ plugins: ['LvsOcr'] }))).toBe(0);
    expect(await syncAndFlush(fakeEnv({ platform: 'web' }))).toBe(0);
  });
});
