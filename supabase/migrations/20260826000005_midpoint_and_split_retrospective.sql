-- =============================================================================
-- Midpoint check-in + split retrospective fields
--
-- 1. Midpoint check-in. A source='user' goal fires a lightweight midpoint
--    prompt halfway between goal creation and quarter end, unless the goal
--    was created too late in the quarter for a midpoint to be meaningful
--    (<3 weeks remaining). Computed at create time, stored as a date so
--    the daily cron / render-time check is a trivial date comparison.
--
--    midpoint_check_at   nullable. NULL means "no midpoint scheduled"
--                        (ITC goals, or user goals created in the last
--                        3 weeks of a quarter). Non-null date means the
--                        prompt shows once today >= this date and
--                        midpoint_check_answer is still null.
--    midpoint_check_answer  freeform text. Non-null = coachee answered
--                           the midpoint, prompt stops showing.
--
-- 2. Split retrospective. review_reflection was a single blob; splitting
--    into "what actually happened" (concrete story) + "what did you learn"
--    (extracted lesson) treats the quarter-end as a real retrospective
--    rather than a verdict-with-a-note. Yes/Partially/No verdict still
--    stores to status. Keeping review_reflection column undropped for
--    now — the split action writes to the two new columns and leaves
--    review_reflection null; a follow-up migration can drop the old
--    column once we're sure the split fields carry the intent.
-- =============================================================================

alter table quarterly_goals
  add column if not exists midpoint_check_at date;
alter table quarterly_goals
  add column if not exists midpoint_check_answer text;

alter table quarterly_goals
  add column if not exists retrospective_what_happened text;
alter table quarterly_goals
  add column if not exists retrospective_what_learned text;

-- Partial index on the midpoint prompt trigger. Almost all goals never
-- flip to "midpoint due but unanswered" simultaneously (spread across
-- users + across time), so a partial index on the two "prompt visible"
-- columns keeps the /today + /goals lookups cheap.
create index if not exists quarterly_goals_midpoint_pending_idx
  on quarterly_goals (user_id, midpoint_check_at)
  where midpoint_check_answer is null and midpoint_check_at is not null;
