import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "../src/storage";
import { mountPopup, type PopupDeps, type PopupState } from "../src/popup/view";
import type { ExtSummary } from "../src/api";

const state: PopupState = { prefs: DEFAULT_PREFS, health: {}, runs: {}, queueLength: 2, queueFull: false, lastFlush: null };
const chat = { platform: "whatsapp" as const, chat_key: "Yu Cheng", title: "Yu Cheng", health: { ok: true }, cooldown_left_ms: 0 };
const base: ExtSummary = { linked: true, person: { id: 1, pseudonym: "Yu Cheng" }, total: 4812, today: 23, last7d: 184, my_share_30d: 0.66, last_captured_ts: null, last_captured_ids: [] };

function deps(over: Partial<PopupDeps> = {}): PopupDeps {
  return {
    configured: async () => true,
    chat: async () => chat,
    summary: async () => base,
    people: async () => [{ id: 1, pseudonym: "Yu Cheng" }],
    link: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
    startBackfill: async () => ({ started: true }),
    stopRun: async () => undefined,
    state: async () => state,
    savePrefs: async () => undefined,
    openOptions: () => undefined,
    ...over,
  };
}

describe("popup", () => {
  it("popup shows summary without text", async () => {
    // Even if a server (wrongly) sent message text, the popup only renders the numeric fields.
    const leaky = { ...base, text: "SECRET MESSAGE TEXT", messages: [{ text: "SECRET" }] } as ExtSummary;
    const root = document.createElement("div");
    await mountPopup(root, deps({ summary: async () => leaky }));
    expect(root.textContent).toContain("4,812");
    expect(root.textContent).toContain("184");
    expect(root.textContent).toContain("66%");
    expect(root.textContent).not.toContain("SECRET");
  });

  it("shows the Discord risk note and per-platform toggles", async () => {
    const root = document.createElement("div");
    await mountPopup(root, deps());
    expect(root.textContent).toContain("prohibit automating account actions");
    for (const id of ["tgl-whatsapp", "tgl-discord", "tgl-instagram", "tgl-catchup", "pause", "backfill"]) {
      expect(root.querySelector(`#${id}`), id).not.toBeNull();
    }
  });

  it("offers linking for an unlinked chat and hides backfill", async () => {
    const root = document.createElement("div");
    const d = deps({ summary: async () => ({ ...base, linked: false, person: null }) });
    await mountPopup(root, d);
    expect(root.querySelector("#backfill")).toBeNull();
    (root.querySelector("#link") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(d.link).toHaveBeenCalledWith(1, "whatsapp", "Yu Cheng", "Yu Cheng"));
  });

  it("warns about selectors and a full queue", async () => {
    const root = document.createElement("div");
    await mountPopup(
      root,
      deps({
        chat: async () => ({ ...chat, health: { ok: false, reason: "selector not found: shell" } }),
        state: async () => ({ ...state, queueFull: true }),
      }),
    );
    expect(root.textContent).toContain("Update selectors");
    expect(root.textContent).toContain("5,000");
  });
});
