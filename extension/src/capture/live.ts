import type { Health, MessageSink, SiteAdapter } from "../adapters/types";
import { Harvester } from "./common";

export interface LiveOptions {
  tz: string;
  /** Opt-in per chat: nothing is read from a chat unless this says it is linked. */
  isLinked: (chat_key: string) => boolean | Promise<boolean>;
  /** Platform enabled, not paused, queue not full. */
  isAllowed: () => boolean | Promise<boolean>;
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
      harvester = new Harvester(adapter, sink, opts.tz);
    }
    if (!(await opts.isLinked(chat.chat_key))) return; // unlinked: never extracted
    if (!harvester) return;
    if (!(await opts.isAllowed())) {
      harvester.skipVisible(); // paused: what arrives now is not captured later either
      return;
    }
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
