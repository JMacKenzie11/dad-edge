import { describe, expect, it } from "vitest";
import { fromHeader } from "./email-from";

describe("fromHeader", () => {
  it("puts the app's name in front of a bare address, so inboxes show the name", () => {
    expect(fromHeader("no-reply@dadedgeoperatingsystem.com")).toBe(
      "Dad Edge Operating System <no-reply@dadedgeoperatingsystem.com>",
    );
    expect(fromHeader("  no-reply@dadedgeoperatingsystem.com ")).toBe(
      "Dad Edge Operating System <no-reply@dadedgeoperatingsystem.com>",
    );
  });

  it("keeps a sender that already names itself", () => {
    expect(fromHeader("Brave Man <hi@example.com>")).toBe("Brave Man <hi@example.com>");
  });

  it("falls back to the app's name on the dev address when nothing is set", () => {
    expect(fromHeader(undefined)).toBe("Dad Edge Operating System <noreply@dadedge.local>");
    expect(fromHeader("")).toBe("Dad Edge Operating System <noreply@dadedge.local>");
  });
});
