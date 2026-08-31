-- Multi-day mission support.
--
-- Missions can now target multiple days in the week (e.g. Mon/Wed/Fri
-- for a workout habit). One complete tick still closes the mission —
-- multi-day is about visible scheduling, not multi-completion.
--
-- Storage:
--   target_dates  — canonical set of days the mission is scheduled for.
--                   Populated on every save, always ≥ 1 date.
--   target_date   — kept for backwards compat with jobs and views that
--                   already query it. Set to MAX(target_dates) so the
--                   "deadline" semantics work — mission is only "missed"
--                   after the LAST scheduled day passes, and the weekly
--                   digest scoping (target_date in week range) still
--                   pulls multi-day missions correctly.
--
-- Jobs that need per-day awareness (mission-nudges: fire once per day)
-- will be updated separately to read target_dates.

alter table missions
  add column if not exists target_dates date[];

-- Backfill: every existing mission gets a single-element array from
-- its current target_date. Idempotent — safe to re-run.
update missions
  set target_dates = array[target_date]
  where target_dates is null;

-- From here on, target_dates is authoritative. Ensure it stays that
-- way at the DB layer.
alter table missions
  alter column target_dates set not null;

alter table missions
  add constraint missions_target_dates_nonempty
  check (array_length(target_dates, 1) >= 1);

-- Speed up "today's missions" lookups per user across the array.
-- GIN index on the array — cheap and matches `= ANY(target_dates)` and
-- `target_dates @> array[?]` queries used by mission-nudges.
create index if not exists missions_target_dates_gin
  on missions using gin (target_dates);
