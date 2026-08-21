-- =============================================================================
-- Drop how_youll_know from quarterly_goals.
--
-- Added in 20260826000002_goals_rebuild_schema_and_rls but pulled from the UI
-- after review: if the desired_end_state is written specifically enough, the
-- signal is baked into it ("Deadlift 350 by end of quarter" IS the signal).
-- A separate "how you'll know" field only enables fuzzier finish lines,
-- which is the opposite of what we want. Coach should push to sharpen the
-- finish line, not add a second field to compensate for a vague one.
-- =============================================================================

alter table quarterly_goals
  drop column if exists how_youll_know;
