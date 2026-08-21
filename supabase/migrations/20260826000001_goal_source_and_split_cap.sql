-- =============================================================================
-- Goal source and split cap
--
-- Problem: enforce_active_goals_cap_trg (migration 20260804000012) hard-caps
-- active quarterly_goals at 2 per user per quarter. syncItcGoalToTracker
-- creates a quarterly_goals row when a coachee saves an ITC map goal. A
-- coachee with 2 manually-created goals who then builds an ITC map has his
-- map's goal silently fail to sync under the tracker-link "never block, log
-- and retry" failure policy. That policy is correct for transient failures
-- and wrong for a structural cap that never resolves on retry.
--
-- Fix: distinguish user-authored goals from ITC-mirrored goals via a `source`
-- column. Cap user-authored goals at 2 per quarter (unchanged from the
-- coachee's perspective), reserve a third slot for a source='itc' goal if he
-- has one. Total active goals across both sources capped at 3 per quarter as
-- a backstop.
-- =============================================================================

--
-- 1. source column with default 'user'.
--    Existing rows can be reliably identified as ITC-mirrored via
--    itc_maps.quarterly_goal_id (added in 20260820000001_itc_tracker_link).
--    Any quarterly_goal whose id appears there was created by
--    syncItcGoalToTracker and must be flagged source='itc' so the split-cap
--    trigger doesn't count it against the user's 2 manual slots.
--
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'goal_source'
  ) then
    create type goal_source as enum ('user', 'itc');
  end if;
end $$;

alter table quarterly_goals
  add column if not exists source goal_source not null default 'user';

update quarterly_goals qg
   set source = 'itc'
  from itc_maps m
 where m.quarterly_goal_id = qg.id
   and qg.source <> 'itc';

--
-- 2. Trigger rewrite. Cap logic:
--      - Reject any insert/update to 'active' if total active >= 3
--        (backstop; syncItcGoalToTracker's edit-in-place path means this
--        should never fire in normal use).
--      - Reject a source='user' active goal if 2+ source='user' active
--        goals already exist. This preserves the coachee-facing "2 slots
--        for your own goals" behavior.
--      - source='itc' inserts pass as long as total < 3.
--
create or replace function public.enforce_active_goals_cap()
returns trigger
language plpgsql
as $$
declare
  n_total int;
  n_user  int;
begin
  if new.status <> 'active' then
    return new;
  end if;

  select count(*) into n_total
  from quarterly_goals
  where user_id = new.user_id
    and quarter_start = new.quarter_start
    and status = 'active'
    and id <> new.id;
  if n_total >= 3 then
    raise exception
      'Active quarterly goals cap (3 total) reached for user % in quarter %.',
      new.user_id, new.quarter_start;
  end if;

  if new.source = 'user' then
    select count(*) into n_user
    from quarterly_goals
    where user_id = new.user_id
      and quarter_start = new.quarter_start
      and status = 'active'
      and source = 'user'
      and id <> new.id;
    if n_user >= 2 then
      raise exception
        'Two user-authored quarterly goals is the cap for user % in quarter %. The third slot is reserved for an ITC map goal.',
        new.user_id, new.quarter_start;
    end if;
  end if;

  return new;
end;
$$;

-- Trigger definition unchanged; the function above replaces the body. Also
-- ensure the trigger fires when source changes (a source='itc' → 'user'
-- rewrite in the same active state would otherwise bypass the user cap).
drop trigger if exists enforce_active_goals_cap_trg on quarterly_goals;
create trigger enforce_active_goals_cap_trg
  before insert or update of status, quarter_start, source on quarterly_goals
  for each row execute function public.enforce_active_goals_cap();
