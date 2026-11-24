import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { captureEnv } from '../../native/capture';
import { detectCapabilities, NO_CAPS, type Capabilities } from './capabilities';

export const CAPS_KEY = ['capture-caps'] as const;

/**
 * What this build/device can capture. Refreshed after every change and whenever the app comes
 * back to the foreground (the user may have just granted access in system settings).
 */
export function useCaptureCaps(): { caps: Capabilities; loading: boolean; refresh: () => Promise<void> } {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CAPS_KEY, queryFn: () => detectCapabilities(), staleTime: 5_000 });
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: CAPS_KEY });
  }, [qc]);

  useEffect(() => {
    if (captureEnv().platform() === 'web') return;
    let alive = true;
    let remove: (() => void) | null = null;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => void refresh()))
      .then((h) => {
        if (alive) remove = () => void h.remove();
        else void h.remove();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      remove?.();
    };
  }, [refresh]);

  return { caps: q.data ?? NO_CAPS, loading: q.isLoading, refresh };
}
