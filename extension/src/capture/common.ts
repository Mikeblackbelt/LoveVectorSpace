import type { CapturedMessage, MessageSink, SiteAdapter } from "../adapters/types";
import type { RateLimiter, RunGuard } from "../ratelimit";
import { SeenSet, seenKeys } from "./seen";

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
  | "chat_changed"
  | "not_linked"
  | "anchor_found"
  | "no_anchor"
  | "stopped"
  | "done"
  | "upload_failed";

export interface LoopDeps {
  sink: MessageSink;
  tz: string;
  /** The chat the run started on. The run stops as soon as the open chat differs. */
  chatKey: string;
  /** Re-checked on every harvest: rows of an unlinked chat are never read. */
  isLinked: (chat_key: string) => boolean | Promise<boolean>;
  seen?: SeenSet;
  /** Keep new keys staged until the caller commits (import: only after a successful upload). */
  deferSeen?: boolean;
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
  /** Set when nothing was read because the chat changed or is not linked. */
  stop?: "chat_changed" | "not_linked" | "chat_closed";
}

export interface HarvestOpts {
  chatKey: string;
  isLinked: (chat_key: string) => boolean | Promise<boolean>;
  seen?: SeenSet;
  deferSeen?: boolean;
}

/**
 * Reads rows from the page (read-only) and hands unseen ones to the sink as one batch.
 * Bound to one chat: it re-checks the open chat and its link before every read.
 */
export class Harvester {
  private seenRows = new WeakSet<Element>();
  private seen: SeenSet;
  constructor(
    private adapter: SiteAdapter,
    private sink: MessageSink,
    private tz: string,
    private opts: HarvestOpts,
  ) {
    this.seen = opts.seen ?? new SeenSet(null);
  }

  private async guard(): Promise<HarvestResult["stop"] | undefined> {
    if (!(await this.opts.isLinked(this.opts.chatKey))) return "not_linked";
    const chat = this.adapter.currentChat();
    if (!chat) return "chat_closed";
    if (chat.chat_key !== this.opts.chatKey) return "chat_changed";
    return undefined;
  }

  private read(): { rows: Element[]; msgs: CapturedMessage[]; keys: string[] } {
    const rows: Element[] = [];
    const msgs: CapturedMessage[] = [];
    for (const row of this.adapter.rows()) {
      const m = this.adapter.extract(row);
      if (m) {
        rows.push(row);
        msgs.push(m);
      }
    }
    return { rows, msgs, keys: seenKeys(msgs) };
  }

  /** Mark everything on screen as seen without capturing it (used while paused). */
  async skipVisible(): Promise<void> {
    if (await this.guard()) return;
    const { rows, keys } = this.read();
    for (const r of rows) this.seenRows.add(r);
    this.seen.stage(keys);
    await this.seen.commit();
  }

  async harvest(): Promise<HarvestResult> {
    const stop = await this.guard();
    if (stop) return { visible: [], fresh: 0, accepted: true, stop };
    // From here to the enqueue call everything is synchronous except the sink itself, and the chat was just verified.
    const { rows, msgs, keys } = this.read();
    const fresh: number[] = [];
    msgs.forEach((_m, i) => {
      if (!this.seenRows.has(rows[i]) && !this.seen.has(keys[i])) fresh.push(i);
    });
    let accepted = true;
    if (fresh.length) {
      accepted = (await this.sink.enqueue(this.adapter.platform, this.opts.chatKey, this.tz, fresh.map((i) => msgs[i]), this.adapter.directionUncertain?.() ? { direction_uncertain: true } : undefined)) !== false;
      if (accepted) {
        for (const i of fresh) this.seenRows.add(rows[i]);
        this.seen.stage(fresh.map((i) => keys[i]));
        if (!this.opts.deferSeen) await this.seen.commit();
      }
    }
    return { visible: msgs, fresh: fresh.length, accepted };
  }
}

/**
 * Shared scroll-up loop: harvest, test the stop condition, spend one step, wait (jittered), scroll.
 * Stops on anomalies (login, captcha, error banner), a failing health check, a long-hidden tab, a full queue,
 * or the open chat changing / becoming unlinked.
 */
export async function scrollHarvestLoop(
  adapter: SiteAdapter,
  limiter: RateLimiter,
  guard: RunGuard,
  deps: LoopDeps,
  check: (h: HarvestResult) => StopReason | null,
): Promise<StopReason> {
  const now = deps.now ?? Date.now;
  const harvester = new Harvester(adapter, deps.sink, deps.tz, deps);
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
    const h = await harvester.harvest();
    if (h.stop) return h.stop;
    if (!h.accepted) return "queue_full";
    const stop = check(h);
    if (stop) return stop;
    if (!guard.step()) return "max_steps";
    deps.onStep?.(guard.stepCount);
    await limiter.wait();
    // The user may have switched chats while we waited: never scroll or read another chat.
    const chat = adapter.currentChat();
    if (!chat) return "chat_closed";
    if (chat.chat_key !== deps.chatKey) return "chat_changed";
    if (!(await adapter.scrollStep())) return "chat_start";
  }
}
