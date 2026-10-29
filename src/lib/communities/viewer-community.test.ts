import { describe, expect, it } from "vitest";
import { pickViewerCommunity, type ViewerCommunity } from "./viewer-community";

const c = (id: string, name: string, joined_at: string): ViewerCommunity => ({ id, name, timezone: "America/Chicago", joined_at });

// Jason on 2026-10-27: active in six communities. The Community page took
// whichever row came back first and showed 11am CST Braveman.
const JASON = [
  c("11am", "11am CST Braveman", "2026-08-24T15:00:00Z"),
  c("tribe", "The Dad Edge Brave Man Tribe", "2026-08-24T15:00:00Z"),
  c("bob", "The Dad Edge Business Owner Brotherhood", "2026-08-04T12:00:00Z"),
  c("10am", "10am CST Braveman", "2026-08-24T15:00:00Z"),
];

describe("pickViewerCommunity", () => {
  it("defaults to the community he joined first, whatever order the rows come in", () => {
    expect(pickViewerCommunity(JASON, undefined)?.id).toBe("bob");
    expect(pickViewerCommunity([...JASON].reverse(), undefined)?.id).toBe("bob");
  });

  it("breaks a joined-at tie by name, so the default never flips between visits", () => {
    const tied = JASON.filter((x) => x.id !== "bob");
    expect(pickViewerCommunity(tied, undefined)?.id).toBe("10am");
    expect(pickViewerCommunity([...tied].reverse(), undefined)?.id).toBe("10am");
  });

  it("uses the one he picked, if he's a member of it", () => {
    expect(pickViewerCommunity(JASON, "11am")?.id).toBe("11am");
  });

  it("ignores a pick he isn't a member of", () => {
    expect(pickViewerCommunity(JASON, "someone-elses")?.id).toBe("bob");
  });

  it("null when he has no active community", () => {
    expect(pickViewerCommunity([], undefined)).toBeNull();
  });
});
