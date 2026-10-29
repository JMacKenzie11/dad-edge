-- =============================================================================
-- Challenge days: tallied by the day, tickable until the week locks
-- (DECISIONS.md "Challenges: counted in days").
--
-- 20261027000002 let him tick any earlier day of a challenge mission, for
-- ever, and logged a week completed after its last day as late. Now:
--
--   - A day can be ticked or unticked until his community locks that week
--     (weeks.locked_at, the same lock that closes check-ins), and not after.
--   - Completing a week by ticks is never late: the lock is the deadline.
--
-- Only enforce_challenge_ticks() changes; the trigger, the column and
-- everything else from 20261027000002 stay as they are.
-- =============================================================================

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
    -- Once his community locks the week, its days stay as they are,
    -- the same as check-ins.
    if exists (
      select 1 from weeks w
      where w.community_id = new.community_id
        and w.start_date = date_trunc('week', new.target_date)::date
        and w.locked_at is not null
    ) then
      raise exception using
        message = 'That week is locked, so its days can''t change.',
        detail = 'challenge_tick_locked';
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
      -- Never late: the week lock is the deadline for ticking a day.
      new.completed_late := false;
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
