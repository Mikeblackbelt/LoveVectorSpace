import { describe, expect, it, vi } from "vitest";
import { createDiscordAdapter } from "../src/adapters/discord";
import { createInstagramAdapter } from "../src/adapters/instagram";
import { createWhatsAppAdapter } from "../src/adapters/whatsapp";
import { parseLooseTimestamp, parseWhatsAppMeta } from "../src/adapters/time";
import type { Platform, SiteAdapter } from "../src/adapters/types";
import { runBackfill } from "../src/capture/backfill";
import { runCatchup } from "../src/capture/catchup";
import { startLiveCapture } from "../src/capture/live";
import { RateLimiter, RunGuard } from "../src/ratelimit";
import { CollectSink, fakeAdapter, loadFixture, msg } from "./helpers";

const fast = () => new RateLimiter(2000, 4000, async () => undefined);
const mk: Record<Platform, () => SiteAdapter> = {
  whatsapp: () => createWhatsAppAdapter({ doc: document, url: () => "https://web.whatsapp.com/", loadWaitMs: 60 }),
  discord: () => createDiscordAdapter({ doc: document, url: () => "https://discord.com/channels/@me/900", loadWaitMs: 60 }),
  instagram: () => createInstagramAdapter({ doc: document, url: () => "https://www.instagram.com/direct/t/555/", loadWaitMs: 60, now: () => new Date(2026, 10, 23) }),
};
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

describe("system and media lines skipped", () => {
  it.each(["whatsapp", "discord", "instagram"] as Platform[])("%s: no empty or system text", (p) => {
    loadFixture(p);
    const a = mk[p]();
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
  it.each(["whatsapp", "discord", "instagram"] as Platform[])("%s: healthCheck fails on changed fixture, capture disabled, nothing queued", async (p) => {
    loadFixture(p);
    expect(mk[p]().healthCheck()).toEqual({ ok: true });
    loadFixture(p, "changed");
    const a = mk[p]();
    const h = a.healthCheck();
    expect(h.ok).toBe(false);
    const sink = new CollectSink();
    const onHealth = vi.fn();
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => true, isAllowed: () => true, onHealth, pollMs: 60_000 });
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
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => false, isAllowed: () => true, pollMs: 60_000 });
    await live.scan();
    live.stop();
    expect(extract).not.toHaveBeenCalled();
    expect(sink.items).toEqual([]);
  });

  it("captures visible and newly added messages once each, with the browser tz", async () => {
    loadFixture("discord");
    const sink = new CollectSink();
    const live = startLiveCapture(mk.discord(), sink, { tz: "America/New_York", isLinked: () => true, isAllowed: () => true, debounceMs: 0, pollMs: 60_000 });
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
    const live = startLiveCapture(mk.whatsapp(), sink, { tz: "UTC", isLinked: () => true, isAllowed: () => false, pollMs: 60_000 });
    await live.scan();
    live.stop();
    expect(sink.items).toEqual([]);
  });
});

describe("backfill", () => {
  const d = (sink = new CollectSink()) => ({ sink, tz: "UTC" });

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
    expect(await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { sink: full, tz: "UTC" })).toBe("queue_full");
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
    const r = await runCatchup(a, ["10", "9"], fast(), { sink, tz: "UTC" });
    expect(r).toBe("anchor_found");
    expect(a.scrolls()).toBe(2);
    expect(sink.items.map((i) => i.msg.platform_msg_id)).toEqual(["30", "20", "10"]);
  });

  it("catchup is bounded at 50 steps, and does nothing without anchors", async () => {
    let n = 0;
    const a = fakeAdapter([[msg("0", "2026-11-20T00:00:00Z")]], () => [msg(String(++n), "2026-11-19T00:00:00Z")]);
    expect(await runCatchup(a, ["nope"], fast(), { sink: new CollectSink(), tz: "UTC" })).toBe("max_steps");
    expect(a.scrolls()).toBe(50);
    expect(await runCatchup(a, [], fast(), { sink: new CollectSink(), tz: "UTC" })).toBe("no_anchor");
  });
});

describe("no DOM mutation by extension", () => {
  it.each(["whatsapp", "discord", "instagram"] as Platform[])("%s: fixture unchanged after live capture and backfill", async (p) => {
    loadFixture(p);
    const before = document.documentElement.outerHTML;
    const a = mk[p]();
    const sink = new CollectSink();
    const live = startLiveCapture(a, sink, { tz: "UTC", isLinked: () => true, isAllowed: () => true, pollMs: 60_000 });
    await live.scan();
    await runBackfill(a, new Date("2020-01-01"), fast(), new RunGuard(300, 0), { sink, tz: "UTC" });
    live.stop();
    expect(sink.items.length).toBeGreaterThan(0);
    expect(document.documentElement.outerHTML).toBe(before); // scroll position is not part of the markup
  });
});
