import type { CapturedMessage, MessageSink, SiteAdapter } from "../adapters/types";
import type { RateLimiter, RunGuard } from "../ratelimit";
import { SeenSet } from "./seen";
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
  upload: (msgs: CapturedMessage[], meta: { direction_uncertain: boolean }) => Promise<void>,
): Promise<ImportResult> {
  const msgs: CapturedMessage[] = [];
  let uncertain = false;
  const sink: MessageSink = {
    enqueue: (_p, _k, _tz, batch, meta) => {
      if (meta?.direction_uncertain) uncertain = true;
      msgs.push(...batch);
      return true;
    },
  };
  // Keys stay staged until the upload succeeds, so a failed upload does not make messages look captured.
  const seen = deps.seen ?? new SeenSet(null);
  const d = { ...deps, seen, deferSeen: true };
  let reason: StopReason;
  // Only a run that scrolls is rate-limited and subject to the per-platform cool-down.
  if (until !== null && !guard.begin()) return { reason: "cooldown", count: 0 };
  try {
    if (until === null) {
      const anomaly = adapter.anomaly();
      if (anomaly) reason = anomaly;
      else if (!adapter.healthCheck().ok) reason = "health_failure";
      else {
        const h = await new Harvester(adapter, sink, deps.tz, d).harvest();
        reason = h.stop ?? "done";
      }
    } else {
      let oldest: number | null = null;
      reason = await scrollHarvestLoop(adapter, limiter, guard, { ...d, sink }, (h) => {
        for (const m of h.visible) {
          const t = tsMillis(m);
          if (t !== null && (oldest === null || t < oldest)) oldest = t;
        }
        return oldest !== null && oldest <= until.getTime() ? "until_date" : null;
      });
    }
  } finally {
    if (until !== null) guard.end();
  }
  if (msgs.length) {
    try {
      await upload(msgs, { direction_uncertain: uncertain });
    } catch {
      seen.rollback();
      return { reason: "upload_failed", count: 0 };
    }
  }
  await seen.commit();
  return { reason, count: msgs.length };
}
