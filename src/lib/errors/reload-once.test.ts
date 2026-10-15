import { describe, expect, it } from "vitest";
import { RELOAD_WINDOW_MS, shouldAutoReload } from "./reload-once";

describe("shouldAutoReload", () => {
  const now = 1_000_000;

  it("reloads when this tab hasn't reloaded itself yet", () => {
    expect(shouldAutoReload(null, now)).toBe(true);
  });

  it("doesn't reload again straight after its own reload, so a real bug can't loop", () => {
    expect(shouldAutoReload(String(now - 2_000), now)).toBe(false);
  });

  it("reloads again once the window has passed", () => {
    expect(shouldAutoReload(String(now - RELOAD_WINDOW_MS - 1), now)).toBe(true);
  });

  it("treats a junk stored value as no earlier reload", () => {
    expect(shouldAutoReload("not a number", now)).toBe(true);
  });
});
