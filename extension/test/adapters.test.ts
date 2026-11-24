import { describe, expect, it, vi } from "vitest";
import { createDiscordAdapter } from "../src/adapters/discord";
import { createInstagramAdapter } from "../src/adapters/instagram";
import { createBumbleAdapter } from "../src/adapters/bumble";
import { createGrindrAdapter } from "../src/adapters/grindr";
import { createTinderAdapter } from "../src/adapters/tinder";
import { SEEN_CAP, SeenSet, seenKeys } from "../src/capture/seen";
import { runImport } from "../src/capture/import";
import { createWhatsAppAdapter } from "../src/adapters/whatsapp";
import { parseLooseTimestamp, parseWhatsAppMeta } from "../src/adapters/time";
import type { Platform, SiteAdapter } from "../src/adapters/types";
import { runBackfill } from "../src/capture/backfill";
import { runCatchup } from "../src/capture/catchup";
import { startLiveCapture } from "../src/capture/live";
import { RateLimiter, RunGuard } from "../src/ratelimit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CollectSink, fakeAdapter, loadFixture, msg } from "./helpers";

const fast = () => new RateLimiter(2000, 4000, async () => undefined);
const d = (sink = new CollectSink()) => ({ sink, tz: "UTC", chatKey: "k", isLinked: () => true });
const mk: Partial<Record<Platform, () => SiteAdapter>> & Record<"whatsapp" | "discord" | "instagram", () => SiteAdapter> = {
  whatsapp: () => createWhatsAppAdapter({ doc: document, url: () => "https://web.whatsapp.com/", loadWaitMs: 60 }),
  discord: () => createDiscordAdapter({ doc: document, url: () => "https://discord.com/channels/@me/900", loadWaitMs: 60 }),
  instagram: () => createInstagramAdapter({ doc: document, url: () => "https://www.instagram.com/direct/t/555/", loadWaitMs: 60, now: () => new Date(2026, 10, 23) }),
};
mk.tinder = () => createTinderAdapter({ doc: document, url: () => "https://tinder.com/app/messages/abc123", loadWaitMs: 60, now: () => new Date(2026, 10, 23) });
mk.grindr = () => createGrindrAdapter({ doc: document, url: () => "https://web.grindr.com/messages/u77", loadWaitMs: 60, now: () => new Date(2026, 10, 23) });
mk.bumble = () => createBumbleAdapter({ doc: document, url: () => "https://bumble.com/app/connections/k9", loadWaitMs: 60, now: () => new Date(2026, 10, 23) });
const extractAll = (a: SiteAdapter) => a.rows().map((r) => a.extract(r)).filter((m) => m !== null);

describe("extract text/direction/ts per platform", () => {
  it("whatsapp: minute precision, direction from the outgoing marker, system/media skipped", () => {
    loadFixture("whatsapp");
    const msgs = extractAll(mk.whatsapp());
    expect(msgs.map((m) => [m.direction, m.text])).toEqual([
      ["incoming", "hello there"],
      ["outgoing", "hi! how was your day"],
      ["outgoing", "ok"],
      ["outgoing", "ok"], // same minute, same text: two messages
    ]);
    expect(msgs[0]).toMatchObject({ ts_local: "2026-11-22T15:45", ts_precision: "minute", speaker_raw: "Sam Example" });
    expect(msgs[0].platform_msg_id).toBeUndefined();
    expect(mk.whatsapp().currentChat()).toEqual({ chat_key: "Sam Example", title: "Sam Example" });
  });

  it("discord: second precision, id from element id, direction by comparing the page's own username", () => {
    loadFixture("discord");
    const msgs = extractAll(mk.discord());
    expect(msgs.map((m) => [m.platform_msg_id, m.direction, m.speaker_raw, m.text])).toEqual([
      ["1001", "incoming", "friend_user", "hey, are we still on for friday?"],
      ["1002", "incoming", "friend_user", "I can do 7"], // grouped: author carried from the header above
      ["1003", "outgoing", "me_user", "friday works, see you then"],
    ]);
    expect(msgs[0]).toMatchObject({ ts_utc: "2026-11-22T20:45:10.000Z", ts_precision: "second" });
    expect(mk.discord().currentChat()?.chat_key).toBe("900");
  });

  it("instagram: group timestamps are approx, direction from the outgoing marker, media skipped", () => {
    loadFixture("instagram");
    const msgs = extractAll(mk.instagram());
    expect(msgs.map((m) => [m.direction, m.text, m.ts_local, m.ts_precision])).toEqual([
      ["incoming", "did you see the thing", "2026-11-22T15:45", "approx"],
      ["outgoing", "yes! so good", "2026-11-22T15:45", "approx"],
      ["incoming", "night!", "2026-11-22T21:10", "approx"],
    ]);
    expect(mk.instagram().currentChat()?.chat_key).toBe("555");
  });
});

describe("tinder and grindr", () => {
  it("tinder: both sides, approx time, date-only separator at noon, gif and notice skipped", () => {
    loadFixture("tinder");
    const msgs = extractAll(mk.tinder!());
    expect(msgs.map((m) => [m.direction, m.text, m.ts_local, m.ts_precision])).toEqual([
      ["incoming", "hey, nice to match", "2026-11-22T15:45", "approx"],
      ["outgoing", "likewise! coffee sometime?", "2026-11-22T15:45", "approx"],
      ["incoming", "sure, thursday?", "2026-11-23T12:00", "approx"],
    ]);
    expect(mk.tinder!().currentChat()).toEqual({ chat_key: "abc123", title: "Jo Example" });
    expect(mk.tinder!().matches("https://tinder.com/app/messages/abc123")).toBe(true);
    expect(mk.tinder!().matches("https://tinder.com/app/recs")).toBe(false);
  });
  it("grindr: both sides, approx time, media skipped", () => {
    loadFixture("grindr");
    const msgs = extractAll(mk.grindr!());
    expect(msgs.map((m) => [m.direction, m.text, m.ts_local])).toEqual([
      ["incoming", "hi there", "2026-11-22T20:10"],
      ["outgoing", "hey! how are you", "2026-11-22T20:10"],
      ["incoming", "good, you?", "2026-11-22T20:10"],
    ]);
    expect(mk.grindr!().currentChat()?.chat_key).toBe("u77");
    expect(mk.grindr!().matches("https://web.grindr.com/messages/u77")).toBe(true);
  });
});

describe("bumble", () => {
  it("both sides, approx time, gif and notice skipped", () => {
    loadFixture("bumble");
    const msgs = extractAll(mk.bumble!());
    expect(msgs.map((m) => [m.direction, m.text, m.ts_local, m.ts_precision])).toEqual([
      ["incoming", "hi, saw your profile", "2026-11-22T15:45", "approx"],
      ["outgoing", "hey! thanks for the opener", "2026-11-22T15:45", "approx"],
      ["incoming", "free this weekend?", "2026-11-23T12:00", "approx"],
    ]);
    expect(mk.bumble!().currentChat()).toEqual({ chat_key: "k9", title: "Kai Example" });
    expect(mk.bumble!().matches("https://bumble.com/app/connections/k9")).toBe(true);
    expect(mk.bumble!().matches("https://bumble.com/")).toBe(false);
  });
});

describe("error banner detection", () => {
  it.each(["tinder", "grindr", "instagram", "bumble"] as Platform[])("%s: a generic alert toast does not stop a run, an error-text alert does", (p) => {
    loadFixture(p);
    const a = mk[p]!();
    document.body.insertAdjacentHTML("beforeend", '<div role="alert">Link copied to clipboard</div>');
    expect(a.anomaly()).toBeNull();
    document.body.insertAdjacentHTML("beforeend", '<div role="alert">Something went wrong. Try again later.</div>');
    expect(a.anomaly()).toBe("error_banner");
  });
  it("a site-specific error container always counts", () => {
    loadFixture("tinder");
    document.body.insertAdjacentHTML("beforeend", '<div data-testid="error-banner"></div>');
    expect(mk.tinder!().anomaly()).toBe("error_banner");
  });
});

describe("whatsapp date format setting", () => {
  it("auto / month-first / day-first change ambiguous dates", () => {
    expect(parseWhatsAppMeta("[3:45 PM, 05/06/2026] A: ")?.ts_local).toBe("2026-05-06T15:45");
    expect(parseWhatsAppMeta("[3:45 PM, 05/06/2026] A: ", "month_first")?.ts_local).toBe("2026-05-06T15:45");
    expect(parseWhatsAppMeta("[3:45 PM, 05/06/2026] A: ", "day_first")?.ts_local).toBe("2026-06-05T15:45");
    expect(parseWhatsAppMeta("[3:45 PM, 22/11/2026] A: ", "auto")?.ts_local).toBe("2026-11-22T15:45");
  });
  it("the adapter uses the configured format", () => {
    document.body.innerHTML = readFileSync(resolve(__dirname, "fixtures/whatsapp/chat.html"), "utf8").replaceAll("11/22/2026", "03/04/2026");
    const a = createWhatsAppAdapter({ doc: document, url: () => "https://web.whatsapp.com/", dateFormat: () => "day_first" });
    expect(extractAll(a)[0].ts_local).toBe("2026-04-03T15:45");
  });
});

describe("import this page", () => {
  const dep = { tz: "UTC", chatKey: "k", isLinked: () => true };
  it("reads what is on screen and uploads once", async () => {
    loadFixture("whatsapp");
    const up = vi.fn(async () => undefined);
    const r = await runImport(mk.whatsapp(), null, fast(), new RunGuard(300, 0), { ...dep, chatKey: "Sam Example" }, up);
    expect(r).toEqual({ reason: "done", count: 4 });
    expect(up).toHaveBeenCalledTimes(1);
  });
  it("scrolls back to a date, and still uploads when stopped early", async () => {
    const a = fakeAdapter([[msg("9", "2026-11-20T00:00:00Z")], [msg("7", "2026-11-10T00:00:00Z")], [msg("5", "2026-11-01T00:00:00Z")]]);
    const up = vi.fn(async () => undefined);
    const r = await runImport(a, new Date("2026-11-12T00:00:00Z"), fast(), new RunGuard(300, 0), dep, up);
    expect(r).toEqual({ reason: "until_date", count: 2 });
    a.setAnomaly("captcha");
    const r2 = await runImport(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), dep, up);
    expect(r2.reason).toBe("captcha");
  });
  it("reports upload failure", async () => {
    loadFixture("tinder");
    const r = await runImport(mk.tinder!(), null, fast(), new RunGuard(300, 0), { ...dep, chatKey: "abc123" }, async () => {
      throw new Error("x");
    });
    expect(r.reason).toBe("upload_failed");
  });
  it("does not modify the page", async () => {
    loadFixture("grindr");
    const before = document.documentElement.outerHTML;
    await runImport(mk.grindr!(), new Date("2020-01-01"), fast(), new RunGuard(300, 0), { ...dep, chatKey: "u77" }, async () => undefined);
    expect(document.documentElement.outerHTML).toBe(before);
  });
});

describe("system and media lines skipped", () => {
  it.each(["whatsapp", "discord", "instagram", "tinder", "grindr", "bumble"] as Platform[])("%s: no empty or system text", (p) => {
    loadFixture(p);
    const a = mk[p]!();
    const msgs = extractAll(a);
    expect(msgs.length).toBeLessThan(a.rows().length);
    for (const m of msgs) {
      expect(m.text.trim()).not.toBe("");
      expect(m.text).not.toMatch(/end-to-end|started a call|^Seen$/);
    }
  });
});

describe("time parsing", () => {
  it("reads US and day-first WhatsApp metadata", () => {
    expect(parseWhatsAppMeta("[3:45 PM, 11/22/2026] A B: ")).toEqual({ ts_local: "2026-11-22T15:45", speaker: "A B" });
    expect(parseWhatsAppMeta("[15:45, 22/11/2026] Me: ")?.ts_local).toBe("2026-11-22T15:45");
    expect(parseWhatsAppMeta("[12:05 AM, 1/2/2026] Me: ")?.ts_local).toBe("2026-01-02T00:05");
    expect(parseWhatsAppMeta("garbage")).toBeNull();
  });
  it("reads Instagram separators", () => {
    const now = new Date(2026, 10, 23, 12);
    expect(parseLooseTimestamp("Nov 22, 2026, 3:45 PM", now)).toBe("2026-11-22T15:45");
    expect(parseLooseTimestamp("Yesterday 9:10 PM", now)).toBe("2026-11-22T21:10");
    expect(parseLooseTimestamp("nonsense", now)).toBeNull();
  });
});

describe("health check and selector drift", () => {
  it.each(["whatsapp", "discord", "instagram", "tinder", "grindr", "bumble"] as Platform[])("%s: healthCheck fails on changed fixture, capture disabled, nothing queued", async (p) => {
    loadFixture(p);
    expect(mk[p]!().healthCheck()).toEqual({ ok: true });
    loadFixture(p, "changed");
    const a = mk[p]!();
    const h = a.healthCheck();
    expect(h.ok).toBe(false);
    const sink = new CollectSink();
    const onHealth = vi.fn();
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => true, isAllowed: () => "ok" as const, onHealth, pollMs: 60_000 });
    await live.scan();
    live.stop();
    expect(onHealth).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(sink.items).toEqual([]);
  });
});

describe("live capture", () => {
  it("unlinked chat never extracted", async () => {
    loadFixture("whatsapp");
    const a = mk.whatsapp();
    const extract = vi.spyOn(a, "extract");
    const sink = new CollectSink();
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => false, isAllowed: () => "ok" as const, pollMs: 60_000 });
    await live.scan();
    live.stop();
    expect(extract).not.toHaveBeenCalled();
    expect(sink.items).toEqual([]);
  });

  it("captures visible and newly added messages once each, with the browser tz", async () => {
    loadFixture("discord");
    const sink = new CollectSink();
    const live = startLiveCapture(mk.discord(), sink, { tz: "America/New_York", isLinked: () => true, isAllowed: () => "ok" as const, debounceMs: 0, pollMs: 60_000 });
    await live.scan();
    expect(sink.items).toHaveLength(3);
    document.querySelector("ol")!.insertAdjacentHTML(
      "beforeend",
      '<li id="chat-messages-900-1006"><h3><span class="username_x">friend_user</span><time datetime="2026-11-22T20:55:00.000Z"></time></h3><div id="message-content-1006">new one</div></li>',
    );
    await vi.waitFor(() => expect(sink.items).toHaveLength(4));
    await live.scan();
    live.stop();
    expect(sink.items).toHaveLength(4);
    expect(sink.items[3]).toMatchObject({ chat_key: "900", tz: "America/New_York" });
    expect(sink.items[3].msg.text).toBe("new one");
  });

  it("does not capture while paused", async () => {
    loadFixture("whatsapp");
    const sink = new CollectSink();
    const live = startLiveCapture(mk.whatsapp(), sink, { tz: "UTC", isLinked: () => true, isAllowed: () => "paused" as const, pollMs: 60_000 });
    await live.scan();
    live.stop();
    expect(sink.items).toEqual([]);
  });
});

describe("backfill", () => {

  it("backfill stops at untilDate", async () => {
    const a = fakeAdapter([
      [msg("9", "2026-11-20T00:00:00Z"), msg("10", "2026-11-21T00:00:00Z")],
      [msg("7", "2026-11-18T00:00:00Z"), msg("8", "2026-11-19T00:00:00Z")],
      [msg("5", "2026-11-14T00:00:00Z"), msg("6", "2026-11-15T00:00:00Z")],
      [msg("3", "2026-11-01T00:00:00Z")],
    ]);
    const sink = new CollectSink();
    const r = await runBackfill(a, new Date("2026-11-16T00:00:00Z"), fast(), new RunGuard(300, 600_000), d(sink));
    expect(r).toBe("until_date");
    expect(a.scrolls()).toBe(2); // third page reached the date; the fourth was never loaded
    expect(sink.items.map((i) => i.msg.platform_msg_id).sort()).toEqual(["10", "5", "6", "7", "8", "9"]);
  });

  it("backfill stops at chat start", async () => {
    const a = fakeAdapter([[msg("2", "2026-11-20T00:00:00Z")], [msg("1", "2026-11-19T00:00:00Z")]]);
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d())).toBe("chat_start");
  });

  it("backfill stops on captcha element", async () => {
    loadFixture("whatsapp");
    document.body.insertAdjacentHTML("beforeend", '<iframe src="https://example.invalid/captcha"></iframe>');
    const a = mk.whatsapp();
    const sink = new CollectSink();
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d(sink))).toBe("captcha");
    expect(sink.items).toEqual([]);
  });

  it("backfill stops on login, error banner and health failure", async () => {
    const a = fakeAdapter([[msg("1", "2026-11-20T00:00:00Z")]], () => [msg("x", "2026-11-19T00:00:00Z")]);
    a.setAnomaly("login");
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d())).toBe("login");
    a.setAnomaly("error_banner");
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d())).toBe("error_banner");
    a.setAnomaly(null);
    a.healthCheck = () => ({ ok: false, reason: "x" });
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d())).toBe("health_failure");
  });

  it("backfill stops when the tab stays hidden over 60 s", async () => {
    let t = 0;
    const a = fakeAdapter([[msg("1", "2026-11-20T00:00:00Z")]], () => [msg("x", "2026-11-19T00:00:00Z")]);
    const limiter = new RateLimiter(2000, 4000, async () => void (t += 30_000));
    const r = await runBackfill(a, new Date("2020-01-01"), limiter, new RunGuard(300, 0), { ...d(), isHidden: () => true, now: () => t });
    expect(r).toBe("tab_hidden");
    expect(a.scrolls()).toBeLessThanOrEqual(3);
  });

  it("backfill respects max steps", async () => {
    let n = 0;
    const a = fakeAdapter([[msg("0", "2026-11-20T00:00:00Z")]], () => [msg(String(++n), "2026-11-19T00:00:00Z")]);
    const g = new RunGuard(7, 600_000);
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), g, d())).toBe("max_steps");
    expect(a.scrolls()).toBe(7);
    // cool-down now applies
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), g, d())).toBe("cooldown");
  });

  it("stops when asked and when the queue is full", async () => {
    const a = fakeAdapter([[msg("1", "2026-11-20T00:00:00Z")]], () => [msg("x", "2026-11-19T00:00:00Z")]);
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { ...d(), shouldStop: () => true })).toBe("stopped");
    const full = { enqueue: () => false };
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { ...d(), sink: full })).toBe("queue_full");
  });
});

describe("catchup", () => {
  it("catchup stops at known id", async () => {
    const a = fakeAdapter([
      [msg("30", "2026-11-22T00:00:00Z")],
      [msg("20", "2026-11-21T00:00:00Z")],
      [msg("10", "2026-11-20T00:00:00Z")],
      [msg("5", "2026-11-19T00:00:00Z")],
    ]);
    const sink = new CollectSink();
    const r = await runCatchup(a, ["10", "9"], fast(), { ...d(sink) });
    expect(r).toBe("anchor_found");
    expect(a.scrolls()).toBe(2);
    expect(sink.items.map((i) => i.msg.platform_msg_id)).toEqual(["30", "20", "10"]);
  });

  it("catchup is bounded at 50 steps, and does nothing without anchors", async () => {
    let n = 0;
    const a = fakeAdapter([[msg("0", "2026-11-20T00:00:00Z")]], () => [msg(String(++n), "2026-11-19T00:00:00Z")]);
    expect(await runCatchup(a, ["nope"], fast(), d())).toBe("max_steps");
    expect(a.scrolls()).toBe(50);
    expect(await runCatchup(a, [], fast(), d())).toBe("no_anchor");
  });
});

describe("no DOM mutation by extension", () => {
  it.each(["whatsapp", "discord", "instagram", "tinder", "grindr", "bumble"] as Platform[])("%s: fixture unchanged after live capture and backfill", async (p) => {
    loadFixture(p);
    const before = document.documentElement.outerHTML;
    const a = mk[p]!();
    const sink = new CollectSink();
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => true, isAllowed: () => "ok" as const, pollMs: 60_000 });
    await live.scan();
    await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { sink, tz: "UTC", chatKey: a.currentChat()!.chat_key, isLinked: () => true });
    live.stop();
    expect(sink.items.length).toBeGreaterThan(0);
    expect(document.documentElement.outerHTML).toBe(before); // scroll position is not part of the markup
  });
});

describe("chat switch and link re-check (privacy)", () => {
  const pages = () => [[msg("30", "2026-11-22T00:00:00Z")], [msg("20", "2026-11-21T00:00:00Z")], [msg("10", "2026-11-20T00:00:00Z")]];

  it("backfill stops with chat_changed after a switch and reads nothing from the other chat", async () => {
    const a = fakeAdapter(pages());
    const sink = new CollectSink();
    a.onScroll(() => a.setChat("someone-else")); // the new rows now belong to another chat
    const r = await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), d(sink));
    expect(r).toBe("chat_changed");
    expect(sink.items.map((i) => i.msg.platform_msg_id)).toEqual(["30"]);
    expect(sink.items.every((i) => i.chat_key === "k")).toBe(true);
  });

  it("does not even scroll when the chat changes during the wait", async () => {
    const a = fakeAdapter(pages());
    const limiter = new RateLimiter(2000, 4000, async () => a.setChat("other"));
    const r = await runBackfill(a, new Date("2020-01-01"), limiter, new RunGuard(300, 0), d());
    expect(r).toBe("chat_changed");
    expect(a.scrolls()).toBe(0);
  });

  it("import stops with chat_changed and uploads only the original chat's rows", async () => {
    const a = fakeAdapter(pages());
    a.onScroll(() => a.setChat("other"));
    const up = vi.fn(async (_m: unknown[]) => undefined);
    const { sink: _s, ...base } = d();
    const r = await runImport(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), base, up);
    expect(r).toEqual({ reason: "chat_changed", count: 1 });
    expect(up.mock.calls[0][0]).toHaveLength(1);
  });

  it("catch-up stops with chat_changed", async () => {
    const a = fakeAdapter(pages());
    a.onScroll(() => a.setChat("other"));
    const sink = new CollectSink();
    expect(await runCatchup(a, ["nope"], fast(), d(sink))).toBe("chat_changed");
    expect(sink.items).toHaveLength(1);
  });

  it("stops with not_linked and reads nothing once the chat is unlinked mid-run", async () => {
    const a = fakeAdapter(pages());
    let linked = true;
    a.onScroll(() => (linked = false));
    const sink = new CollectSink();
    const r = await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { ...d(sink), isLinked: () => linked });
    expect(r).toBe("not_linked");
    expect(sink.items).toHaveLength(1);
  });
});

describe("whole-batch accept and persistent seen-set", () => {
  it("a rejected batch is not marked seen, so the rows are read again later", async () => {
    loadFixture("whatsapp");
    const a = mk.whatsapp();
    let accept = false;
    const sink = { items: [] as unknown[], enqueue(_p: string, _k: string, _t: string, m: unknown[]) { if (accept) this.items.push(...m); return accept; } };
    const live = startLiveCapture(a, sink as never, { tz: "UTC", isLinked: () => true, isAllowed: () => "ok" as const, pollMs: 60_000 });
    await live.scan();
    expect(sink.items).toHaveLength(0);
    accept = true;
    await live.scan();
    live.stop();
    expect(sink.items).toHaveLength(4);
  });

  it("queue full pauses without marking rows seen", async () => {
    loadFixture("whatsapp");
    const sink = new CollectSink();
    let state: "full" | "ok" = "full";
    const live = startLiveCapture(mk.whatsapp(), sink, { tz: "UTC", isLinked: () => true, isAllowed: () => state, pollMs: 60_000 });
    await live.scan();
    expect(sink.items).toHaveLength(0);
    state = "ok";
    await live.scan();
    live.stop();
    expect(sink.items).toHaveLength(4);
  });

  it("recycled nodes and chat switches do not re-enqueue id-less messages, duplicates in one minute stay two", async () => {
    const seen = new SeenSet(null);
    const mkKey = () => seenKeys([
      { ts_local: "2026-11-22T15:48", ts_precision: "minute", direction: "outgoing", speaker_raw: "Me", text: "ok" },
      { ts_local: "2026-11-22T15:48", ts_precision: "minute", direction: "outgoing", speaker_raw: "Me", text: " OK " },
    ]);
    const k1 = mkKey();
    expect(new Set(k1).size).toBe(2);
    seen.stage(k1);
    await seen.commit();
    expect(mkKey().every((k) => seen.has(k))).toBe(true);

    loadFixture("whatsapp");
    const sink = new CollectSink();
    const shared = new SeenSet(null);
    for (let i = 0; i < 2; i++) {
      loadFixture("whatsapp"); // new nodes each time, new Harvester each time (as on a chat switch)
      const live = startLiveCapture(mk.whatsapp(), sink, { tz: "UTC", isLinked: () => true, isAllowed: () => "ok" as const, seenFor: () => shared, pollMs: 60_000 });
      await live.scan();
      live.stop();
    }
    expect(sink.items).toHaveLength(4);
  });

  it("the seen-set is bounded and persisted by chat", async () => {
    const mem: Record<string, unknown> = {};
    const store = { get: async (k: string) => (k in mem ? { [k]: mem[k] } : {}), set: async (o: Record<string, unknown>) => void Object.assign(mem, o) };
    const s = await SeenSet.forChat("whatsapp", "X", store);
    s.stage(Array.from({ length: SEEN_CAP + 50 }, (_, i) => String(i)));
    await s.commit();
    expect((mem["seen:whatsapp:X"] as string[]).length).toBe(SEEN_CAP);
    const again = await SeenSet.forChat("whatsapp", "X", store);
    expect(again.has(String(SEEN_CAP + 49))).toBe(true);
    expect(again.has("0")).toBe(false);
  });
});
