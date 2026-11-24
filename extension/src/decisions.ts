import type { RunGuard } from "./ratelimit";

export const CATCHUP_COOLDOWN_MS = 2 * 60 * 1000;

export type CatchupDecision = "go" | "skip_unlinked" | "skip_disabled" | "skip_busy" | "skip_cooldown";

/**
 * Whether opening a chat should trigger catch-up (and so a /api/ext/summary call). The order matters for
 * privacy: a chat that is not linked locally is never sent to the server, whatever the other settings are.
 */
export function catchupDecision(i: {
  linkedLocally: boolean;
  catchupEnabled: boolean;
  allowed: "ok" | "paused" | "full";
  running: boolean;
  lastAt: number;
  now: number;
}): CatchupDecision {
  if (!i.linkedLocally) return "skip_unlinked";
  if (!i.catchupEnabled || i.allowed !== "ok") return "skip_disabled";
  if (i.running) return "skip_busy";
  if (i.now - i.lastAt < CATCHUP_COOLDOWN_MS) return "skip_cooldown";
  return "go";
}

/** Backfill always scrolls; an import scrolls only with a "back to" date. Scrolling runs obey the platform cool-down. */
export function scrollRunBlocked(scrolls: boolean, guard: RunGuard): "cooldown" | null {
  return scrolls && !guard.canStart() ? "cooldown" : null;
}
