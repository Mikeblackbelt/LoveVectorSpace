import type { SiteAdapter } from "../adapters/types";
import type { RateLimiter, RunGuard } from "../ratelimit";
import { scrollHarvestLoop, tsMillis, type LoopDeps, type StopReason } from "./common";

export const BACKFILL_MAX_STEPS = 300;
export const BACKFILL_COOLDOWN_MS = 10 * 60 * 1000;

/** Scroll a linked chat upward, capturing as it loads. Returns why it stopped. */
export async function runBackfill(
  adapter: SiteAdapter,
  untilDate: Date,
  limiter: RateLimiter,
  guard: RunGuard,
  deps: LoopDeps,
): Promise<StopReason> {
  if (!guard.begin()) return "cooldown";
  let oldest: number | null = null;
  try {
    return await scrollHarvestLoop(adapter, limiter, guard, deps, (h) => {
      for (const m of h.visible) {
        const t = tsMillis(m);
        if (t !== null && (oldest === null || t < oldest)) oldest = t;
      }
      return oldest !== null && oldest <= untilDate.getTime() ? "until_date" : null;
    });
  } finally {
    guard.end();
  }
}
