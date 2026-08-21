-- =============================================================================
-- Coach messages: metadata JSONB
--
-- The context pipeline (src/lib/coach/context/) records which providers
-- contributed to a given assistant turn's context and their combined
-- token estimate. Written to coach_messages.metadata on the assistant
-- turn insert, reviewable from /admin/coach-flags for the "what did the
-- coach actually know when it said that" audit trail — same purpose
-- itc_turn_events serves on the ITC side.
--
-- Shape (on assistant turns):
--   {
--     "context": {
--       "providers": ["identity", "goals", "missions", "streaks",
--                     "reflections", "family", "survey"],
--       "tokenEstimate": 1420
--     },
--     "safety": {
--       "severity": "none",
--       "categories": []
--     }
--   }
--
-- User turns leave it null. Nothing else in the app currently writes
-- here, so we don't need to backfill.
-- =============================================================================

alter table coach_messages
  add column if not exists metadata jsonb;
