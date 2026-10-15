import { describe, expect, it } from "vitest";
import { bind, buildSql, judge, newIds, parseResults, PROBES, type Probe } from "./rls-hazards";

const read = (expect: "zero" | "some"): Probe => ({ id: "X", what: "x", kind: "read", as: "bob", sql: "", control: "", expect });
const write = (expect: "allow" | "refuse", detail?: RegExp): Probe => ({ id: "W", what: "w", kind: "write", as: "alice", sql: "", expect, detail });

describe("judge", () => {
  it("a zero only passes beside a control that found rows", () => {
    expect(judge(read("zero"), { id: "X", outcome: "count", n: 0, control: 3 }).pass).toBe(true);
    expect(judge(read("zero"), { id: "X", outcome: "count", n: 0, control: 0 }).pass).toBe(false);
    expect(judge(read("zero"), { id: "X", outcome: "count", n: 1, control: 3 }).pass).toBe(false);
  });

  it("an RLS-filtered update (0 rows) counts as refused; a write that lands doesn't", () => {
    expect(judge(write("refuse"), { id: "W", outcome: "ok", rows: 0 }).pass).toBe(true);
    expect(judge(write("refuse"), { id: "W", outcome: "ok", rows: 1 }).pass).toBe(false);
    expect(judge(write("allow"), { id: "W", outcome: "ok", rows: 0 }).pass).toBe(false);
  });

  it("a refusal must come from the expected rule when one is named", () => {
    const p = write("refuse", /mission_cap:domain:B/);
    expect(judge(p, { id: "W", outcome: "error", err: "two Bond", detail: "mission_cap:domain:B:2026-10-19" }).pass).toBe(true);
    expect(judge(p, { id: "W", outcome: "error", err: "violates row-level security", detail: "" }).pass).toBe(false);
  });

  it("a missing result is a failure, not a pass", () => {
    expect(judge(read("zero"), undefined).pass).toBe(false);
  });
});

describe("buildSql", () => {
  const sql = buildSql(PROBES, newIds(), "create policy x on public.missions for select using (true);");

  it("runs everything in one transaction that can't commit", () => {
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql).toMatch(/raise exception 'PROBE_RESULTS:%'/);
    expect(sql.trim().endsWith("rollback;")).toBe(true);
    expect(sql).not.toMatch(/^\s*commit\s*;/im);
  });

  it("applies a pending migration inside that transaction, before the probes", () => {
    expect(sql.indexOf("create policy x")).toBeGreaterThan(sql.indexOf("begin;"));
    expect(sql.indexOf("create policy x")).toBeLessThan(sql.indexOf("do $probe$"));
  });

  it("plants the self-check: a deliberately wrong policy and a right one", () => {
    expect(sql).toMatch(/zz_probe_leaky[\s\S]*using \(true\)/);
    expect(PROBES.find((p) => p.id === "CTRL-leak")).toMatchObject({ expect: "some" });
  });

  it("pairs writes: every table probed for an allowed write is also probed for a refused one", () => {
    const table = (sql: string) => sql.match(/(?:insert into|update|delete from) ([\w.]+)/)?.[1];
    const writes = PROBES.filter((p) => p.kind === "write");
    const allowed = new Set(writes.filter((p) => p.expect === "allow").map((p) => table(p.sql)));
    const refused = new Set(writes.filter((p) => p.expect === "refuse").map((p) => table(p.sql)));
    for (const t of allowed) expect(refused.has(t), `no refused-write probe for ${t}`).toBe(true);
  });
});

describe("helpers", () => {
  it("binds :names to uuid literals and leaves other colons alone", () => {
    const ids = newIds();
    expect(bind("where a = :alice and b::text = 'x'", ids)).toBe(`where a = '${ids.alice}'::uuid and b::text = 'x'`);
  });

  it("decodes the results the transaction raises", () => {
    const payload = Buffer.from(JSON.stringify([{ id: "M1", outcome: "count", n: 0, control: 1 }])).toString("base64");
    expect(parseResults(`ERROR: P0001: PROBE_RESULTS:${payload}\nCONTEXT: ...`)).toEqual([{ id: "M1", outcome: "count", n: 0, control: 1 }]);
    expect(parseResults("ERROR: syntax error")).toBeNull();
  });
});
