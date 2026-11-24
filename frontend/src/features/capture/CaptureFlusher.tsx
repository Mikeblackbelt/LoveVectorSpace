// Uploads queued phone captures while signed in: on mount, whenever the app returns to the
// foreground, and every 10 minutes while open. Renders nothing. Mount inside the authed Shell.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from '../../api/session';
import { captureEnv, type CaptureEnv } from '../../native/capture';
import { detectCapabilities } from './capabilities';
import { localConsent, type ConsentStore } from './consent';
import { flushQueue } from './queue';
import type { ReaderMethod } from './types';

const EVERY_MS = 10 * 60_000;
const OWNER_KEY = 'lvs_capture_owner';
const READERS: ReaderMethod[] = ['notify', 'sms', 'a11y'];

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}
function writeOwner(id: string): void {
  try {
    localStorage.setItem(OWNER_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Person ids belong to an account. If a different account signs in on this phone, the previous
 * account's links, queue and consents are cleared so its captures can never reach the new one.
 * Returns true if it reset.
 */
export async function ensureCaptureOwner(env: CaptureEnv, userId: string, consent: ConsentStore = localConsent): Promise<boolean> {
  const owner = readOwner();
  if (owner === userId) return false;
  writeOwner(userId);
  if (owner == null) return false; // first account on this phone
  const plugin = env.capture();
  await plugin.setLinks({ links: [] }); // native side drops everything queued for removed links
  for (const m of READERS) {
    await plugin.setEnabled({ method: m, enabled: false });
    consent.set(m, false);
  }
  return true;
}

/** One owner-check + SMS sync + flush pass. Never throws; returns uploaded count. */
export async function syncAndFlush(env: CaptureEnv = captureEnv(), userId?: string): Promise<number> {
  try {
    const caps = await detectCapabilities(env);
    if (caps.flavour !== 'sideload' || !caps.status) return 0;
    if (userId && (await ensureCaptureOwner(env, userId))) return 0;
    const plugin = env.capture();
    const sms = caps.status.methods.sms;
    if (sms.enabled && sms.granted && !caps.status.paused) await plugin.syncSms();
    const r = await flushQueue(plugin);
    return r.uploaded;
  } catch {
    return 0; // offline or plugin trouble: the queue keeps everything for next time
  }
}

export function CaptureFlusher() {
  const qc = useQueryClient();
  const session = useSession();
  const userId = session.user?.id;
  useEffect(() => {
    if (captureEnv().platform() !== 'android' || !userId) return;
    let alive = true;
    const run = async () => {
      const n = await syncAndFlush(captureEnv(), userId);
      if (alive && n > 0) {
        void qc.invalidateQueries({ queryKey: ['units'] });
        void qc.invalidateQueries({ queryKey: ['coverage'] });
        void qc.invalidateQueries({ queryKey: ['people'] });
      }
      if (alive) void qc.invalidateQueries({ queryKey: ['capture-caps'] });
    };
    void run();
    const t = window.setInterval(() => void run(), EVERY_MS);
    let remove: (() => void) | null = null;
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => void run()))
      .then((h) => {
        if (alive) remove = () => void h.remove();
        else void h.remove();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      window.clearInterval(t);
      remove?.();
    };
  }, [qc, userId]);
  return null;
}
