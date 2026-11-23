import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { BATCH_MAX, Queue, QUEUE_CAP } from "../src/queue";
import { RateLimiter, RunGuard } from "../src/ratelimit";
import { getKey } from "../src/storage";
import type { CapturedMessage, QueueItem } from "../src/adapters/types";
import { useChromeMock } from "./helpers";

useChromeMock();
const m = (i: number): CapturedMessage => ({ ts_utc: "2026-11-22T00:00:00Z", ts_precision: "second", direction: "incoming", speaker_raw: "a", text: `m${i}` });
const many = (n: number) => Array.from({ length: n }, (_, i) => m(i));

describe("queue", () => {
  it("queue caps and pauses", async () => {
    const q = new Queue();
    expect(await q.enqueue("discord", "c", "UTC", many(QUEUE_CAP))).toBe(true);
    expect(await q.isFull()).toBe(true); // full at the cap: capture pauses, popup warns
    expect(await q.enqueue("discord", "c", "UTC", many(3))).toBe(false);
    expect(await q.length()).toBe(QUEUE_CAP);
  });

  it("flush batches of 200", async () => {
    const q = new Queue();
    await q.enqueue("discord", "c", "UTC", many(450));
    const sizes: number[] = [];
    const r = await q.flush(async (b) => void sizes.push(b.messages.length), true);
    expect(sizes).toEqual([BATCH_MAX, BATCH_MAX, 50]);
    expect(r.sent).toBe(450);
    expect(await q.length()).toBe(0);
  });

  it("flush clears only acked", async () => {
    const q = new Queue();
    await q.enqueue("discord", "c", "UTC", many(450));
    let calls = 0;
    const r = await q.flush(async () => {
      if (++calls === 2) throw new ApiError(500, "http_error", "boom");
    }, true);
    expect(r.error).toBeTruthy();
    expect(r.sent).toBe(200);
    const left = await getKey<QueueItem[]>("queue", []);
    expect(left).toHaveLength(250);
    expect(left[0].msg.text).toBe("m200");
  });

  it("drops a chat the server says is not linked, keeps the rest", async () => {
    const q = new Queue();
    await q.enqueue("discord", "bad", "UTC", many(2));
    await q.enqueue("discord", "good", "UTC", many(3));
    const sent: string[] = [];
    const r = await q.flush(async (b) => {
      if (b.chat_key === "bad") throw new ApiError(409, "chat_not_linked", "no");
      sent.push(b.chat_key);
    }, true);
    expect(sent).toEqual(["good"]);
    expect(r.dropped_unlinked).toEqual(["discord:bad"]);
    expect(await q.length()).toBe(0);
  });

  it("does not flush more often than every 30 s", async () => {
    let t = 1_000_000;
    const q = new Queue(() => t);
    await q.enqueue("discord", "c", "UTC", many(1));
    const ingest = vi.fn(async () => undefined);
    await q.flush(ingest);
    await q.enqueue("discord", "c", "UTC", many(1));
    t += 10_000;
    await q.flush(ingest);
    expect(ingest).toHaveBeenCalledTimes(1);
    t += 25_000;
    await q.flush(ingest);
    expect(ingest).toHaveBeenCalledTimes(2);
  });
});

describe("rate limiting", () => {
  it("ratelimiter jitter within bounds", async () => {
    for (const r of [0, 0.5, 0.999999]) {
      const d = new RateLimiter(2000, 4000, async () => undefined, () => r).nextDelay();
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
    const slept: number[] = [];
    await new RateLimiter(2000, 4000, async (ms) => void slept.push(ms)).wait();
    expect(slept[0]).toBeGreaterThanOrEqual(2000);
  });

  it("runguard stops at max steps", () => {
    const g = new RunGuard(3, 600_000);
    expect(g.begin()).toBe(true);
    expect([g.step(), g.step(), g.step(), g.step()]).toEqual([true, true, true, false]);
  });

  it("runguard enforces the cool-down between runs", () => {
    let t = 0;
    const g = new RunGuard(3, 600_000, () => t);
    g.begin();
    g.end();
    t = 599_000;
    expect(g.canStart()).toBe(false);
    t = 600_001;
    expect(g.canStart()).toBe(true);
  });
});
