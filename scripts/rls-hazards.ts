/**
 * Permission probes: run the database's row-level security as real members
 * and check what each can and can't read or write.
 *
 *   npm run rls:hazards                              all probes, dev database
 *   npm run rls:hazards -- --pending supabase/migrations/<file>.sql
 *                                                    apply an unlanded migration first
 *   npm run rls:hazards -- --json                    machine-readable results
 *
 * Local only, never in CI: it needs a Supabase management login and the
 * shared dev database. It refuses to run unless the CLI is linked to a dev
 * project (checked by project id, scripts/lib/supabase-cli.ts).
 *
 * How it stays honest:
 *   - Everything happens inside ONE transaction that ends by raising its
 *     results as an error, so it always rolls back. Fixtures, the pending
 *     migration and every probe's writes are gone when it returns.
 *   - Each probe runs as the `authenticated` role with JWT claims for a real
 *     (fixture) user, exactly as a browser session would.
 *   - Write probes come in pairs: the write a member must be able to make,
 *     and one the same member must be refused.
 *   - A zero only passes beside a control: every "can't see it" probe also
 *     counts the rows as the table owner, and fails if that count is zero.
 *   - Self-check: each run plants a deliberately wrong policy on a scratch
 *     table and asserts the probe sees the leak. If it doesn't, the checker
 *     is broken and the whole run fails, so "all green" can't come from a
 *     probe that can no longer see anything.
 *
 * Rule (CLAUDE.md): a permission widening ships with its policy change and
 * a probe here in the same PR, shown red before the fix. See
 * docs/failure-modes.md FM-6 for why.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isEntryPoint } from "./lib/entry";
import { assertLinkedDev, runLinkedSql } from "./lib/supabase-cli";

export type Who = "alice" | "bob" | "carol";

export type Probe =
  | {
      id: string;
      what: string;
      kind: "read";
      as: Who;
      /** select count(*) as the member */
      sql: string;
      /** the same rows counted as the table owner (must be > 0 for "zero") */
      control: string;
      expect: "zero" | "some";
    }
  | {
      id: string;
      what: string;
      kind: "write";
      as: Who;
      sql: string;
      expect: "allow" | "refuse";
      /** for refusals that must come from a specific rule */
      detail?: RegExp;
    };

export type Observation = {
  id: string;
  outcome: "count" | "ok" | "error";
  n?: number;
  control?: number;
  rows?: number;
  err?: string;
  detail?: string;
};

// ---------------------------------------------------------------------------
// The probes
// ---------------------------------------------------------------------------
//
// Fixtures (all inside the rolled-back transaction):
//   alice, bob: members of community A.   carol: member of community B.
//   alice has a domain mission next week, a check-in, a reflection, a
//   partner profile and a goal. Courses: open (published, all
//   communities), draft (unpublished), onlyB (published, community B),
//   each sectioned, with one section holding its one lesson.
//   One object in the private lesson-files bucket.

const NEXT_MON = "date_trunc('week', current_date + 7)::date";

export const PROBES: Probe[] = [
  // Self-check controls: the scratch tables are created by the harness.
  { id: "CTRL-leak", what: "planted wrong policy: bob reads alice's scratch row (MUST leak)", kind: "read", as: "bob",
    sql: "select count(*) from public.zz_probe_leaky where owner = :alice", control: "select count(*) from public.zz_probe_leaky where owner = :alice", expect: "some" },
  { id: "CTRL-tight", what: "correct policy: bob can't read alice's scratch row", kind: "read", as: "bob",
    sql: "select count(*) from public.zz_probe_tight where owner = :alice", control: "select count(*) from public.zz_probe_tight where owner = :alice", expect: "zero" },

  // Missions: self + community-mates read; only self writes.
  { id: "M1", what: "carol (other community) can't read alice's missions", kind: "read", as: "carol",
    sql: "select count(*) from public.missions where user_id = :alice", control: "select count(*) from public.missions where user_id = :alice", expect: "zero" },
  { id: "M2", what: "bob (same community) can read alice's missions", kind: "read", as: "bob",
    sql: "select count(*) from public.missions where user_id = :alice", control: "select count(*) from public.missions where user_id = :alice", expect: "some" },
  { id: "M3", what: "alice can edit her own mission", kind: "write", as: "alice",
    sql: "update public.missions set description = 'Call her at lunch, edited' where user_id = :alice", expect: "allow" },
  { id: "M4", what: "bob can't edit alice's mission", kind: "write", as: "bob",
    sql: "update public.missions set description = 'hijacked' where user_id = :alice", expect: "refuse" },
  { id: "M5", what: "alice can add a second Bond mission next week", kind: "write", as: "alice",
    sql: `insert into public.missions (user_id, community_id, description, pillar_code, target_date, target_dates, created_by) values (:alice, :commA, 'Book date night', 'B', ${NEXT_MON} + 2, array[${NEXT_MON} + 2], 'user')`, expect: "allow" },
  { id: "M6", what: "alice can't add a third Bond mission next week (weekly cap)", kind: "write", as: "alice",
    sql: `insert into public.missions (user_id, community_id, description, pillar_code, target_date, target_dates, created_by) values (:alice, :commA, 'Write her a note', 'B', ${NEXT_MON} + 3, array[${NEXT_MON} + 3], 'user')`, expect: "refuse", detail: /mission_cap:domain:B/ },
  { id: "M7", what: "alice can't create a mission for bob", kind: "write", as: "alice",
    sql: `insert into public.missions (user_id, community_id, description, pillar_code, target_date, target_dates, created_by) values (:bob, :commA, 'Not his to set', 'R', ${NEXT_MON} + 1, array[${NEXT_MON} + 1], 'user')`, expect: "refuse" },

  // Check-ins: self + community-mates read; only self writes.
  { id: "C1", what: "carol can't read alice's check-ins", kind: "read", as: "carol",
    sql: "select count(*) from public.daily_checkins where user_id = :alice", control: "select count(*) from public.daily_checkins where user_id = :alice", expect: "zero" },
  { id: "C2", what: "alice can log her own check-in", kind: "write", as: "alice",
    sql: "insert into public.daily_checkins (user_id, date, pillar_code, value) values (:alice, current_date - 1, 'R', 1)", expect: "allow" },
  { id: "C3", what: "alice can't log a check-in for bob", kind: "write", as: "alice",
    sql: "insert into public.daily_checkins (user_id, date, pillar_code, value) values (:bob, current_date, 'B', 1)", expect: "refuse" },

  // Reflections, partner profile: self only, even for community-mates.
  { id: "F1", what: "bob can't read alice's reflections", kind: "read", as: "bob",
    sql: "select count(*) from public.daily_reflections where user_id = :alice", control: "select count(*) from public.daily_reflections where user_id = :alice", expect: "zero" },
  { id: "F2", what: "alice can edit her own reflection", kind: "write", as: "alice",
    sql: "update public.daily_reflections set wins = 'Called her at lunch' where user_id = :alice", expect: "allow" },
  { id: "F3", what: "bob can't delete alice's reflection", kind: "write", as: "bob",
    sql: "delete from public.daily_reflections where user_id = :alice", expect: "refuse" },
  { id: "P1", what: "bob can't read alice's partner profile", kind: "read", as: "bob",
    sql: "select count(*) from public.partner_profiles where user_id = :alice", control: "select count(*) from public.partner_profiles where user_id = :alice", expect: "zero" },

  // Goals: self (and the member's leader) read; only self writes.
  { id: "G1", what: "bob (member, not leader) can't read alice's goals", kind: "read", as: "bob",
    sql: "select count(*) from public.quarterly_goals where user_id = :alice", control: "select count(*) from public.quarterly_goals where user_id = :alice", expect: "zero" },
  { id: "G2", what: "alice can set a third goal (no cap)", kind: "write", as: "alice",
    sql: "insert into public.quarterly_goals (user_id, quarter_start, focus_area, desired_end_state, status, source) values (:alice, date_trunc('quarter', current_date)::date, 'R', 'Home for bedtime five nights a week', 'active', 'user')", expect: "allow" },
  { id: "G3", what: "alice can't set a goal for bob", kind: "write", as: "alice",
    sql: "insert into public.quarterly_goals (user_id, quarter_start, focus_area, desired_end_state, status, source) values (:bob, date_trunc('quarter', current_date)::date, 'R', 'Not his', 'active', 'user')", expect: "refuse" },

  // Messaging: threads only between members of a shared community (FM-6).
  { id: "T1", what: "alice can open a thread with bob (same community)", kind: "write", as: "alice",
    sql: "insert into public.message_threads (participant_a, participant_b) values (least(:alice, :bob), greatest(:alice, :bob))", expect: "allow" },
  { id: "T2", what: "alice can't open a thread with carol (other community)", kind: "write", as: "alice",
    sql: "insert into public.message_threads (participant_a, participant_b) values (least(:alice, :carol), greatest(:alice, :carol))", expect: "refuse" },

  // Resource Library.
  { id: "R1", what: "alice can't see the draft course", kind: "read", as: "alice",
    sql: "select count(*) from public.courses where id = :draft", control: "select count(*) from public.courses where id = :draft", expect: "zero" },
  { id: "R2", what: "alice can't see community B's course", kind: "read", as: "alice",
    sql: "select count(*) from public.courses where id = :onlyB", control: "select count(*) from public.courses where id = :onlyB", expect: "zero" },
  { id: "R3", what: "carol can see community B's course", kind: "read", as: "carol",
    sql: "select count(*) from public.courses where id = :onlyB", control: "select count(*) from public.courses where id = :onlyB", expect: "some" },
  { id: "R4", what: "alice can complete a lesson in the open course", kind: "write", as: "alice",
    sql: "insert into public.lesson_completions (user_id, lesson_id) values (:alice, :openLesson)", expect: "allow" },
  { id: "R5", what: "alice can't complete a draft lesson", kind: "write", as: "alice",
    sql: "insert into public.lesson_completions (user_id, lesson_id) values (:alice, :draftLesson)", expect: "refuse" },
  { id: "R6", what: "alice can't record a completion for bob", kind: "write", as: "alice",
    sql: "insert into public.lesson_completions (user_id, lesson_id) values (:bob, :openLesson)", expect: "refuse" },
  { id: "R7", what: "alice can't publish a course", kind: "write", as: "alice",
    sql: "update public.courses set is_published = true where id = :draft", expect: "refuse" },
  { id: "R8", what: "alice can't see any object in the private PDF bucket", kind: "read", as: "alice",
    sql: "select count(*) from storage.objects where bucket_id = 'lesson-files' and name like 'zz-probe/%'", control: "select count(*) from storage.objects where bucket_id = 'lesson-files' and name like 'zz-probe/%'", expect: "zero" },
  { id: "R9", what: "alice can't put a file in the private PDF bucket", kind: "write", as: "alice",
    sql: "insert into storage.objects (bucket_id, name) values ('lesson-files', 'zz-probe/planted.pdf')", expect: "refuse" },

  // Course sections: readable exactly where the course is; admin-only writes.
  { id: "S1", what: "alice can see the open course's sections", kind: "read", as: "alice",
    sql: "select count(*) from public.course_sections where course_id = :open", control: "select count(*) from public.course_sections where course_id = :open", expect: "some" },
  { id: "S2", what: "alice can't see the draft course's sections", kind: "read", as: "alice",
    sql: "select count(*) from public.course_sections where course_id = :draft", control: "select count(*) from public.course_sections where course_id = :draft", expect: "zero" },
  { id: "S3", what: "alice can't see community B's course sections", kind: "read", as: "alice",
    sql: "select count(*) from public.course_sections where course_id = :onlyB", control: "select count(*) from public.course_sections where course_id = :onlyB", expect: "zero" },
  { id: "S4", what: "alice can't add a section to a course", kind: "write", as: "alice",
    sql: "insert into public.course_sections (course_id, title, sort_order) values (:open, 'Planted', 9)", expect: "refuse" },
  { id: "S5", what: "alice can't rename a section", kind: "write", as: "alice",
    sql: "update public.course_sections set title = 'Renamed' where course_id = :open", expect: "refuse" },
  { id: "S6", what: "alice can't switch a course's sections off", kind: "write", as: "alice",
    sql: "select public.set_course_sections(:open, false)", expect: "refuse" },
];

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

export type Ids = Record<"alice" | "bob" | "carol" | "commA" | "commB" | "open" | "draft" | "onlyB" | "openLesson" | "draftLesson" | "onlyBLesson" | "openSection" | "draftSection" | "onlyBSection", string>;

export function newIds(): Ids {
  const keys: (keyof Ids)[] = ["alice", "bob", "carol", "commA", "commB", "open", "draft", "onlyB", "openLesson", "draftLesson", "onlyBLesson", "openSection", "draftSection", "onlyBSection"];
  return Object.fromEntries(keys.map((k) => [k, randomUUID()])) as Ids;
}

/** Replaces :name placeholders with uuid literals. */
export function bind(sql: string, ids: Ids): string {
  return sql.replace(/:([a-zA-Z]+)/g, (whole, name: string) =>
    name in ids ? `'${ids[name as keyof Ids]}'::uuid` : whole,
  );
}

const q = (s: string) => `$q$${s}$q$`;

function fixturesSql(ids: Ids): string {
  const users = (["alice", "bob", "carol"] as const)
    .map((u) => `('${ids[u]}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-probe-${u}-${ids[u].slice(0, 8)}@braveman.test', now(), now())`)
    .join(",\n    ");
  return `
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
    ${users};
  update public.users set subscription_status = 'comped', onboarding_step = 6 where id in ('${ids.alice}', '${ids.bob}', '${ids.carol}');
  insert into public.communities (id, name, slug) values
    ('${ids.commA}', '[IT-TEST] probe A', 'zz-probe-a-${ids.commA.slice(0, 8)}'),
    ('${ids.commB}', '[IT-TEST] probe B', 'zz-probe-b-${ids.commB.slice(0, 8)}');
  -- Platform admins are auto-added to every new community; the probes
  -- need communities holding only the fixture members.
  delete from public.memberships where community_id in ('${ids.commA}', '${ids.commB}');
  insert into public.memberships (user_id, community_id, role, status) values
    ('${ids.alice}', '${ids.commA}', 'member', 'active'),
    ('${ids.bob}', '${ids.commA}', 'member', 'active'),
    ('${ids.carol}', '${ids.commB}', 'member', 'active');
  insert into public.missions (user_id, community_id, description, pillar_code, target_date, target_dates, created_by)
    values ('${ids.alice}', '${ids.commA}', 'Call her at lunch Tuesday', 'B', ${NEXT_MON} + 1, array[${NEXT_MON} + 1], 'user');
  insert into public.daily_checkins (user_id, date, pillar_code, value) values ('${ids.alice}', current_date, 'B', 1);
  insert into public.daily_reflections (user_id, date, wins) values ('${ids.alice}', current_date, 'Showed up');
  insert into public.partner_profiles (user_id, partner_name) values ('${ids.alice}', 'Sam');
  insert into public.quarterly_goals (user_id, quarter_start, focus_area, desired_end_state, status, source) values
    ('${ids.alice}', date_trunc('quarter', current_date)::date, 'V', 'Deadlift 315', 'active', 'user'),
    ('${ids.alice}', date_trunc('quarter', current_date)::date, 'A', 'Close three clients', 'active', 'user');
  insert into public.courses (id, title, slug, is_published, uses_sections) values
    ('${ids.open}', 'zz probe open', 'zz-probe-open-${ids.open.slice(0, 8)}', true, true),
    ('${ids.draft}', 'zz probe draft', 'zz-probe-draft-${ids.draft.slice(0, 8)}', false, true),
    ('${ids.onlyB}', 'zz probe only B', 'zz-probe-onlyb-${ids.onlyB.slice(0, 8)}', true, true);
  insert into public.course_sections (id, course_id, title, sort_order) values
    ('${ids.openSection}', '${ids.open}', 'Intro', 0),
    ('${ids.draftSection}', '${ids.draft}', 'Intro', 0),
    ('${ids.onlyBSection}', '${ids.onlyB}', 'Intro', 0);
  insert into public.course_communities (course_id, community_id) values ('${ids.onlyB}', '${ids.commB}');
  insert into public.lessons (id, course_id, section_id, title, sort_order) values
    ('${ids.openLesson}', '${ids.open}', '${ids.openSection}', 'L1', 0),
    ('${ids.draftLesson}', '${ids.draft}', '${ids.draftSection}', 'L1', 0),
    ('${ids.onlyBLesson}', '${ids.onlyB}', '${ids.onlyBSection}', 'L1', 0);
  insert into storage.objects (bucket_id, name) values ('lesson-files', 'zz-probe/fixture.pdf');

  -- Self-check scratch tables: one deliberately wrong policy, one right.
  create table public.zz_probe_leaky (owner uuid not null, secret text);
  create table public.zz_probe_tight (owner uuid not null, secret text);
  alter table public.zz_probe_leaky enable row level security;
  alter table public.zz_probe_tight enable row level security;
  create policy "wrong on purpose" on public.zz_probe_leaky for select to authenticated using (true);
  create policy "owner only" on public.zz_probe_tight for select to authenticated using (owner = auth.uid());
  grant select on public.zz_probe_leaky, public.zz_probe_tight to authenticated;
  insert into public.zz_probe_leaky values ('${ids.alice}', 'alice only');
  insert into public.zz_probe_tight values ('${ids.alice}', 'alice only');`;
}

function asUser(uid: string): string {
  return `perform set_config('request.jwt.claims', json_build_object('sub', '${uid}', 'role', 'authenticated')::text, true);
    set local role authenticated;`;
}

function probeSql(p: Probe, ids: Ids): string {
  const uid = ids[p.as];
  if (p.kind === "read") {
    return `
  -- ${p.id}: ${p.what}
  execute ${q(bind(p.control, ids))} into c;
  begin
    ${asUser(uid)}
    execute ${q(bind(p.sql, ids))} into n;
    reset role;
    res := res || jsonb_build_array(jsonb_build_object('id', '${p.id}', 'outcome', 'count', 'n', n, 'control', c));
  exception when others then
    reset role;
    get stacked diagnostics m = message_text, d = pg_exception_detail;
    res := res || jsonb_build_array(jsonb_build_object('id', '${p.id}', 'outcome', 'error', 'err', m, 'detail', d, 'control', c));
  end;`;
  }
  return `
  -- ${p.id}: ${p.what}
  begin
    ${asUser(uid)}
    execute ${q(bind(p.sql, ids))};
    get diagnostics n = row_count;
    reset role;
    res := res || jsonb_build_array(jsonb_build_object('id', '${p.id}', 'outcome', 'ok', 'rows', n));
  exception when others then
    reset role;
    get stacked diagnostics m = message_text, d = pg_exception_detail;
    res := res || jsonb_build_array(jsonb_build_object('id', '${p.id}', 'outcome', 'error', 'err', m, 'detail', d));
  end;`;
}

export function buildSql(probes: Probe[], ids: Ids, pendingSql?: string): string {
  return `begin;
${pendingSql ? `-- pending migration, applied inside the rolled-back transaction\n${pendingSql}\n` : ""}
do $probe$
declare
  res jsonb := '[]'::jsonb;
  n bigint;
  c bigint;
  m text;
  d text;
begin
${fixturesSql(ids)}
${probes.map((p) => probeSql(p, ids)).join("\n")}

  -- Report by raising: the error aborts the transaction, so nothing above
  -- survives, whatever happened.
  raise exception 'PROBE_RESULTS:%', replace(encode(convert_to(res::text, 'utf8'), 'base64'), E'\\n', '');
end
$probe$;
rollback;
`;
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

export type Verdict = { probe: Probe; pass: boolean; observed: string };

export function judge(p: Probe, o: Observation | undefined): Verdict {
  if (!o) return { probe: p, pass: false, observed: "no result (the run stopped before this probe)" };
  if (p.kind === "read") {
    if (o.outcome === "error") return { probe: p, pass: false, observed: `error: ${o.err}` };
    const n = o.n ?? 0;
    const control = o.control ?? 0;
    if (p.expect === "zero") {
      // A zero only counts beside a control that found rows.
      if (control === 0) return { probe: p, pass: false, observed: `0 of 0: the control found no rows, so this zero proves nothing` };
      return { probe: p, pass: n === 0, observed: `${n} of ${control}` };
    }
    return { probe: p, pass: n > 0, observed: `${n} of ${control}` };
  }
  if (p.expect === "allow") {
    if (o.outcome === "error") return { probe: p, pass: false, observed: `refused: ${o.err}` };
    return { probe: p, pass: (o.rows ?? 0) > 0, observed: `${o.rows} row(s) written` };
  }
  // refuse: an error, or an UPDATE/DELETE that RLS filtered to zero rows
  if (o.outcome === "ok") {
    return { probe: p, pass: (o.rows ?? 0) === 0, observed: `${o.rows} row(s) written` };
  }
  const text = `${o.err ?? ""} ${o.detail ?? ""}`;
  if (p.detail && !p.detail.test(text)) {
    return { probe: p, pass: false, observed: `refused, but not by the expected rule: ${o.err}` };
  }
  return { probe: p, pass: true, observed: `refused: ${o.err}` };
}

export function parseResults(message: string): Observation[] | null {
  const m = message.match(/PROBE_RESULTS:([A-Za-z0-9+/=]+)/);
  if (!m) return null;
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) as Observation[];
}

/** True when a migration would end the probe transaction itself. Ignores
 *  dollar-quoted bodies and comments, so a function's closing `end;` isn't
 *  mistaken for a commit (docs/failure-modes.md FM-12). */
export function commitsOwnTransaction(sql: string): boolean {
  const outside = sql
    .replace(/(\$[A-Za-z_]*\$)[\s\S]*?\1/g, "")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return /^\s*(commit|end)\s*;/im.test(outside);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const pi = args.indexOf("--pending");
  const pendingPath = pi >= 0 ? args[pi + 1] : undefined;

  const ref = assertLinkedDev();
  const pendingSql = pendingPath ? readFileSync(pendingPath, "utf8") : undefined;
  if (pendingSql && commitsOwnTransaction(pendingSql)) {
    console.error(`[rls:hazards] ${pendingPath} commits its own transaction; refusing, since that would make it permanent.`);
    process.exit(2);
  }

  const ids = newIds();
  const res = runLinkedSql(buildSql(PROBES, ids, pendingSql));
  const observations = res.ok ? null : parseResults(res.message);
  if (!observations) {
    console.error(`[rls:hazards] the probe run didn't report results. Database said:\n${res.ok ? "(no error, which means the transaction didn't abort; check the SQL)" : res.message}`);
    process.exit(1);
  }

  const verdicts = PROBES.map((p) => judge(p, observations.find((o) => o.id === p.id)));
  const passed = verdicts.filter((v) => v.pass);
  const failed = verdicts.filter((v) => !v.pass);
  const selfCheck = verdicts.find((v) => v.probe.id === "CTRL-leak");

  if (asJson) {
    console.log(JSON.stringify({ project: ref, pending: pendingPath ?? null, verdicts: verdicts.map((v) => ({ id: v.probe.id, pass: v.pass, observed: v.observed })) }, null, 2));
  } else {
    console.log(`[rls:hazards] project ${ref}${pendingPath ? `, with pending ${pendingPath}` : ""}. Everything below ran in one transaction and was rolled back.\n`);
    for (const v of verdicts) {
      console.log(`${v.pass ? "PASS" : "FAIL"}  ${v.probe.id.padEnd(10)} ${v.probe.what}\n      ${v.observed}`);
    }
    console.log(`\nProbes: ${passed.length} pass, ${failed.length} fail${failed.length ? ` (first red: ${failed[0].probe.id})` : ""}`);
    if (selfCheck && !selfCheck.pass) {
      console.log("SELF-CHECK FAILED: the planted wrong policy didn't leak, so the probes can't see leaks. Don't trust any result above.");
    }
  }
  if (failed.length > 0) process.exit(1);
}

if (isEntryPoint(import.meta.url)) {
  main();
}
