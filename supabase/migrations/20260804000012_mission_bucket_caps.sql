-- =============================================================================
-- Mission structure v2
--   1. Cap active quarterly_goals at 2 per user per quarter (was: unlimited).
--   2. Missions per week: 15 total, capped at 5 per goal bucket and 5 for the
--      unattached "other" bucket. Replaces the old 5-total cap (§4 revision).
--   3. Add is_exemplar flag so admins/leaders can promote real missions into
--      the shared example library.
-- =============================================================================

--
-- 1. Two active goals per user per quarter.
--
create or replace function public.enforce_active_goals_cap()
returns trigger
language plpgsql
as $$
declare
  n int;
begin
  if new.status <> 'active' then
    return new;
  end if;
  select count(*) into n
  from quarterly_goals
  where user_id = new.user_id
    and quarter_start = new.quarter_start
    and status = 'active'
    and id <> new.id;
  if n >= 2 then
    raise exception
      'Two active quarterly goals is the cap for user % in quarter %.',
      new.user_id, new.quarter_start;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_active_goals_cap_trg on quarterly_goals;
create trigger enforce_active_goals_cap_trg
  before insert or update of status, quarter_start on quarterly_goals
  for each row execute function public.enforce_active_goals_cap();

--
-- 2. Weekly mission caps: 15 total, 5 per bucket (each goal is a bucket, and
--    unattached missions share one "other" bucket).
--
create or replace function public.enforce_mission_weekly_cap()
returns trigger
language plpgsql
as $$
declare
  week_start date;
  week_end   date;
  total      int;
  in_bucket  int;
begin
  week_start := date_trunc('week', new.target_date)::date;
  week_end   := week_start + 6;

  select count(*) into total
  from missions
  where user_id = new.user_id
    and target_date between week_start and week_end
    and id <> new.id
    and status <> 'rolled_over';
  if total >= 15 then
    raise exception
      'Weekly mission cap reached (15) for user % week %', new.user_id, week_start;
  end if;

  select count(*) into in_bucket
  from missions
  where user_id = new.user_id
    and target_date between week_start and week_end
    and id <> new.id
    and status <> 'rolled_over'
    and quarterly_goal_id is not distinct from new.quarterly_goal_id;
  if in_bucket >= 5 then
    if new.quarterly_goal_id is null then
      raise exception
        'Weekly cap of 5 unattached ("other") missions reached for user % week %',
        new.user_id, week_start;
    else
      raise exception
        'Weekly cap of 5 missions per goal reached (goal %) for user % week %',
        new.quarterly_goal_id, new.user_id, week_start;
    end if;
  end if;
  return new;
end;
$$;

-- (Trigger definition unchanged from v1 — the function above replaces the body.)

--
-- 3. Exemplar flag for shared example library.
--
alter table missions
  add column if not exists is_exemplar boolean not null default false;

create index if not exists missions_exemplar_pillar_idx
  on missions (pillar_code, is_exemplar)
  where is_exemplar = true;
