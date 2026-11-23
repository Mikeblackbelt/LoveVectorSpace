import type { CapturedMessage, MessageSink, SiteAdapter } from "../adapters/types";
import type { RateLimiter, RunGuard } from "../ratelimit";
import { Harvester, scrollHarvestLoop, tsMillis, type LoopDeps, type StopReason } from "./common";

export interface ImportResult {
  reason: StopReason;
  count: number;
}

/**
 * "Import this page": one-shot read of the open chat, optionally scrolling back to a date (same rate limit,
 * step cap and anomaly stops as backfill). Messages are collected locally and handed to `upload` as one unit,
 * also when the run stops early, so an interrupted import still delivers what was read.
 */
export async function runImport(
  adapter: SiteAdapter,
  until: Date | null,
  limiter: RateLimiter,
  guard: RunGuard,
  deps: Omit<LoopDeps, "sink">,
  upload: (msgs: CapturedMessage[]) => Promise<void>,
): Promise<ImportResult> {
  const msgs: CapturedMessage[] = [];
  const sink: MessageSink = {
    enqueue: (_p, _k, _tz, batch) => {
      msgs.push(...batch);
      return true;
    },
  };
  guard.begin();
  let reason: StopReason;
  try {
    if (until === null) {
      const chat = adapter.currentChat();
      const anomaly = adapter.anomaly();
      if (anomaly) reason = anomaly;
      else if (!adapter.healthCheck().ok) reason = "health_failure";
      else if (!chat) reason = "chat_closed";
      else {
        await new Harvester(adapter, sink, deps.tz).harvest();
        reason = "done";
      }
    } else {
      let oldest: number | null = null;
      reason = await scrollHarvestLoop(adapter, limiter, guard, { ...deps, sink }, (h) => {
        for (const m of h.visible) {
          const t = tsMillis(m);
          if (t !== null && (oldest === null || t < oldest)) oldest = t;
        }
        return oldest !== null && oldest <= until.getTime() ? "until_date" : null;
      });
    }
  } finally {
    guard.end();
  }
  if (msgs.length) {
    try {
      await upload(msgs);
    } catch {
      return { reason: "upload_failed", count: 0 };
    }
  }
  return { reason, count: msgs.length };
}
