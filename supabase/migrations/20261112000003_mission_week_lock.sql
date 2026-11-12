-- =============================================================================
-- Locked weeks stay as they were (DECISIONS.md "Past mission weeks").
--
-- /missions now lets a man page back through every earlier week to look
-- at what he set and did. Until now the only thing stopping him from
-- changing a locked week was that the page never showed it: the
-- "missions: self write" policy lets him update or delete any of his own
-- missions, any week. This trigger closes that.
--
-- A week is locked once `week_lock_days` have passed since its Sunday,
-- the same arithmetic as getEditWindow (src/lib/scoring/week.ts): the
-- most generous lock among his active communities (3 with none), with
-- "today" in the mission's community's timezone. Computed from the
-- calendar rather than weeks.locked_at, so it holds whether or not the
-- nightly job has run and for weeks from before the job wrote rows.
--
-- Refused for a signed-in member: adding a mission to a locked week,
-- changing or deleting one in a locked week, and moving one into a
-- locked week.
--
-- Left alone:
--   - the service role and the database owner (the nightly missed-
--     mission job, ITC result handling, account deletion);
--   - writes made by another trigger or a foreign-key action
--     (pg_trigger_depth() > 1): a goal deleted sets its missions' goal
--     to null, and a challenge edit resyncs its missions. Neither is the
--     man rewriting a week.
-- =============================================================================

create or replace function public.mission_week_locked(
  p_user_id uuid,
  p_community_id uuid,
  p_target_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
            (select c.timezone from public.communities c where c.id = p_community_id),
            'UTC'))::date
         >= date_trunc('week', p_target_date)::date + 6 + coalesce(
            (select max(c.week_lock_days)
               from public.memberships m
               join public.communities c on c.id = m.community_id
              where m.user_id = p_user_id and m.status = 'active'),
            3)
$$;

revoke all on function public.mission_week_locked(uuid, uuid, date) from public, anon;
grant execute on function public.mission_week_locked(uuid, uuid, date) to authenticated, service_role;

create or replace function public.enforce_mission_week_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  locked_week date;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;

  if tg_op in ('UPDATE', 'DELETE')
     and public.mission_week_locked(old.user_id, old.community_id, old.target_date) then
    locked_week := date_trunc('week', old.target_date)::date;
  elsif tg_op in ('INSERT', 'UPDATE')
     and public.mission_week_locked(new.user_id, new.community_id, new.target_date) then
    locked_week := date_trunc('week', new.target_date)::date;
  end if;

  if locked_week is not null then
    raise exception using
      message = 'That week is locked, so its missions can''t change.',
      detail = 'mission_week_locked:' || to_char(locked_week, 'YYYY-MM-DD'),
      errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists mission_week_lock_trg on public.missions;
create trigger mission_week_lock_trg
  before insert or update or delete on public.missions
  for each row execute function public.enforce_mission_week_lock();
