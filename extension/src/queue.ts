import type { CapturedMessage, MessageSink, Platform, QueueItem } from "./adapters/types";
import { ApiError, type CaptureBatch } from "./api";
import { getKey, setKey } from "./storage";

export const QUEUE_CAP = 5000;
export const BATCH_MAX = 200;
export const MIN_FLUSH_MS = 30_000;

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

  /** Returns false when the cap was hit (capture is then paused and the popup warns). */
  enqueue(platform: Platform, chat_key: string, tz: string, msgs: CapturedMessage[]): Promise<boolean> {
    return this.serial(async () => {
      const q = await getKey<QueueItem[]>("queue", []);
      let nextId = await getKey<number>("queue_next_id", 1);
      let accepted = true;
      for (const msg of msgs) {
        if (q.length >= QUEUE_CAP) {
          accepted = false;
          break;
        }
        q.push({ id: nextId++, platform, chat_key, tz, msg });
      }
      await setKey("queue", q);
      await setKey("queue_next_id", nextId);
      if (!accepted || q.length >= QUEUE_CAP) await setKey("queue_full", true);
      return accepted;
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
      const dropped: string[] = [];
      for (;;) {
        const q = await getKey<QueueItem[]>("queue", []);
        if (q.length === 0) break;
        const head = q[0];
        const batchItems = q
          .filter((i) => i.platform === head.platform && i.chat_key === head.chat_key && i.tz === head.tz)
          .slice(0, BATCH_MAX);
        const ids = new Set(batchItems.map((i) => i.id));
        try {
          await ingest({ platform: head.platform, chat_key: head.chat_key, tz: head.tz, messages: batchItems.map((i) => i.msg) });
        } catch (e) {
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
      }
      await this.afterFlush((await getKey<QueueItem[]>("queue", [])).length);
      await setKey("last_flush", { at: this.now(), sent });
      return { sent, dropped_unlinked: dropped };
    });
  }

  private async afterFlush(len: number): Promise<void> {
    if (len < QUEUE_CAP * 0.9) await setKey("queue_full", false);
  }
}
