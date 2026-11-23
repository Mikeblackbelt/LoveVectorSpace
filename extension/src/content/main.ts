import { createDiscordAdapter } from "../adapters/discord";
import { createInstagramAdapter } from "../adapters/instagram";
import { createWhatsAppAdapter } from "../adapters/whatsapp";
import { createTinderAdapter } from "../adapters/tinder";
import { createBumbleAdapter } from "../adapters/bumble";
import { createGrindrAdapter } from "../adapters/grindr";
import type { DateFormat } from "../adapters/time";
import type { MessageSink, SiteAdapter } from "../adapters/types";
import { runImport } from "../capture/import";
import { runBackfill, BACKFILL_COOLDOWN_MS, BACKFILL_MAX_STEPS } from "../capture/backfill";
import { runCatchup } from "../capture/catchup";
import type { LoopDeps, StopReason } from "../capture/common";
import { startLiveCapture } from "../capture/live";
import type { BgRequest, BgResponse, TabRequest, TabResponse } from "../messages";
import { RateLimiter, RunGuard } from "../ratelimit";
import { browserTz, getKey, getLinks, getPrefs, getSettings, linkKey, setHealth, setKey, setLink, setRun } from "../storage";


let waDateFormat: DateFormat = "auto";
void getSettings().then((st) => (waDateFormat = st.waDateFormat));
chrome.storage.onChanged.addListener((c) => {
  const n = c.settings?.newValue as { waDateFormat?: DateFormat } | undefined;
  if (n) waDateFormat = n.waDateFormat ?? "auto";
});

function pickAdapter(): SiteAdapter | null {
  const host = location.hostname;
  if (host === "bumble.com") return createBumbleAdapter();
  if (host === "tinder.com") return createTinderAdapter();
  if (host === "web.grindr.com") return createGrindrAdapter();
  if (host === "web.whatsapp.com") return createWhatsAppAdapter({ doc: document, url: () => location.href, dateFormat: () => waDateFormat });
  if (host === "discord.com") return createDiscordAdapter();
  if (host === "www.instagram.com") return createInstagramAdapter();
  return null;
}

const send = (r: BgRequest) => chrome.runtime.sendMessage(r) as Promise<BgResponse>;

const adapter = pickAdapter();
if (adapter) boot(adapter);

function boot(adapter: SiteAdapter) {
  const platform = adapter.platform;
  const tz = browserTz();
  const sink: MessageSink = {
    async enqueue(p, chat_key, tzv, msgs) {
      const r = await send({ type: "enqueue", platform: p, chat_key, tz: tzv, msgs });
      return r.ok ? r.accepted !== false : false;
    },
  };
  let stopRequested = false;
  let running = false;
  let guard: RunGuard | null = null;

  async function allowed(): Promise<boolean> {
    const prefs = await getPrefs();
    if (!prefs.enabled[platform] || prefs.paused) return false;
    return !(await getKey<boolean>("queue_full", false));
  }
  const linked = async (chat_key: string) => linkKey(platform, chat_key) in (await getLinks());

  startLiveCapture(adapter, sink, {
    tz,
    isLinked: linked,
    isAllowed: allowed,
    onHealth: (h) => void setHealth(platform, { ok: h.ok, reason: h.ok ? undefined : h.reason, at: Date.now() }),
  });

  async function getGuard(): Promise<RunGuard> {
    const last = await getKey<number | null>(`run_end:${platform}`, null);
    guard = new RunGuard(BACKFILL_MAX_STEPS, BACKFILL_COOLDOWN_MS, Date.now, last);
    return guard;
  }

  function deps(kind: "backfill" | "catchup" | "import", maxSteps: number): LoopDeps {
    return {
      sink,
      tz,
      isHidden: () => document.visibilityState === "hidden",
      shouldStop: () => stopRequested,
      onStep: (step) => void setRun(platform, { kind, status: "running", step, maxSteps, at: Date.now() }),
    };
  }

  async function finish(kind: "backfill" | "catchup", maxSteps: number, step: number, reason: StopReason) {
    await setRun(platform, { kind, status: "stopped", step, maxSteps, reason, at: Date.now() });
  }

  async function backfill(untilIso: string): Promise<{ started: boolean; reason?: string }> {
    const chat = adapter.currentChat();
    if (!chat || !(await linked(chat.chat_key))) return { started: false, reason: "not_linked" };
    if (running) return { started: false, reason: "already_running" };
    const g = await getGuard();
    if (!g.canStart()) return { started: false, reason: "cooldown" };
    const until = new Date(`${untilIso}T00:00:00`);
    if (Number.isNaN(until.getTime())) return { started: false, reason: "bad_date" };
    running = true;
    stopRequested = false;
    void (async () => {
      const reason = await runBackfill(adapter, until, new RateLimiter(), g, deps("backfill", BACKFILL_MAX_STEPS));
      await setKey(`run_end:${platform}`, g.lastEnd);
      await finish("backfill", BACKFILL_MAX_STEPS, g.stepCount, reason);
      running = false;
    })();
    return { started: true };
  }

  async function importPage(untilIso: string | null): Promise<{ started: boolean; reason?: string }> {
    const chat = adapter.currentChat();
    if (!chat || !(await linked(chat.chat_key))) return { started: false, reason: "not_linked" };
    if (running) return { started: false, reason: "already_running" };
    const until = untilIso ? new Date(`${untilIso}T00:00:00`) : null;
    if (until && Number.isNaN(until.getTime())) return { started: false, reason: "bad_date" };
    running = true;
    stopRequested = false;
    const day = new Date();
    const unit_id = `capture:${platform}:${chat.chat_key}:${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    void (async () => {
      const g = new RunGuard(BACKFILL_MAX_STEPS, 0);
      const { sink: _s, ...base } = deps("import", BACKFILL_MAX_STEPS);
      const res = await runImport(adapter, until, new RateLimiter(), g, base, async (msgs) => {
        const r = await send({ type: "import", platform, chat_key: chat.chat_key, tz, unit_id, msgs });
        if (!r.ok) throw new Error(r.error);
      });
      await setRun(platform, { kind: "import", status: "stopped", step: g.stepCount, maxSteps: BACKFILL_MAX_STEPS, reason: res.reason, imported: res.count, at: Date.now() });
      running = false;
    })();
    return { started: true };
  }

  async function catchupFor(chat_key: string) {
    const prefs = await getPrefs();
    if (!prefs.catchup || !(await allowed()) || running) return;
    const r = await send({ type: "summary", platform, chat_key });
    if (!r.ok || !r.summary) return;
    if (!r.summary.linked) {
      await setLink(platform, chat_key, null);
      return;
    }
    if (r.summary.person) await setLink(platform, chat_key, { person_id: r.summary.person.id, pseudonym: r.summary.person.pseudonym });
    running = true;
    stopRequested = false;
    const reason = await runCatchup(adapter, r.summary.last_captured_ids, new RateLimiter(), deps("catchup", 50));
    if (reason !== "no_anchor") await finish("catchup", 50, 0, reason);
    running = false;
  }

  // Catch-up once each time a chat is opened.
  let lastChat: string | null = null;
  setInterval(() => {
    const chat = adapter.currentChat();
    const key = chat?.chat_key ?? null;
    if (key !== lastChat) {
      lastChat = key;
      if (key) void catchupFor(key);
    }
  }, 2000);

  chrome.runtime.onMessage.addListener((req: TabRequest, _s, sendResponse: (r: TabResponse) => void) => {
    void (async () => {
      if (req.type === "getChat") {
        const chat = adapter.currentChat();
        const h = adapter.healthCheck();
        const g = guard ?? (await getGuard());
        sendResponse({
          ok: true,
          chat: {
            platform,
            chat_key: chat?.chat_key ?? null,
            title: chat?.title ?? null,
            health: h.ok ? { ok: true } : { ok: false, reason: h.reason },
            cooldown_left_ms: g.cooldownLeftMs(),
          },
        });
      } else if (req.type === "startBackfill") {
        const r = await backfill(req.until);
        sendResponse({ ok: true, started: r.started, reason: r.reason });
      } else if (req.type === "importPage") {
        const r = await importPage(req.until);
        sendResponse({ ok: true, started: r.started, reason: r.reason });
      } else if (req.type === "stopRun") {
        stopRequested = true;
        sendResponse({ ok: true });
      }
    })();
    return true;
  });
}
