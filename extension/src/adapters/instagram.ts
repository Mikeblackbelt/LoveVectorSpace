import sel from "./instagram.selectors.json";
import { anomalyOf, defaultCtx, missing, qs, scrollUpAndWait, textOf, type PageCtx } from "./base";
import { parseLooseTimestamp } from "./time";
import type { CapturedMessage, Health, SiteAdapter } from "./types";

const DM_PATH = /^\/direct\/t\/([^/]+)/;

export function createInstagramAdapter(ctx: PageCtx = defaultCtx()): SiteAdapter {
  const list = () => qs(ctx.doc, sel.messageList);
  const rows = () => (list() ? Array.from(list()!.querySelectorAll(sel.row)) : []);
  const title = () => textOf(qs(ctx.doc, sel.chatTitle));

  /** Timestamps only appear between message groups: use the nearest one above the message. */
  function groupTime(node: Element): string | null {
    for (let el = node.previousElementSibling; el; el = el.previousElementSibling) {
      const t = el.querySelector(sel.timeSeparator);
      if (t) return parseLooseTimestamp(textOf(t), ctx.now?.() ?? new Date());
    }
    return null;
  }

  return {
    platform: "instagram",
    matches: (url) => {
      try {
        const u = new URL(url);
        return u.hostname === "www.instagram.com" && u.pathname.startsWith("/direct/");
      } catch {
        return false;
      }
    },
    currentChat() {
      const m = DM_PATH.exec(new URL(ctx.url()).pathname);
      if (!m || !list()) return null;
      return { chat_key: m[1], title: title() || m[1] };
    },
    findMessageList: list,
    rows,
    extract(node): CapturedMessage | null {
      if (node.querySelector(sel.timeSeparator)) return null; // separator row
      const bubble = node.querySelector(sel.bubble);
      if (!bubble) return null; // system lines, "seen" markers
      const text = textOf(bubble.querySelector(sel.text));
      if (!text) return null; // media, reactions, shared posts
      const ts = groupTime(node);
      if (!ts) return null;
      const out = node.querySelector(sel.outgoing) !== null;
      return {
        ts_local: ts,
        ts_precision: "approx",
        direction: out ? "outgoing" : "incoming",
        speaker_raw: out ? "me" : title() || "them",
        text,
      };
    },
    scrollStep: () => scrollUpAndWait(qs(ctx.doc, sel.scroller), () => rows().length, ctx.loadWaitMs ?? 3000),
    healthCheck(): Health {
      if (!qs(ctx.doc, sel.shell)) return missing("shell");
      if (!DM_PATH.test(new URL(ctx.url()).pathname)) return { ok: true };
      if (!list()) return missing("messageList");
      return { ok: true };
    },
    anomaly: () => anomalyOf(ctx.doc, sel),
  };
}
