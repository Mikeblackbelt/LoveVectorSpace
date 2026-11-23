import type { CapturedMessage, MessageSink, SiteAdapter } from "../adapters/types";
import type { RateLimiter, RunGuard } from "../ratelimit";

export type StopReason =
  | "until_date"
  | "chat_start"
  | "login"
  | "captcha"
  | "error_banner"
  | "health_failure"
  | "tab_hidden"
  | "max_steps"
  | "cooldown"
  | "queue_full"
  | "chat_closed"
  | "anchor_found"
  | "no_anchor"
  | "stopped";

export interface LoopDeps {
  sink: MessageSink;
  tz: string;
  isHidden?: () => boolean;
  now?: () => number;
  onStep?: (step: number) => void;
  shouldStop?: () => boolean;
}

export const tsMillis = (m: CapturedMessage): number | null => {
  const v = m.ts_utc ? Date.parse(m.ts_utc) : m.ts_local ? new Date(m.ts_local).getTime() : NaN;
  return Number.isNaN(v) ? null : v;
};

export interface HarvestResult {
  visible: CapturedMessage[];
  fresh: number;
  accepted: boolean;
}

/** Reads rows from the page (read-only) and hands unseen ones to the sink. */
export class Harvester {
  private seen = new WeakSet<Element>();
  private seenIds = new Set<string>();
  constructor(
    private adapter: SiteAdapter,
    private sink: MessageSink,
    private tz: string,
  ) {}

  /** Mark everything on screen as seen without capturing it (used while paused). */
  skipVisible(): void {
    for (const r of this.adapter.rows()) this.seen.add(r);
  }

  async harvest(): Promise<HarvestResult> {
    const chat = this.adapter.currentChat();
    const visible: CapturedMessage[] = [];
    const fresh: CapturedMessage[] = [];
    for (const row of this.adapter.rows()) {
      const msg = this.adapter.extract(row);
      if (!msg) continue;
      visible.push(msg);
      if (this.seen.has(row)) continue;
      this.seen.add(row);
      if (msg.platform_msg_id) {
        if (this.seenIds.has(msg.platform_msg_id)) continue;
        this.seenIds.add(msg.platform_msg_id);
      }
      fresh.push(msg);
    }
    let accepted = true;
    if (chat && fresh.length) accepted = (await this.sink.enqueue(this.adapter.platform, chat.chat_key, this.tz, fresh)) !== false;
    return { visible, fresh: fresh.length, accepted };
  }
}

/**
 * Shared scroll-up loop: harvest, test the stop condition, spend one step, wait (jittered), scroll.
 * Stops on anomalies (login, captcha, error banner), a failing health check, a long-hidden tab or a full queue.
 */
export async function scrollHarvestLoop(
  adapter: SiteAdapter,
  limiter: RateLimiter,
  guard: RunGuard,
  deps: LoopDeps,
  check: (h: HarvestResult) => StopReason | null,
): Promise<StopReason> {
  const now = deps.now ?? Date.now;
  const harvester = new Harvester(adapter, deps.sink, deps.tz);
  let hiddenSince: number | null = null;
  for (;;) {
    if (deps.shouldStop?.()) return "stopped";
    const anomaly = adapter.anomaly();
    if (anomaly) return anomaly;
    if (!adapter.healthCheck().ok) return "health_failure";
    if (deps.isHidden?.()) {
      hiddenSince ??= now();
      if (now() - hiddenSince > 60_000) return "tab_hidden";
    } else hiddenSince = null;
    if (!adapter.currentChat()) return "chat_closed";
    const h = await harvester.harvest();
    if (!h.accepted) return "queue_full";
    const stop = check(h);
    if (stop) return stop;
    if (!guard.step()) return "max_steps";
    deps.onStep?.(guard.stepCount);
    await limiter.wait();
    if (!(await adapter.scrollStep())) return "chat_start";
  }
}
