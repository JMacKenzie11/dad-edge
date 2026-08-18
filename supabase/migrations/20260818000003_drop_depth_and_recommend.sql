-- Form-First cleanup: drop LLM-authority columns that no code writes.
--
-- depth_score on itc_worries and itc_assumptions was written by the
-- old coach-scores-entries flow. Under Form-First the coach never
-- writes state, so no path populates it. The commitments advance gate
-- was quietly filtering by `depth_score IS NOT NULL` (i.e. filtering
-- out every row), leaving the gate trivially true. Remove the columns
-- so the gate has to be written honestly against the actual worries.
--
-- coach_recommended on itc_assumptions was set by setAssumptionRecommended,
-- a function that was never called from any action. The column drove
-- assumption-card styling with a highlight the coachee could never
-- earn. Remove.
--
-- itc_worry_attempts logged coach-attempt rejects under the old
-- multi-attempt-per-worry flow. Under Form-First the coachee writes
-- the worry directly; there is no attempt/reject loop. The table is
-- unreferenced by any live code.

alter table itc_worries
  drop column if exists depth_score;

alter table itc_assumptions
  drop column if exists depth_score,
  drop column if exists coach_recommended;

drop table if exists itc_worry_attempts cascade;
