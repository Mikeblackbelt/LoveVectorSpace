export type Platform = "whatsapp" | "discord" | "instagram" | "tinder" | "grindr";
export const PLATFORMS: Platform[] = ["whatsapp", "discord", "instagram", "tinder", "grindr"];
export type TsPrecision = "second" | "minute" | "approx";
export type Direction = "outgoing" | "incoming";

export interface CapturedMessage {
  platform_msg_id?: string;
  ts_local?: string; // browser-local wall clock "YYYY-MM-DDTHH:mm[:ss]" (converted server-side with the batch tz)
  ts_utc?: string; // ISO-8601 UTC with Z
  ts_precision: TsPrecision;
  direction: Direction;
  speaker_raw: string;
  text: string;
}

export type Health = { ok: true } | { ok: false; reason: string };
export type Anomaly = "login" | "captcha" | "error_banner";

export interface SiteAdapter {
  platform: Platform;
  matches(url: string): boolean;
  currentChat(): { chat_key: string; title: string } | null;
  findMessageList(): Element | null;
  /** All message-ish rows currently in the list, oldest first. */
  rows(): Element[];
  extract(node: Element): CapturedMessage | null;
  /** Scroll the message pane up one step. Resolves true if older content loaded, false at chat start. */
  scrollStep(): Promise<boolean>;
  healthCheck(): Health;
  /** Login / captcha / challenge / error banner present, or null. */
  anomaly(): Anomaly | null;
}

export interface QueueItem {
  id: number;
  platform: Platform;
  chat_key: string;
  tz: string;
  msg: CapturedMessage;
}

/** Anything that accepts captured messages (the background queue, or a test double). */
export interface MessageSink {
  enqueue(platform: Platform, chat_key: string, tz: string, msgs: CapturedMessage[]): Promise<boolean> | boolean;
}

export type Selectors = Record<string, string>;
