// Flushing the native encrypted capture queue to the server.
//
// drain(userId) -> group by (person, source, tz, contact) -> split by count/bytes -> POST
// /imports/messages -> ack() on success. Only the owning account can drain (native check).
//   - offline / 401 / 429 / 5xx: stop, everything not yet sent stays queued;
//   - 413: split the batch in half and retry;
//   - 422 / 400 on messages: bisect to isolate the bad message(s), drop only those;
//   - 404 (person gone) / other 400: drop that batch.
// A per-contact delete aborts that contact's in-flight batch. Message text is never logged.
import { ApiError } from '../../api/client';
import type { LvsCapturePlugin, QueuedCapture } from '../../native/capture';
import { importMessages, type Uploader } from './api';
import { splitBatches, truncateText } from './batches';
import type { WireMessage } from './types';

export interface FlushResult {
  uploaded: number;
  dropped: number;
  imports: number;
  /** Items still queued because of a transient error. */
  kept: number;
  error?: string;
}

type Item = { q: QueuedCapture; msg: WireMessage };

const inflightByContact = new Map<string, Set<AbortController>>();

/** Abort any upload in progress for this contact key (used by per-contact delete/unlink). */
export function cancelContactUploads(ck: string): void {
  inflightByContact.get(ck)?.forEach((c) => c.abort());
}

function track(ck: string, c: AbortController): () => void {
  const s = inflightByContact.get(ck) ?? new Set<AbortController>();
  s.add(c);
  inflightByContact.set(ck, s);
  return () => {
    s.delete(c);
    if (!s.size) inflightByContact.delete(ck);
  };
}

let inflight: Promise<FlushResult> | null = null;

/** Flush the queue for `userId`; concurrent calls share one run. */
export function flushQueue(
  plugin: Pick<LvsCapturePlugin, 'drain' | 'ack'>,
  userId: string,
  upload: Uploader = importMessages,
  opts: { batch?: number; maxRounds?: number } = {},
): Promise<FlushResult> {
  if (!inflight) {
    inflight = runFlush(plugin, userId, upload, opts.batch ?? 500, opts.maxRounds ?? 20).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

function toItem(q: QueuedCapture): Item {
  return {
    q,
    msg: {
      ...(q.ts_utc ? { ts_utc: q.ts_utc } : { ts_local: q.ts_local }),
      ts_precision: q.ts_precision,
      role: q.role,
      text: truncateText(q.text),
    },
  };
}

interface SendResult {
  ok: Item[];
  bad: Item[];
  transient?: unknown;
}

function isolatable(e: ApiError): boolean {
  return e.status === 422 || (e.status === 400 && e.field === 'messages');
}

/** POST one batch, splitting on 413 and bisecting on per-message validation errors. */
export async function sendIsolating(
  pid: number, source: string, tz: string, items: Item[], upload: Uploader, signal?: AbortSignal,
): Promise<SendResult> {
  try {
    await upload(pid, { source, tz, messages: items.map((i) => i.msg) }, signal);
    return { ok: items, bad: [] };
  } catch (e) {
    if (signal?.aborted) return { ok: [], bad: [], transient: e };
    if (e instanceof ApiError && (e.status === 413 || isolatable(e))) {
      if (items.length === 1) return { ok: [], bad: items };
      const mid = Math.ceil(items.length / 2);
      const a = await sendIsolating(pid, source, tz, items.slice(0, mid), upload, signal);
      if (a.transient) return a;
      const b = await sendIsolating(pid, source, tz, items.slice(mid), upload, signal);
      return { ok: [...a.ok, ...b.ok], bad: [...a.bad, ...b.bad], transient: b.transient };
    }
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return { ok: [], bad: items };
    return { ok: [], bad: [], transient: e };
  }
}

async function runFlush(
  plugin: Pick<LvsCapturePlugin, 'drain' | 'ack'>,
  userId: string,
  upload: Uploader,
  batch: number,
  maxRounds: number,
): Promise<FlushResult> {
  const r: FlushResult = { uploaded: 0, dropped: 0, imports: 0, kept: 0 };
  for (let round = 0; round < maxRounds; round++) {
    let items: QueuedCapture[];
    try {
      ({ items } = await plugin.drain({ max: batch, userId }));
    } catch (e) {
      r.error = e instanceof Error ? e.message : 'Queue unavailable';
      return r; // e.g. owner mismatch: never hand one account's queue to another
    }
    if (!items.length) break;
    const blank = items.filter((i) => !i.text || !i.text.trim());
    if (blank.length) {
      await plugin.ack({ ids: blank.map((i) => i.id) });
      r.dropped += blank.length;
    }
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      if (!it.text || !it.text.trim()) continue;
      const k = `${it.pid}|${it.source}|${it.tz}|${it.ck}`;
      groups.set(k, [...(groups.get(k) ?? []), toItem(it)]);
    }
    let progressed = blank.length > 0;
    for (const g of groups.values()) {
      const { pid, source, tz, ck } = g[0].q;
      const ctrl = new AbortController();
      const untrack = track(ck, ctrl);
      try {
        for (const part of splitBatches(g)) {
          if (ctrl.signal.aborted) break;
          const s = await sendIsolating(pid, source, tz, part, upload, ctrl.signal);
          const done = [...s.ok, ...s.bad].map((i) => i.q.id);
          if (done.length) await plugin.ack({ ids: done });
          r.uploaded += s.ok.length;
          r.dropped += s.bad.length;
          if (s.ok.length) r.imports += 1;
          if (done.length) progressed = true;
          if (s.transient) {
            if (ctrl.signal.aborted) break; // contact deleted mid-upload: its items are gone natively
            r.kept += part.length - done.length;
            r.error = s.transient instanceof Error ? s.transient.message : 'Upload failed';
            return r; // offline / signed out / server trouble: try again later
          }
        }
      } finally {
        untrack();
      }
    }
    if (!progressed) break;
  }
  return r;
}
