import { describe, expect, it } from "vitest";
import { resolveCommunity, resolveForKey } from "./resolve";

const C = [
  { id: "1", name: "Austin Brotherhood", slug: "austin" },
  { id: "2", name: "Dallas North", slug: "dallas-north" },
  { id: "3", name: "Dallas South", slug: "dallas-south" },
];

describe("resolveCommunity", () => {
  it("matches the slug or the name", () => {
    expect(resolveCommunity("austin", C)).toMatchObject({ kind: "match", community: { id: "1" } });
    expect(resolveCommunity("Dallas North", C)).toMatchObject({ kind: "match", community: { id: "2" } });
  });

  it("matches how a person says it", () => {
    expect(resolveCommunity("the Austin group", C)).toMatchObject({ kind: "match", community: { id: "1" } });
    expect(resolveCommunity("dallas south community", C)).toMatchObject({ kind: "match", community: { id: "3" } });
  });

  it("never guesses between two", () => {
    const r = resolveCommunity("Dallas", C);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.choices.map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("returns the choices when nothing matches", () => {
    const r = resolveCommunity("Houston", C);
    expect(r.kind).toBe("none");
    expect(resolveCommunity("the group", C).kind).toBe("none");
  });
});

describe("resolveForKey", () => {
  const onlyAustin = (id: string) => id === "1";

  it("refuses a community the key can't read instead of matching another", () => {
    const All = [...C, { id: "4", name: "Austin South", slug: "austin-south" }];
    const r = resolveForKey("Austin South", All, (id) => id === "1");
    expect(r.kind).toBe("not_allowed");
  });

  it("doesn't fall back to a partial match the key can see", () => {
    const All = [{ id: "1", name: "E2E Basecamp", slug: "e2e-basecamp" }, { id: "2", name: "The Basecamp", slug: "basecamp" }];
    const r = resolveForKey("basecamp", All, (id) => id === "1");
    expect(r).toMatchObject({ kind: "not_allowed", community: { id: "2" } });
  });

  it("matches inside what the key covers", () => {
    expect(resolveForKey("austin", C, onlyAustin)).toMatchObject({ kind: "match", community: { id: "1" } });
  });

  it("lists only the communities the key covers as choices", () => {
    const r = resolveForKey("Houston", C, onlyAustin);
    expect(r.kind).toBe("none");
    if (r.kind === "none") expect(r.choices.map((c) => c.id)).toEqual(["1"]);
  });
});
