import { PLATFORMS, type Platform } from "../adapters/types";
import type { ExtSummary, Person } from "../api";
import type { ChatContext } from "../messages";
import type { HealthState, Prefs, RunState } from "../storage";

export interface PopupState {
  prefs: Prefs;
  health: Partial<Record<Platform, HealthState>>;
  runs: Partial<Record<Platform, RunState>>;
  queueLength: number;
  queueFull: boolean;
  storageError: boolean;
  /** messages the server refused (413/422) and the queue dropped */
  rejected: number;
  lastFlush: { at: number; sent: number; error?: string } | null;
}

export interface PopupDeps {
  configured(): Promise<boolean>;
  chat(): Promise<ChatContext | null>;
  summary(p: Platform, k: string): Promise<ExtSummary>;
  people(): Promise<Person[]>;
  link(personId: number, p: Platform, k: string, pseudonym: string): Promise<void>;
  unlink(p: Platform, k: string): Promise<void>;
  startBackfill(until: string): Promise<{ started: boolean; reason?: string }>;
  importPage(until: string | null): Promise<{ started: boolean; reason?: string }>;
  stopRun(): Promise<void>;
  state(): Promise<PopupState>;
  savePrefs(p: Prefs): Promise<void>;
  openOptions(): void;
}

export const PLATFORM_LABEL: Record<Platform, string> = { whatsapp: "WhatsApp Web", discord: "Discord DMs", instagram: "Instagram DMs", tinder: "Tinder", grindr: "Grindr", bumble: "Bumble" };
export const DISCORD_NOTE = "Discord's rules prohibit automating account actions. The account risk is yours.";

export const STOP_LABEL: Record<string, string> = {
  until_date: "reached the back-to date",
  chat_start: "reached the start of the chat",
  login: "login page showing",
  captcha: "captcha or challenge showing",
  error_banner: "error banner showing",
  health_failure: "selectors need updating",
  tab_hidden: "tab hidden for over 60 s",
  max_steps: "reached the 300-step limit",
  cooldown: "cool-down in progress",
  queue_full: "queue full",
  chat_closed: "chat closed",
  anchor_found: "caught up",
  no_anchor: "nothing to compare against",
  stopped: "stopped by you",
  done: "imported what is on screen",
  upload_failed: "upload failed, nothing was saved",
};

type Child = Node | string | null | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...kids: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (typeof v === "boolean") {
      if (v) el.setAttribute(k, "");
    } else el.setAttribute(k, v);
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}

const span = (cls: string, text: string) => h("span", { class: cls }, text);
const box = (title: string, ...kids: Child[]) => h("section", { class: "box" }, h("span", { class: "ttl" }, title.toUpperCase()), ...kids);
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString();

/** Counts-only summary block. Anything other than the known numeric fields is ignored, so message text can never render. */
export function summaryBox(s: ExtSummary, st: PopupState, platform: Platform): HTMLElement {
  const share = s.my_share_30d == null ? null : Math.round(s.my_share_30d * 100);
  const filled = share == null ? 0 : Math.round(share / (100 / 12));
  const run = st.runs[platform];
  return box(
    "this chat",
    h(
      "div",
      { class: "stats" },
      ...[
        ["Today", s.today],
        ["7d", s.last7d],
        ["Total", s.total],
      ].map(([l, n]) => h("div", { class: "stat" }, span("lbl", String(l)), h("b", {}, Number(n).toLocaleString("en-US")))),
    ),
    h("div", { class: "kv" }, span("lbl", "Your share (30d)"), span("bar", share == null ? "no data" : `${"█".repeat(filled)}${"░".repeat(12 - filled)} ${share}%`)),
    h(
      "div",
      { class: "kv" },
      span("dim", `Last flush ${st.lastFlush ? fmtTime(st.lastFlush.at) : "never"}${st.lastFlush?.error ? " (failed)" : ""}`),
      span("dim", run?.kind === "catchup" && run.status === "stopped" ? `Catch-up: ${STOP_LABEL[run.reason ?? ""] ?? run.reason}` : `Queued ${st.queueLength}`),
    ),
  );
}

export async function mountPopup(root: HTMLElement, d: PopupDeps): Promise<void> {
  async function render(): Promise<void> {
    const pop = h("div", { class: "pop", role: "dialog", "aria-label": "LoveVectorSpace capture" });
    root.replaceChildren(pop);
    const body = h("div", { class: "body" });
    const header = h("header", { class: "hd" });
    const footer = h("footer", { class: "ft" });
    pop.append(header, body, footer);

    const title = (chip?: [string, string]) =>
      header.replaceChildren(h("div", { class: "r1" }, h("span", { class: "t acc" }, "LVS ▸ CAPTURE"), chip ? span(`chip ${chip[1]}`, chip[0]) : ""));
    const optionsBtn = h("button", { type: "button", onclick: () => d.openOptions() }, "Options");
    footer.append(h("div", { class: "acts" }, optionsBtn));

    if (!(await d.configured())) {
      title(["NOT SET UP", "bad"]);
      body.append(h("div", { class: "concern" }, "Set the API URL and extension token in Options first."));
      return;
    }
    const chat = await d.chat();
    const st = await d.state();
    if (!chat) {
      title();
      body.append(h("div", { class: "note" }, "Open a chat on WhatsApp Web, Discord DMs or Instagram DMs."));
      body.append(platformsBox(st, d, render));
      return;
    }
    const { platform } = chat;
    const hs = st.health[platform];
    const healthy = chat.health.ok && (hs?.ok ?? true);
    if (st.storageError) body.append(h("div", { class: "alert" }, "Capture paused: browser storage is full or refused a write. Free space or let the queue upload."));
    if (st.rejected > 0) body.append(h("div", { class: "concern" }, `${st.rejected} message(s) were rejected by the server and dropped.`));
    if (st.queueFull) body.append(h("div", { class: "alert" }, "Capture paused: the queue holds 5,000 messages. Check the API settings so it can upload."));
    if (!healthy) {
      body.append(
        h("div", { class: "alert" }, `Update selectors for ${PLATFORM_LABEL[platform]}: ${chat.health.reason ?? hs?.reason ?? "check failed"}. Capture is off for this site.`),
      );
    }
    if (chat.direction_uncertain) body.append(h("div", { class: "concern" }, "Only one side detected — if that’s wrong, the site may have changed (see SELECTORS.md)."));
    if (!chat.chat_key) {
      title([healthy ? "NO CHAT" : "SELECTORS", "paused"]);
      body.append(h("div", { class: "note" }, "Open a chat to link it."), platformsBox(st, d, render));
      return;
    }
    let summary: ExtSummary | null = null;
    let err: string | null = null;
    try {
      summary = await d.summary(platform, chat.chat_key);
    } catch (e) {
      err = e instanceof Error ? e.message : "request failed";
    }
    const linked = !!summary?.linked;
    title(st.prefs.paused ? ["PAUSED", "paused"] : linked ? ["● LINKED", ""] : ["UNLINKED", "paused"]);
    header.append(
      h("div", { class: "r2" }, span("dim", "CHAT › "), span("thm", (summary?.person?.pseudonym ?? chat.title ?? "").toUpperCase()), span("dim", ` · ${PLATFORM_LABEL[platform]}`)),
    );
    if (err) body.append(h("div", { class: "concern" }, err));

    if (!linked) body.append(await linkBox(d, platform, chat.chat_key, render));
    else if (summary) {
      body.append(summaryBox(summary, st, platform));
      body.append(backfillBox(chat, st, d, render));
      body.append(importBox(chat, st, d, render));
    }
    body.append(platformsBox(st, d, render));
    body.append(
      box(
        "health",
        ...PLATFORMS.map((p) => {
          const x = st.health[p];
          return h("div", { class: "kv" }, span("dim", PLATFORM_LABEL[p]), x && !x.ok ? span("", `update selectors (${x.reason ?? ""})`) : span("ok", x ? "ok" : "not seen yet"));
        }),
      ),
    );

    const pauseBtn = h("button", { type: "button", id: "pause", "aria-pressed": String(st.prefs.paused), onclick: async () => {
      await d.savePrefs({ ...st.prefs, paused: !st.prefs.paused });
      await render();
    } }, st.prefs.paused ? "Resume" : "Pause");
    footer.querySelector(".acts")!.prepend(pauseBtn);
    if (linked) {
      footer.querySelector(".acts")!.append(
        h("button", { type: "button", id: "unlink", onclick: async () => {
          await d.unlink(platform, chat.chat_key!);
          await render();
        } }, "Unlink"),
      );
    }
  }
  await render();
}

async function linkBox(d: PopupDeps, platform: Platform, chatKey: string, render: () => Promise<void>): Promise<HTMLElement> {
  let people: Person[] = [];
  let err = "";
  try {
    people = await d.people();
  } catch (e) {
    err = e instanceof Error ? e.message : "could not load people";
  }
  const select = h("select", { id: "person", "aria-label": "Person" }, ...people.map((p) => h("option", { value: String(p.id) }, p.pseudonym)));
  const btn = h("button", { class: "btn pri", type: "button", id: "link", disabled: people.length === 0, onclick: async () => {
    const p = people.find((x) => String(x.id) === select.value);
    if (!p) return;
    await d.link(p.id, platform, chatKey, p.pseudonym);
    await render();
  } }, "Link this chat");
  return box(
    "link chat",
    h("div", { class: "note" }, "Nothing is read from this chat (including Import this page) until you link it to a person."),
    h("label", { class: "lbl", for: "person" }, "Person"),
    h("div", { class: "field" }, select),
    err ? h("div", { class: "note" }, err) : people.length === 0 ? h("div", { class: "note" }, "No people yet. Create one in the app first.") : null,
    btn,
  );
}

function backfillBox(chat: ChatContext, st: PopupState, d: PopupDeps, render: () => Promise<void>): HTMLElement {
  const run = st.runs[chat.platform];
  const running = run?.kind === "backfill" && run.status === "running";
  const input = h("input", { id: "back", type: "date", "aria-label": "Back to date" });
  const msg = h("div", { class: "note", "aria-live": "polite" });
  const cool = chat.cooldown_left_ms > 0 ? `Cool-down: ${Math.ceil(chat.cooldown_left_ms / 60000)} min left.` : "";
  const start = h("button", { class: "btn pri", type: "button", id: "backfill", disabled: running || chat.cooldown_left_ms > 0 || !chat.health.ok, onclick: async () => {
    if (!(input as HTMLInputElement).value) {
      msg.textContent = "Pick a back-to date first.";
      return;
    }
    const r = await d.startBackfill((input as HTMLInputElement).value);
    if (!r.started) msg.textContent = `Not started: ${r.reason ?? "unknown"}`;
    else await render();
  } }, running ? "Backfilling…" : "Start backfill");
  return box(
    "backfill",
    h("label", { class: "lbl", for: "back" }, "Back to"),
    h("div", { class: "field" }, input),
    h("div", { class: "note" }, "1 step / 2–4 s, max 300 steps, 10 min cool-down. Keep the tab visible. " + cool),
    run?.kind === "backfill"
      ? h("div", { class: "kv" }, span("dim", "Last run"), span("", running ? `step ${run.step}/${run.maxSteps}` : `${STOP_LABEL[run.reason ?? ""] ?? run.reason} · ${run.step} steps`))
      : null,
    start,
    running ? h("button", { class: "btn", type: "button", id: "stop", onclick: async () => {
      await d.stopRun();
      await render();
    } }, "Stop") : null,
    msg,
  );
}

/** Tiny animated vector sum: two vectors (me, them) and their resultant. Static under reduced motion. */
export function vectorSum(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext?.("2d");
  if (!ctx) return; // jsdom has no canvas
  const css = getComputedStyle(canvas);
  const col = (v: string) => css.getPropertyValue(v).trim() || "currentColor";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const w = canvas.width, hgt = canvas.height;
  const arrow = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x1, y1, 2.5, 0, 7);
    ctx.fillStyle = c;
    ctx.fill();
  };
  const draw = (t: number) => {
    if (!canvas.isConnected) return;
    ctx.clearRect(0, 0, w, hgt);
    const a = t / 900, b = t / 1300 + 2;
    const ox = w * 0.2, oy = hgt * 0.7;
    const m = [Math.cos(a) * 18 + 14, -Math.abs(Math.sin(a)) * 18 - 4];
    const th = [Math.cos(b) * 14 + 14, -Math.abs(Math.sin(b * 1.3)) * 22 - 4];
    arrow(ox, oy, ox + m[0], oy + m[1], col("--me"));
    arrow(ox + m[0], oy + m[1], ox + m[0] + th[0], oy + m[1] + th[1], col("--them"));
    arrow(ox, oy, ox + m[0] + th[0], oy + m[1] + th[1], col("--link"));
    if (!reduce) requestAnimationFrame(draw);
  };
  draw(0);
}

function importBox(chat: ChatContext, st: PopupState, d: PopupDeps, render: () => Promise<void>): HTMLElement {
  const run = st.runs[chat.platform];
  const running = run?.kind === "import" && run.status === "running";
  const input = h("input", { id: "import-back", type: "date", "aria-label": "Import back to date (optional)" });
  const msg = h("div", { class: "note", "aria-live": "polite" });
  const start = h("button", { class: "btn pri", type: "button", id: "import", disabled: running || !chat.health.ok, onclick: async () => {
    const v = (input as HTMLInputElement).value;
    const r = await d.importPage(v || null);
    if (!r.started) msg.textContent = `Not started: ${r.reason ?? "unknown"}`;
    else await render();
  } }, running ? "Importing…" : "Import this page");
  const canvas = h("canvas", { width: "64", height: "64", "aria-label": "Vector sum loading animation" });
  const progress = running
    ? h("div", { class: "run", "aria-live": "polite" }, canvas,
        h("div", { class: "tx" }, span("acc", "IMPORTING…"), span("dim", `step ${run.step}/${run.maxSteps}`),
          h("button", { class: "btn", type: "button", id: "import-stop", onclick: async () => {
            await d.stopRun();
            await render();
          } }, "Stop")))
    : null;
  queueMicrotask(() => vectorSum(canvas as HTMLCanvasElement));
  return box(
    "import this page",
    h("div", { class: "note" }, "One-time read of this open chat, sent as one import. Works without live capture. Leave the date empty to read only what is on screen."),
    h("label", { class: "lbl", for: "import-back" }, "Back to (optional)"),
    h("div", { class: "field" }, input),
    run?.kind === "import" && run.status === "stopped"
      ? h("div", { class: "kv" }, span("dim", "Last import"), span("", `${STOP_LABEL[run.reason ?? ""] ?? run.reason} · ${run.imported ?? 0} messages`))
      : null,
    start,
    progress,
    msg,
  );
}

function platformsBox(st: PopupState, d: PopupDeps, render: () => Promise<void>): HTMLElement {
  const toggle = (label: string, on: boolean, id: string, set: (v: boolean) => Prefs) =>
    h("button", { class: "tgl", type: "button", id, "aria-pressed": String(on), "aria-label": label, onclick: async () => {
      await d.savePrefs(set(!on));
      await render();
    } }, on ? "ON" : "OFF");
  return box(
    "platforms",
    ...PLATFORMS.flatMap((p) => [
      h("div", { class: "prow" }, span("dim", PLATFORM_LABEL[p].split(" ")[0]), toggle(PLATFORM_LABEL[p], st.prefs.enabled[p], `tgl-${p}`, (v) => ({ ...st.prefs, enabled: { ...st.prefs.enabled, [p]: v } }))),
      p === "discord" ? h("div", { class: "warn" }, DISCORD_NOTE) : null,
    ]),
    h("div", { class: "prow" }, span("dim", "Catch-up"), toggle("Catch-up", st.prefs.catchup, "tgl-catchup", (v) => ({ ...st.prefs, catchup: v }))),
  );
}
