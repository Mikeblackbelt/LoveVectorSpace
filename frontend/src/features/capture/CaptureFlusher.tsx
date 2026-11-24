// Uploads queued phone captures while signed in: on mount, whenever the app returns to the
// foreground, and every 10 minutes while open. Renders nothing. Mount inside the authed Shell.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useSession } from '../../api/session';
import { captureEnv, type CaptureEnv } from '../../native/capture';
import { detectCapabilities } from './capabilities';
import { flushQueue, type FlushResult } from './queue';
import { ensureCaptureOwner } from './session';

const EVERY_MS = 10 * 60_000;

export { ensureCaptureOwner };

/**
 * One owner-check + SMS sync + flush pass for `userId` ("Upload now" uses this too). Never throws.
 * Uploads nothing if the owner check wiped a previous account's state.
 */
export async function syncAndFlush(env: CaptureEnv, userId: string): Promise<FlushResult> {
  const none: FlushResult = { uploaded: 0, dropped: 0, imports: 0, kept: 0 };
  try {
    const caps = await detectCapabilities(env);
    if (caps.flavour !== 'sideload' || !caps.status) return none;
    if (await ensureCaptureOwner(env, userId)) return none;
    const plugin = env.capture();
    const sms = caps.status.methods.sms;
    if (sms.enabled && sms.granted && !caps.status.paused) await plugin.syncSms();
    return await flushQueue(plugin, userId);
  } catch (e) {
    // Offline or plugin trouble: the queue keeps everything for next time.
    return { ...none, error: e instanceof Error ? e.message : 'Capture unavailable' };
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
      const r = await syncAndFlush(captureEnv(), userId);
      if (alive && r.uploaded > 0) {
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
