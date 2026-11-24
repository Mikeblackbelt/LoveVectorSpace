import type { CapturedMessage, Platform } from "./adapters/types";
import type { ExtSummary } from "./api";

/** content/popup -> background */
export type BgRequest =
  | { type: "enqueue"; platform: Platform; chat_key: string; tz: string; msgs: CapturedMessage[]; direction_uncertain?: boolean }
  | { type: "summary"; platform: Platform; chat_key: string }
  | { type: "import"; platform: Platform; chat_key: string; tz: string; unit_id: string; msgs: CapturedMessage[]; direction_uncertain?: boolean }
  | { type: "config" }
  | { type: "flush" };

export type BgResponse =
  | { ok: true; accepted?: boolean; waDateFormat?: "auto" | "month_first" | "day_first"; summary?: ExtSummary; sent?: number }
  | { ok: false; code: string; error: string };

/** popup -> content script */
export type TabRequest = { type: "getChat" } | { type: "startBackfill"; until: string }
  | { type: "importPage"; until: string | null } | { type: "stopRun" };

export interface ChatContext {
  platform: Platform;
  chat_key: string | null;
  title: string | null;
  health: { ok: boolean; reason?: string };
  cooldown_left_ms: number;
  direction_uncertain?: boolean;
}

export type TabResponse = { ok: true; chat?: ChatContext; started?: boolean; reason?: string } | { ok: false; error: string };
