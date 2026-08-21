-- =============================================================================
-- Goals rebuild: schema + RLS (Checkpoint B)
--
-- 1. Rename quarterly_goals.description → desired_end_state. Both user-authored
--    and ITC-mirrored goals use this column: the coachee's finish line for
--    user goals, the "I'm committed to getting better at ..." text for ITC.
-- 2. Add current_state / how_youll_know / review_reflection as nullable text.
--    Populated only for source='user' goals (application-layer enforcement,
--    since ITC goals don't have a start line / signal-of-done — the whole
--    ITC map machinery IS the accountability layer).
-- 3. RLS: drop the "community-mate read" policy that let any active community
--    member read another member's goals. Replace with "leader read" so a man's
--    community leader (via is_leader_of_target) can see his goals for coaching
--    context, but peer members cannot. Goal text is more personal than a
--    mission description and should not appear on community-facing surfaces.
-- =============================================================================

--
-- 1. Rename description → desired_end_state.
--
--    No legacy user cohort to backfill (per product decision, 2026-08-26).
--    Rename is safe.
--
alter table quarterly_goals
  rename column description to desired_end_state;

--
-- 2. Add new nullable text columns for user-authored goals.
--
alter table quarterly_goals
  add column if not exists current_state text;
alter table quarterly_goals
  add column if not exists how_youll_know text;
alter table quarterly_goals
  add column if not exists review_reflection text;

--
-- 3. RLS. Drop community-mate read; add leader read.
--
drop policy if exists "goals: community-mate read" on quarterly_goals;

create policy "goals: leader read"
  on quarterly_goals for select
  using (public.is_leader_of_target(user_id));

-- Platform admins already read all quarterly_goals via the service role
-- (createSupabaseServiceClient) and the existing is_platform_admin()
-- helper pattern used elsewhere. No dedicated admin policy needed here.
