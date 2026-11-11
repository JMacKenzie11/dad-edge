-- =============================================================================
-- Onboarding videos (DECISIONS.md "Onboarding videos").
--
-- The wizard gains two steps: the welcome video before identity (step 0)
-- and the app tour video after the first check-in (step 7). Steps are
-- now 0..7 and 8 means done (src/lib/onboarding/steps.ts).
--
--   old  0 identity (not started)  -> 0 welcome video (new men see it)
--   old  1..5 mid-wizard           -> 2..6 same screen as before
--   old  6 or 7 done               -> 8 done (no videos for existing men)
--
-- Run this BEFORE the code that reads the new numbers is deployed: old
-- code treats 8 as done, but new code would send everyone at 6 back to
-- the first check-in.
-- =============================================================================

update users set onboarding_step = 8 where onboarding_step >= 6;
update users set onboarding_step = onboarding_step + 1 where onboarding_step between 1 and 5;

comment on column users.onboarding_step is
  'Index of the first unfinished onboarding step (src/lib/onboarding/steps.ts). 0 welcome video, 1 identity, 2 profile, 3 why, 4 partner, 5 kids, 6 first check-in, 7 app tour, 8 done.';
