import type { Health, MessageSink, SiteAdapter } from "../adapters/types";
import { Harvester } from "./common";
import { SeenSet } from "./seen";

export interface LiveOptions {
  tz: string;
  /** Opt-in per chat: nothing is read from a chat unless this says it is linked. */
  isLinked: (chat_key: string) => boolean | Promise<boolean>;
  /** "paused": platform off or user paused (what arrives is skipped). "full": queue full (nothing is marked seen, so it is read later). */
  isAllowed: () => "ok" | "paused" | "full" | Promise<"ok" | "paused" | "full">;
  /** Persistent per-chat seen-set; defaults to memory only. */
  seenFor?: (chat_key: string) => SeenSet | Promise<SeenSet>;
  onHealth?: (h: Health) => void;
  debounceMs?: number;
  pollMs?: number;
}

export interface LiveHandle {
  stop(): void;
  /** Run one scan now (used by tests and on chat change). */
  scan(): Promise<void>;
}

/** MutationObserver capture for linked chats only. A failing health check disables capture and queues nothing. */
export function startLiveCapture(adapter: SiteAdapter, sink: MessageSink, opts: LiveOptions): LiveHandle {
  let harvester: Harvester | null = null;
  let observed: Element | null = null;
  let chatKey: string | null = null;
  let observer: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastHealthOk: boolean | null = null;
  let running: Promise<void> = Promise.resolve();
  let stopped = false;

  async function scanOnce(): Promise<void> {
    if (stopped) return;
    const health = adapter.healthCheck();
    if (lastHealthOk !== health.ok) {
      lastHealthOk = health.ok;
      opts.onHealth?.(health);
    }
    if (!health.ok) return;
    const list = adapter.findMessageList();
    const chat = adapter.currentChat();
    if (!list || !chat) return;
    if (list !== observed || chat.chat_key !== chatKey) {
      attach(list);
      chatKey = chat.chat_key;
      harvester = new Harvester(adapter, sink, opts.tz, {
        chatKey: chat.chat_key,
        isLinked: opts.isLinked,
        seen: opts.seenFor ? await opts.seenFor(chat.chat_key) : undefined,
      });
    }
    if (!(await opts.isLinked(chat.chat_key))) return; // unlinked: never extracted
    if (!harvester) return;
    const allowed = await opts.isAllowed();
    if (allowed === "paused") {
      await harvester.skipVisible(); // paused: what arrives now is not captured later either
      return;
    }
    if (allowed === "full") return;
    await harvester.harvest();
  }

  const scan = () => (running = running.then(scanOnce, scanOnce));

  function attach(list: Element) {
    observer?.disconnect();
    observed = list;
    observer = new MutationObserver((records) => {
      if (!records.some((r) => r.addedNodes.length > 0)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void scan(), opts.debounceMs ?? 250);
    });
    observer.observe(list, { childList: true, subtree: true });
  }

  const poll = setInterval(() => void scan(), opts.pollMs ?? 1500);
  void scan();

  return {
    stop() {
      stopped = true;
      observer?.disconnect();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    },
    scan,
  };
}
