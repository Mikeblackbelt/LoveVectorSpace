import type { CapturedMessage, MessageSink, Platform, QueueItem } from "./adapters/types";
import { ApiError, type CaptureBatch } from "./api";
import { getKey, setKey } from "./storage";

export const QUEUE_CAP = 5000;
export const BATCH_MAX = 200;
export const MIN_FLUSH_MS = 30_000;
export const MAX_TEXT = 4000;
const TRUNC_MARK = "…[truncated]";

export const clampText = (t: string): string => (t.length <= MAX_TEXT ? t : t.slice(0, MAX_TEXT - TRUNC_MARK.length) + TRUNC_MARK);

type IngestFn = (b: CaptureBatch) => Promise<unknown>;

export interface FlushResult {
  sent: number;
  error?: string;
  dropped_unlinked?: string[];
}

/** Persistent capture queue in chrome.storage.local. Owned by the background worker; all ops are serialised. */
export class Queue implements MessageSink {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private now: () => number = Date.now) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async length(): Promise<number> {
    return (await getKey<QueueItem[]>("queue", [])).length;
  }

  async isFull(): Promise<boolean> {
    return getKey<boolean>("queue_full", false);
  }

  /**
   * Accepts or rejects the whole batch. Returns false (and flags the popup) when it would pass the cap or
   * storage refuses the write, so callers keep the rows unseen and read them again later.
   */
  enqueue(platform: Platform, chat_key: string, tz: string, msgs: CapturedMessage[]): Promise<boolean> {
    return this.serial(async () => {
      try {
        const q = await getKey<QueueItem[]>("queue", []);
        if (q.length + msgs.length > QUEUE_CAP) {
          await setKey("queue_full", true);
          return false;
        }
        let nextId = await getKey<number>("queue_next_id", 1);
        for (const msg of msgs) q.push({ id: nextId++, platform, chat_key, tz, msg: { ...msg, text: clampText(msg.text) } });
        await setKey("queue", q);
        await setKey("queue_next_id", nextId);
        if (q.length >= QUEUE_CAP) await setKey("queue_full", true);
        return true;
      } catch {
        // chrome.storage.local quota (or other write failure): pause capture and warn in the popup.
        try {
          await setKey("storage_error", true);
        } catch {
          /* nothing more we can do */
        }
        return false;
      }
    });
  }

  /**
   * Send queued items in batches of <= 200 (one chat per batch), at most once per 30 s unless forced.
   * Removes only the items the server acknowledged.
   */
  flush(ingest: IngestFn, force = false): Promise<FlushResult> {
    return this.serial(async () => {
      const lastAt = (await getKey<{ at: number } | null>("flush_attempt", null))?.at ?? 0;
      if (!force && this.now() - lastAt < MIN_FLUSH_MS) return { sent: 0 };
      await setKey("flush_attempt", { at: this.now() });
      let sent = 0;
      let size = BATCH_MAX;
      const dropped: string[] = [];
      for (;;) {
        const q = await getKey<QueueItem[]>("queue", []);
        if (q.length === 0) break;
        const head = q[0];
        const batchItems = q
          .filter((i) => i.platform === head.platform && i.chat_key === head.chat_key && i.tz === head.tz)
          .slice(0, size);
        const ids = new Set(batchItems.map((i) => i.id));
        try {
          await ingest({ platform: head.platform, chat_key: head.chat_key, tz: head.tz, messages: batchItems.map((i) => i.msg) });
        } catch (e) {
          if (e instanceof ApiError && (e.status === 413 || e.status === 422)) {
            // Poison batch: halve until it fits or is accepted; a single message that still fails is dropped and counted.
            if (batchItems.length > 1) {
              size = Math.max(1, Math.floor(batchItems.length / 2));
              continue;
            }
            await setKey(
              "queue",
              q.filter((i) => !ids.has(i.id)),
            );
            await setKey("rejected_count", (await getKey<number>("rejected_count", 0)) + 1);
            continue;
          }
          if (e instanceof ApiError && e.code === "chat_not_linked") {
            // The server no longer has this chat linked: drop its items instead of retrying forever.
            dropped.push(`${head.platform}:${head.chat_key}`);
            await setKey(
              "queue",
              q.filter((i) => !(i.platform === head.platform && i.chat_key === head.chat_key)),
            );
            continue;
          }
          await this.afterFlush(q.length);
          await setKey("last_flush", { at: this.now(), sent, error: e instanceof Error ? e.message : String(e) });
          return { sent, error: e instanceof Error ? e.message : String(e), dropped_unlinked: dropped };
        }
        await setKey(
          "queue",
          q.filter((i) => !ids.has(i.id)),
        );
        sent += batchItems.length;
        size = Math.min(BATCH_MAX, size * 2);
      }
      await this.afterFlush((await getKey<QueueItem[]>("queue", [])).length);
      await setKey("last_flush", { at: this.now(), sent });
      return { sent, dropped_unlinked: dropped };
    });
  }

  private async afterFlush(len: number): Promise<void> {
    if (len < QUEUE_CAP * 0.9) {
      await setKey("queue_full", false);
      await setKey("storage_error", false);
    }
  }
}
