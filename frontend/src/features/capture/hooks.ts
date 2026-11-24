import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { detectCapabilities, NO_CAPS, type Capabilities } from './capabilities';

export const CAPS_KEY = ['capture-caps'] as const;

/** What this build/device can capture, refreshed after every change. */
export function useCaptureCaps(): { caps: Capabilities; loading: boolean; refresh: () => Promise<void> } {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CAPS_KEY, queryFn: () => detectCapabilities(), staleTime: 5_000 });
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: CAPS_KEY });
  }, [qc]);
  return { caps: q.data ?? NO_CAPS, loading: q.isLoading, refresh };
}
