-- Extend the rubric-gated excavation loop to Column 2 (behaviors).
-- Same shape as worries/commitments/assumptions: server pipeline
-- scores every save (deterministic Haiku rubric, not coach prose),
-- stores 0-3 on the row, increments attempts. Continue-to-Worries
-- advances when every selected behavior passes at 3/3 or 2/3 with
-- attempts >= 2. See DECISIONS.md "ITC Form-First Layout Amendment
-- — Checkpoint C" for the pattern.
--
-- Why: prior to this migration the behaviors gate only checked count
-- (3-5 selected). The coach could flag "sharpen behavior #2" and the
-- Continue button would still be enabled — coachee could bypass real
-- pushback. Bringing behaviors under the same rubric gate makes all
-- four map columns uniformly server-scored.
--
-- Backfill: pre-existing selected behaviors are set to depth_score=3
-- and attempts=1 so mid-flight maps aren't retroactively blocked from
-- advancing. Any subsequent save runs the fresh rubric.

alter table itc_behaviors
  add column if not exists depth_score int
    check (depth_score is null or (depth_score >= 0 and depth_score <= 3)),
  add column if not exists attempts int not null default 0,
  add column if not exists rubric_reason text;

update itc_behaviors
  set depth_score = 3, attempts = 1
  where selected = true
    and depth_score is null;
