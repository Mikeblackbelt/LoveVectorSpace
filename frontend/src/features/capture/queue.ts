// Flushing the native encrypted capture queue to the server.
//
// drain() -> group by (person, source, tz) -> POST /imports/messages -> ack() on success.
// Transient failures (offline, 401, 429, 5xx) leave items queued for the next flush. Permanent
// rejections (400/404/422: bad batch or the person was deleted) are acked away so one bad batch
// can't block the queue forever. Message text is never logged.
import { ApiError } from '../../api/client';
import type { LvsCapturePlugin, QueuedCapture } from '../../native/capture';
import { importMessages, type Uploader } from './api';

export interface FlushResult {
  uploaded: number;
  dropped: number;
  imports: number;
  /** Items still queued because of a transient error. */
  kept: number;
  error?: string;
}

const PERMANENT = new Set([400, 404, 422]);

function isPermanent(e: unknown): boolean {
  return e instanceof ApiError && PERMANENT.has(e.status);
}

let inflight: Promise<FlushResult> | null = null;

/** Flush the queue; concurrent calls share one run. */
export function flushQueue(
  plugin: Pick<LvsCapturePlugin, 'drain' | 'ack'>,
  upload: Uploader = importMessages,
  opts: { batch?: number; maxRounds?: number } = {},
): Promise<FlushResult> {
  if (!inflight) {
    inflight = runFlush(plugin, upload, opts.batch ?? 500, opts.maxRounds ?? 20).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runFlush(
  plugin: Pick<LvsCapturePlugin, 'drain' | 'ack'>,
  upload: Uploader,
  batch: number,
  maxRounds: number,
): Promise<FlushResult> {
  const r: FlushResult = { uploaded: 0, dropped: 0, imports: 0, kept: 0 };
  for (let round = 0; round < maxRounds; round++) {
    const { items } = await plugin.drain({ max: batch });
    if (!items.length) break;
    const blank = items.filter((i) => !i.text || !i.text.trim());
    if (blank.length) {
      await plugin.ack({ ids: blank.map((i) => i.id) });
      r.dropped += blank.length;
    }
    const groups = new Map<string, QueuedCapture[]>();
    for (const it of items) {
      if (!it.text || !it.text.trim()) continue;
      const k = `${it.pid}|${it.source}|${it.tz}`;
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    let progressed = blank.length > 0;
    for (const g of groups.values()) {
      const { pid, source, tz } = g[0];
      try {
        await upload(pid, {
          source,
          tz,
          messages: g.map((m) => ({
            ...(m.ts_utc ? { ts_utc: m.ts_utc } : { ts_local: m.ts_local }),
            ts_precision: m.ts_precision,
            role: m.role,
            text: m.text,
          })),
        });
        await plugin.ack({ ids: g.map((m) => m.id) });
        r.uploaded += g.length;
        r.imports += 1;
        progressed = true;
      } catch (e) {
        if (isPermanent(e)) {
          await plugin.ack({ ids: g.map((m) => m.id) });
          r.dropped += g.length;
          progressed = true;
        } else {
          r.kept += g.length;
          r.error = e instanceof Error ? e.message : 'Upload failed';
          return r; // offline / signed out / server trouble: try again later
        }
      }
    }
    if (!progressed) break;
  }
  return r;
}
