import { describe, expect, it } from "vitest";
import { CATCHUP_COOLDOWN_MS, catchupDecision, scrollRunBlocked } from "../src/decisions";
import { RunGuard } from "../src/ratelimit";

const base = { linkedLocally: true, catchupEnabled: true, allowed: "ok" as const, running: false, lastAt: 0, now: 10 * CATCHUP_COOLDOWN_MS };

describe("catch-up decision (content script I1)", () => {
  it("asks the server only for chats already linked locally", () => {
    expect(catchupDecision({ ...base, linkedLocally: false })).toBe("skip_unlinked");
    expect(catchupDecision(base)).toBe("go");
  });
  it("unlinked wins over every other setting", () => {
    expect(catchupDecision({ ...base, linkedLocally: false, catchupEnabled: false, running: true })).toBe("skip_unlinked");
  });
  it("respects the toggle, pause/full, running work and the 2-minute cool-down", () => {
    expect(catchupDecision({ ...base, catchupEnabled: false })).toBe("skip_disabled");
    expect(catchupDecision({ ...base, allowed: "paused" })).toBe("skip_disabled");
    expect(catchupDecision({ ...base, allowed: "full" })).toBe("skip_disabled");
    expect(catchupDecision({ ...base, running: true })).toBe("skip_busy");
    expect(catchupDecision({ ...base, lastAt: base.now - CATCHUP_COOLDOWN_MS + 1 })).toBe("skip_cooldown");
    expect(catchupDecision({ ...base, lastAt: base.now - CATCHUP_COOLDOWN_MS })).toBe("go");
  });
});

describe("scrolling run gate (content script I2)", () => {
  it("blocks scrolling runs inside the cool-down, also after a reload that restored the start time", () => {
    let t = 1_000_000;
    const restored = new RunGuard(300, 600_000, () => t, t - 60_000); // run_end persisted when the run started
    expect(scrollRunBlocked(true, restored)).toBe("cooldown");
    t += 600_000;
    expect(scrollRunBlocked(true, restored)).toBeNull();
  });
  it("does not gate an import that only reads the screen", () => {
    const g = new RunGuard(300, 600_000, () => 1, 0);
    expect(scrollRunBlocked(false, g)).toBeNull();
    expect(scrollRunBlocked(true, g)).toBe("cooldown");
  });
});
