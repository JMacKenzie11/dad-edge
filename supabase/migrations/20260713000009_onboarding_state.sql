--
-- Track onboarding progress per user so a man can resume mid-flow after signing
-- out. Also records the "Why you're here" answer (§12.1 step 2), which the coach
-- reads on first conversation (Phase 2).
--
alter table users
  add column onboarding_step smallint not null default 0,   -- 0 = not started, 7 = complete
  add column why_yes text;

--
-- Backfill: any user with a completed check-in row is treated as onboarded.
--
update users u
   set onboarding_step = 7
 where exists (select 1 from daily_checkins c where c.user_id = u.id);
