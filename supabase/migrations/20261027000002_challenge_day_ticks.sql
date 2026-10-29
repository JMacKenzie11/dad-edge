-- =============================================================================
-- Challenge missions: tick each day once it's done (DECISIONS.md "Challenges").
--
-- Before this, a challenge mission showed its days lit from the moment he
-- joined and closed with one COMPLETE a week, so a week he hadn't started
-- looked finished and nobody could tell which days he did. Now:
--
--   missions.done_dates   the days he has ticked, a subset of target_dates
--
-- He ticks today or an earlier day of the mission, never a day still to
-- come, and only while he's in the challenge. The mission completes itself
-- when the ticks reach that week's target (the challenge's target, cut to
-- the days the mission has), and goes back to planned if he unticks below
-- it. COMPLETE on a challenge mission without enough ticks is refused.
--
-- Leaving or deleting the challenge no longer throws away a mission he has
-- already ticked days on.
-- =============================================================================

alter table public.missions
  add column if not exists done_dates date[] not null default '{}';

-- Challenge missions already completed the old way count every day.
update public.missions
   set done_dates = target_dates
 where challenge_id is not null
   and status = 'completed'
   and cardinality(done_dates) = 0;

create or replace function public.enforce_challenge_ticks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.challenges;
  today date;
  week_target int;
  ticked int;
  old_done date[] := case when tg_op = 'UPDATE' then old.done_dates else '{}'::date[] end;
begin
  new.done_dates := coalesce(new.done_dates, '{}');

  if new.challenge_id is null then
    -- Only challenge missions take ticks. A kept mission from a challenge
    -- he left keeps the ticks it had.
    if new.done_dates is distinct from old_done then
      raise exception using
        message = 'Only challenge missions are ticked day by day.',
        detail = 'challenge_tick_invalid';
    end if;
    return new;
  end if;

  -- Sorted, no repeats, so the same set always compares equal.
  new.done_dates := array(select distinct d from unnest(new.done_dates) d order by d);

  if tg_op = 'INSERT' and cardinality(new.done_dates) > 0 then
    raise exception using
      message = 'A new challenge mission starts with no days done.',
      detail = 'challenge_tick_invalid';
  end if;

  select * into ch from challenges where id = new.challenge_id;
  select (now() at time zone coalesce(u.timezone, 'America/Chicago'))::date into today
  from users u where u.id = new.user_id;
  week_target := greatest(1, least(ch.target, cardinality(new.target_dates)));
  ticked := cardinality(new.done_dates);

  if new.done_dates is distinct from old_done then
    if not new.done_dates <@ new.target_dates then
      raise exception using
        message = 'That day isn''t one of this mission''s days.',
        detail = 'challenge_tick_invalid';
    end if;
    if not exists (
      select 1 from challenge_participants p
      where p.challenge_id = ch.id and p.user_id = new.user_id and p.status = 'in'
    ) then
      raise exception using
        message = 'Join the challenge first.',
        detail = 'challenge_not_joined';
    end if;
    if exists (
      select 1 from unnest(new.done_dates) d
      where d > today and not d = any (old_done)
    ) then
      raise exception using
        message = 'Tick a day once it''s done, not before.',
        detail = 'challenge_tick_future';
    end if;
  end if;

  if tg_op = 'INSERT' or new.status not in ('planned', 'completed', 'missed') then
    return new;
  end if;

  if ticked >= week_target then
    if old.status <> 'completed' then
      new.status := 'completed';
      new.completed_at := now();
      new.completed_late := today > new.target_date;
    end if;
  elsif new.status = 'completed' then
    if old.status <> 'completed' then
      raise exception using
        message = format('Tick %s of the days first.', week_target),
        detail = 'challenge_needs_days';
    end if;
    -- Unticked below the target: back in play.
    new.status := case when new.target_date < today then 'missed' else 'planned' end::mission_status;
    new.completed_at := null;
    new.completed_late := false;
  end if;
  return new;
end;
$$;

-- Runs before enforce_mission_weekly_cap_trg (triggers fire by name).
drop trigger if exists challenge_ticks_trg on public.missions;
create trigger challenge_ticks_trg
  before insert or update of done_dates, status
  on public.missions
  for each row execute function public.enforce_challenge_ticks();

-- Leaving: a mission with days already ticked stays as it is.
create or replace function public.leave_challenge(p_challenge uuid, p_keep_missions boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date;
begin
  update challenge_participants
     set status = 'left', left_at = now(), updated_at = now()
   where challenge_id = p_challenge and user_id = uid and status = 'in';
  if not found then
    return;
  end if;

  select (now() at time zone coalesce(u.timezone, 'America/Chicago'))::date into today
  from users u where u.id = uid;

  if p_keep_missions then
    update missions set challenge_id = null
     where user_id = uid and challenge_id = p_challenge
       and status = 'planned' and target_date >= today
       and cardinality(done_dates) = 0;
  else
    delete from missions
     where user_id = uid and challenge_id = p_challenge
       and status = 'planned' and target_date >= today
       and cardinality(done_dates) = 0;
  end if;
end;
$$;

-- Deleting a challenge: upcoming missions with nothing ticked go; the rest
-- stay as ordinary missions (challenge_id goes null).
create or replace function public.clear_challenge_missions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from missions
   where challenge_id = old.id
     and status = 'planned'
     and target_date >= current_date
     and cardinality(done_dates) = 0;
  return old;
end;
$$;
