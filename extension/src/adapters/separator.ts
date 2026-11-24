import { anomalyOf, directionPlausible, defaultCtx, missing, qs, scrollUpAndWait, textOf, type PageCtx } from "./base";
import { parseLooseTimestamp } from "./time";
import type { CapturedMessage, Health, Platform, Selectors, SiteAdapter } from "./types";

export interface SeparatorSpec {
  platform: Platform;
  hostname: string;
  /** pathname prefix that identifies the messages view */
  pathPrefix: string;
  /** captures the chat key from the pathname */
  chatPath: RegExp;
  sel: Selectors;
}

/**
 * Adapter for apps that show timestamps only between message groups and mark your own bubbles with a
 * distinct element (Instagram, Tinder, Grindr). Every message gets its group's time with ts_precision "approx".
 */
export function createSeparatorAdapter(spec: SeparatorSpec, ctx: PageCtx = defaultCtx()): SiteAdapter {
  const { sel } = spec;
  const list = () => qs(ctx.doc, sel.messageList);
  const rows = () => (list() ? Array.from(list()!.querySelectorAll(sel.row)) : []);
  const title = () => textOf(qs(ctx.doc, sel.chatTitle));
  const onChatPage = () => spec.chatPath.test(new URL(ctx.url()).pathname);

  function groupTime(node: Element): string | null {
    for (let el = node.previousElementSibling; el; el = el.previousElementSibling) {
      const t = el.querySelector(sel.timeSeparator);
      if (t) return parseLooseTimestamp(textOf(t), ctx.now?.() ?? new Date());
    }
    return null;
  }

  return {
    platform: spec.platform,
    matches: (url) => {
      try {
        const u = new URL(url);
        return u.hostname === spec.hostname && u.pathname.startsWith(spec.pathPrefix);
      } catch {
        return false;
      }
    },
    currentChat() {
      const m = spec.chatPath.exec(new URL(ctx.url()).pathname);
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
      if (!text) return null; // media, gifs, reactions
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
      if (!onChatPage()) return { ok: true };
      if (!list()) return missing("messageList");
      const bubbles = rows().filter((r) => r.querySelector(sel.bubble));
      return directionPlausible(bubbles.length, bubbles.filter((r) => r.querySelector(sel.outgoing)).length);
    },
    anomaly: () => anomalyOf(ctx.doc, sel),
  };
}
