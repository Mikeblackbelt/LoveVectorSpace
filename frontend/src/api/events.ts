import { rawRequest } from './client';
import { readSSE } from './sse';
import type { LiveEvent } from './types';

/**
 * Subscribe to GET /api/events. Uses fetch streaming (so the access JWT goes in
 * the Authorization header and a 401 triggers the normal refresh-then-retry),
 * and reconnects with backoff when the stream ends. Returns an unsubscribe fn.
 */
export function subscribeEvents(onEvent: (e: LiveEvent) => void): () => void {
  const ctrl = new AbortController();
  let delay = 1000;

  const loop = async () => {
    while (!ctrl.signal.aborted) {
      try {
        const res = await rawRequest('/api/events', { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
        if (res.ok && res.body) {
          delay = 1000;
          await readSSE(
            res.body,
            (data) => {
              try {
                onEvent(JSON.parse(data) as LiveEvent);
              } catch {
                /* ignore */
              }
            },
            ctrl.signal,
          );
        } else if (res.status === 401) {
          return; // session ended; the auth layer handles the redirect
        }
      } catch {
        /* network error: fall through to backoff */
      }
      if (ctrl.signal.aborted) return;
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30000);
    }
  };
  void loop();
  return () => ctrl.abort();
}
