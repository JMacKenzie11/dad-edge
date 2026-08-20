-- Persist the rubric's per-entry "reason" string alongside depth_score.
--
-- Depth scoring already runs on every save (scoreWorryDepth,
-- scoreCommitmentDepth, scoreAssumptionDepth in src/lib/itc/rubric.ts)
-- and returns rich structured feedback: three binary criteria plus a
-- short human-readable reason explaining what would raise a failing
-- criterion. Until now only the aggregate depth_score (0-3) has been
-- persisted; the reason string was recorded in the TurnEventLog for
-- analytics but thrown away for user-facing display.
--
-- Storing the reason lets the "Needs more depth" UI badge tell the
-- coachee WHAT specifically to sharpen instead of leaving him to
-- guess. Same LLM call, same rubric — this migration just captures
-- the output that was already being computed.
--
-- Nullable — pre-existing rows have no reason. Rows saved after this
-- ships will populate it. UI treats null as "no specific feedback
-- yet, sharpen the text and re-save to get the coach's read".

alter table itc_worries
  add column if not exists rubric_reason text;

alter table itc_commitments
  add column if not exists rubric_reason text;

alter table itc_assumptions
  add column if not exists rubric_reason text;
