import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach } from "vitest";
import type { Anomaly, CapturedMessage, MessageSink, Platform, SiteAdapter } from "../src/adapters/types";

export const store: Record<string, unknown> = {};

/** In-memory chrome.storage.local. */
export function installChromeMock(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        async get(key: string) {
          return key in store ? { [key]: structuredClone(store[key]) } : {};
        },
        async set(obj: Record<string, unknown>) {
          for (const [k, v] of Object.entries(obj)) store[k] = structuredClone(v);
        },
      },
    },
  };
}
export function useChromeMock(): void {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    installChromeMock();
  });
}

export function loadFixture(platform: Platform, name = "chat"): void {
  document.body.innerHTML = readFileSync(resolve(__dirname, "fixtures", platform, `${name}.html`), "utf8");
}

export class CollectSink implements MessageSink {
  items: { platform: Platform; chat_key: string; tz: string; msg: CapturedMessage }[] = [];
  enqueue(platform: Platform, chat_key: string, tz: string, msgs: CapturedMessage[]): boolean {
    for (const msg of msgs) this.items.push({ platform, chat_key, tz, msg });
    return true;
  }
}

/** Adapter over synthetic nodes: each scrollStep reveals the next older page. */
export function fakeAdapter(pages: CapturedMessage[][], infinite?: () => CapturedMessage[]) {
  const map = new Map<Element, CapturedMessage>();
  let rows: Element[] = [];
  let next = 0;
  let scrolls = 0;
  let anomaly: Anomaly | null = null;
  let chat = "k";
  let onScroll: (() => void) | null = null;
  const reveal = (msgs: CapturedMessage[]) => {
    const els = msgs.map((m) => {
      const el = document.createElement("div");
      map.set(el, m);
      return el;
    });
    rows = [...els, ...rows];
  };
  reveal(pages[next++]);
  const adapter: SiteAdapter & { scrolls: () => number; setAnomaly: (a: Anomaly | null) => void; setChat: (k: string) => void; onScroll: (f: () => void) => void } = {
    platform: "whatsapp",
    matches: () => true,
    currentChat: () => ({ chat_key: chat, title: "t" }),
    findMessageList: () => document.body,
    rows: () => rows,
    extract: (n) => map.get(n) ?? null,
    async scrollStep() {
      scrolls++;
      onScroll?.();
      if (next < pages.length) {
        reveal(pages[next++]);
        return true;
      }
      if (infinite) {
        reveal(infinite());
        return true;
      }
      return false;
    },
    healthCheck: () => ({ ok: true }),
    anomaly: () => anomaly,
    scrolls: () => scrolls,
    setChat: (k) => void (chat = k),
    onScroll: (f) => void (onScroll = f),
    setAnomaly: (a) => {
      anomaly = a;
    },
  };
  return adapter;
}

export const msg = (id: string, iso: string, extra: Partial<CapturedMessage> = {}): CapturedMessage => ({
  platform_msg_id: id,
  ts_utc: iso,
  ts_precision: "second",
  direction: "incoming",
  speaker_raw: "x",
  text: `t${id}`,
  ...extra,
});
