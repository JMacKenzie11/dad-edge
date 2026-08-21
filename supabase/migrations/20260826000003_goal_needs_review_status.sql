-- =============================================================================
-- Quarter-end review status (Checkpoint C)
--
-- Add 'needs_review' to goal_status. Daily cron transitions active goals
-- whose quarter has ended into needs_review; the client renders a
-- dismissible prompt on /today and /goals asking the coachee to close it
-- out (Yes / Partially → completed; No → abandoned; both write an optional
-- reflection to review_reflection).
-- =============================================================================

alter type goal_status add value if not exists 'needs_review';
