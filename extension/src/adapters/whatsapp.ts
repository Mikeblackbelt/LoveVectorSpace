import sel from "./whatsapp.selectors.json";
import { anomalyOf, directionMarkerHealth, oneSided, defaultCtx, missing, qs, scrollUpAndWait, textOf, type PageCtx } from "./base";
import { parseWhatsAppMeta } from "./time";
import type { CapturedMessage, Health, SiteAdapter } from "./types";

export function createWhatsAppAdapter(ctx: PageCtx = defaultCtx()): SiteAdapter {
  const list = () => qs(ctx.doc, sel.messageList);
  const rows = () => (list() ? Array.from(list()!.querySelectorAll(sel.row)) : []);

  const msgRows = () => rows().filter((r) => r.querySelector(sel.meta));
  return {
    platform: "whatsapp",
    matches: (url) => {
      try {
        return new URL(url).hostname === "web.whatsapp.com";
      } catch {
        return false;
      }
    },
    // WhatsApp Web exposes no stable chat id in the URL, so the visible chat title is the key.
    currentChat() {
      const title = textOf(qs(ctx.doc, sel.chatTitle));
      return title && list() ? { chat_key: title, title } : null;
    },
    findMessageList: list,
    rows,
    extract(node): CapturedMessage | null {
      const out = node.querySelector(sel.outgoing);
      const inc = node.querySelector(sel.incoming);
      if (!out && !inc) return null; // date separators, system notices
      const metaEl = node.querySelector(sel.meta);
      const textEl = node.querySelector(sel.text);
      const text = textOf(textEl);
      if (!metaEl || !text) return null; // media-only or unreadable
      const meta = parseWhatsAppMeta(metaEl.getAttribute("data-pre-plain-text") ?? "", ctx.dateFormat?.() ?? "auto");
      if (!meta) return null;
      return {
        ts_local: meta.ts_local,
        ts_precision: "minute",
        direction: out ? "outgoing" : "incoming",
        speaker_raw: meta.speaker,
        text,
      };
    },
    scrollStep: () => scrollUpAndWait(qs(ctx.doc, sel.scroller), () => rows().length, ctx.loadWaitMs ?? 3000),
    healthCheck(): Health {
      if (!qs(ctx.doc, sel.shell)) return missing("shell");
      if (qs(ctx.doc, sel.login)) return { ok: true }; // logged out is an anomaly, not drift
      if (qs(ctx.doc, sel.chatTitle) && !list()) return missing("messageList");
      return directionMarkerHealth(ctx.doc, sel, msgRows().length);
    },
    anomaly: () => anomalyOf(ctx.doc, sel),
    directionUncertain() {
      const m = msgRows();
      return oneSided(m.length, m.filter((r) => r.querySelector(sel.outgoing)).length);
    },
  };
}
