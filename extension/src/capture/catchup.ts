import type { SiteAdapter } from "../adapters/types";
import { RunGuard, type RateLimiter } from "../ratelimit";
import { scrollHarvestLoop, type LoopDeps, type StopReason } from "./common";

export const CATCHUP_MAX_STEPS = 50;

/**
 * Bounded catch-up after opening a linked chat: scroll up (same rate limit as backfill) until one of the
 * server's last captured message ids is visible. With no anchor ids there is nothing to compare against.
 */
export async function runCatchup(
  adapter: SiteAdapter,
  lastCapturedIds: string[],
  limiter: RateLimiter,
  deps: LoopDeps,
): Promise<StopReason> {
  if (lastCapturedIds.length === 0) return "no_anchor";
  const anchors = new Set(lastCapturedIds);
  const guard = new RunGuard(CATCHUP_MAX_STEPS, 0, deps.now);
  guard.begin();
  try {
    return await scrollHarvestLoop(adapter, limiter, guard, deps, (h) =>
      h.visible.some((m) => m.platform_msg_id && anchors.has(m.platform_msg_id)) ? "anchor_found" : null,
    );
  } finally {
    guard.end();
  }
}
