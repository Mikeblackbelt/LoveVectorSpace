import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS } from "../src/storage";
import { mountPopup, type PopupDeps, type PopupState } from "../src/popup/view";
import type { ExtSummary } from "../src/api";

HTMLCanvasElement.prototype.getContext = () => null; // jsdom has no canvas
const state: PopupState = { prefs: DEFAULT_PREFS, health: {}, runs: {}, queueLength: 2, queueFull: false, storageError: false, rejected: 0, lastFlush: null };
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
    importPage: vi.fn(async () => ({ started: true })),
    stopRun: async () => undefined,
    state: async () => state,
    savePrefs: async () => undefined,
    openOptions: () => undefined,
    dismissRejected: vi.fn(async () => undefined),
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
    for (const id of ["tgl-whatsapp", "tgl-discord", "tgl-instagram", "tgl-tinder", "tgl-grindr", "tgl-bumble", "tgl-catchup", "import", "pause", "backfill"]) {
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

  it("import this page needs a linked chat and calls importPage with the optional date", async () => {
    const root = document.createElement("div");
    const d = deps({ summary: async () => ({ ...base, linked: false, person: null }) });
    await mountPopup(root, d);
    expect(root.querySelector("#import")).toBeNull();
    expect(root.textContent).toContain("until you link it");
    const root2 = document.createElement("div");
    const d2 = deps();
    await mountPopup(root2, d2);
    (root2.querySelector("#import-back") as HTMLInputElement).value = "2026-10-01";
    (root2.querySelector("#import") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(d2.importPage).toHaveBeenCalledWith("2026-10-01"));
  });

  it("shows progress and a stop button while importing", async () => {
    const root = document.createElement("div");
    const runs = { whatsapp: { kind: "import" as const, status: "running" as const, step: 4, maxSteps: 300, at: 0 } };
    const d = deps({ state: async () => ({ ...state, runs }) });
    await mountPopup(root, d);
    expect(root.textContent).toContain("step 4/300");
    expect(root.querySelector("canvas")).not.toBeNull();
    (root.querySelector("#import-stop") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector("#import-stop")).not.toBeNull());
  });

  it("surfaces rejected messages and storage errors", async () => {
    const root = document.createElement("div");
    await mountPopup(root, deps({ state: async () => ({ ...state, rejected: 3, storageError: true }) }));
    expect(root.textContent).toContain("3 message(s) were rejected");
    expect(root.textContent).toContain("storage is full");
  });

  it("dismissing the rejected warning resets the counter", async () => {
    const root = document.createElement("div");
    const d = deps({ state: async () => ({ ...state, rejected: 2 }) });
    await mountPopup(root, d);
    (root.querySelector("#dismiss-rejected") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(d.dismissRejected).toHaveBeenCalled());
  });

  it("warns when only one side is detected", async () => {
    const root = document.createElement("div");
    await mountPopup(root, deps({ chat: async () => ({ ...chat, direction_uncertain: true }) }));
    expect(root.textContent).toContain("Only one side detected");
    expect(root.textContent).toContain("SELECTORS.md");
    const clean = document.createElement("div");
    await mountPopup(clean, deps());
    expect(clean.textContent).not.toContain("Only one side detected");
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
