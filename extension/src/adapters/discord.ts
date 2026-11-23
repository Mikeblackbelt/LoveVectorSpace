import sel from "./discord.selectors.json";
import { anomalyOf, defaultCtx, missing, qs, scrollUpAndWait, textOf, type PageCtx } from "./base";
import type { CapturedMessage, Health, SiteAdapter } from "./types";

const DM_PATH = /^\/channels\/@me\/(\d+)/;

export function createDiscordAdapter(ctx: PageCtx = defaultCtx()): SiteAdapter {
  const list = () => qs(ctx.doc, sel.messageList);
  const rows = () => (list() ? Array.from(list()!.querySelectorAll(sel.row)) : []);
  const selfName = () => textOf(qs(ctx.doc, sel.selfName));

  /** Consecutive messages from one author omit the header, so walk back to the nearest one. */
  function authorOf(node: Element): string {
    for (let el: Element | null = node; el; el = el.previousElementSibling) {
      const a = textOf(el.querySelector(sel.author));
      if (a) return a;
    }
    return "";
  }
  function timeOf(node: Element): { iso: string; approx: boolean } | null {
    for (let el: Element | null = node, approx = false; el; el = el.previousElementSibling, approx = true) {
      const dt = el.querySelector(sel.time)?.getAttribute("datetime");
      if (dt && !Number.isNaN(Date.parse(dt))) return { iso: new Date(dt).toISOString(), approx };
    }
    return null;
  }

  return {
    platform: "discord",
    matches: (url) => {
      try {
        const u = new URL(url);
        return u.hostname === "discord.com" && DM_PATH.test(u.pathname);
      } catch {
        return false;
      }
    },
    currentChat() {
      const m = DM_PATH.exec(new URL(ctx.url()).pathname);
      if (!m || !list()) return null;
      return { chat_key: m[1], title: textOf(qs(ctx.doc, sel.chatTitle)) || m[1] };
    },
    findMessageList: list,
    rows,
    extract(node): CapturedMessage | null {
      if (node.querySelector(sel.system)) return null;
      const textEl = node.querySelector(sel.text);
      const text = textOf(textEl);
      if (!text) return null; // attachments / stickers only
      const self = selfName();
      const author = authorOf(node);
      const t = timeOf(node);
      if (!self || !author || !t) return null; // cannot tell direction or time: skip rather than guess
      const id = (node.getAttribute("id") ?? "").split("-").pop();
      return {
        platform_msg_id: id && /^\d+$/.test(id) ? id : undefined,
        ts_utc: t.iso,
        ts_precision: t.approx ? "approx" : "second",
        direction: author === self ? "outgoing" : "incoming",
        speaker_raw: author,
        text,
      };
    },
    scrollStep: () => scrollUpAndWait(qs(ctx.doc, sel.scroller), () => rows().length, ctx.loadWaitMs ?? 3000),
    healthCheck(): Health {
      if (!qs(ctx.doc, sel.shell)) return missing("shell");
      if (!DM_PATH.test(new URL(ctx.url()).pathname)) return { ok: true };
      if (!list()) return missing("messageList");
      if (!selfName()) return missing("selfName");
      return { ok: true };
    },
    anomaly: () => anomalyOf(ctx.doc, sel),
  };
}
