// Uploads queued phone captures while signed in: on mount, whenever the app returns to the
// foreground, and every 10 minutes while open. Renders nothing. Mount inside the authed Shell.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { captureEnv, type CaptureEnv } from '../../native/capture';
import { detectCapabilities } from './capabilities';
import { flushQueue } from './queue';

const EVERY_MS = 10 * 60_000;

/** One sync+flush pass. Never throws; returns uploaded count (0 when nothing to do). */
export async function syncAndFlush(env: CaptureEnv = captureEnv()): Promise<number> {
  try {
    const caps = await detectCapabilities(env);
    if (caps.flavour !== 'sideload' || !caps.status) return 0;
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
  useEffect(() => {
    if (captureEnv().platform() !== 'android') return;
    let alive = true;
    const run = async () => {
      const n = await syncAndFlush();
      if (alive && n > 0) {
        void qc.invalidateQueries({ queryKey: ['units'] });
        void qc.invalidateQueries({ queryKey: ['coverage'] });
        void qc.invalidateQueries({ queryKey: ['people'] });
        void qc.invalidateQueries({ queryKey: ['capture-caps'] });
      }
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
  }, [qc]);
  return null;
}
