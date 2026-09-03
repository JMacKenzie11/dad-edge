-- Version stamp on persisted coach text.
--
-- sharpen_text / suggested_fix / rubric_reason are computed once and
-- written onto the row, then rewritten only when that row is saved or
-- audited. So when a check changes, its advice is reworded, or a
-- finding stops firing, every box already written keeps saying the old
-- thing on any row the coachee has moved past.
--
-- That happened three times on 2026-09-03 (the coverage note on
-- commitment rows, the column review pointing at rows with no box, the
-- testability flag), each needing a hand-written cleanup that had to
-- know the exact wording it was hunting.
--
-- With the stamp, coach text written by an older version of the
-- criteria is treated as absent on read and regenerated on the next
-- score. Nothing to sweep, no wording to match, cannot miss a row.
--
-- NULL means "written before the stamp existed", which reads as stale:
-- it predates the mechanism and nothing can vouch for it. Those rows
-- regenerate once and then carry a version like everything else.
--
-- See src/lib/itc/coach-text-version.ts for when to bump.

alter table itc_behaviors   add column if not exists coach_text_version smallint;
alter table itc_worries     add column if not exists coach_text_version smallint;
alter table itc_commitments add column if not exists coach_text_version smallint;
alter table itc_assumptions add column if not exists coach_text_version smallint;

-- The staleness triggers must ignore this column for the same reason
-- they ignore the other coach-text columns (20260901000001): a
-- regeneration is not the coachee editing his map, and must not mark
-- his audit stale or nudge downstream columns.
comment on column itc_behaviors.coach_text_version is
  'Criteria version that produced this row''s coach text. Stale/NULL means regenerate on next score. See src/lib/itc/coach-text-version.ts';
comment on column itc_worries.coach_text_version is
  'Criteria version that produced this row''s coach text. Stale/NULL means regenerate on next score.';
comment on column itc_commitments.coach_text_version is
  'Criteria version that produced this row''s coach text. Stale/NULL means regenerate on next score.';
comment on column itc_assumptions.coach_text_version is
  'Criteria version that produced this row''s coach text. Stale/NULL means regenerate on next score.';
