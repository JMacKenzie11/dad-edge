-- =============================================================================
-- Missions and Goals Restructure (Part 2, Checkpoint D)
--
-- New weekly mission rules, one trigger for every creation path:
--   * Domain missions (no goal): up to two per week in each of B, R, A, V, E.
--   * Goal missions: up to five per week in total across all goals. Pillar
--     is inherited from the goal; the goal must be his and still open
--     (active, or in its quarter-end review week).
--   * Movement, Action and Network take no new missions. Check-ins are
--     untouched.
-- Quarterly goals lose their hard cap. New goals (and any pillar change)
-- must be on B, R, A, V or E; same for improvement maps, whose goal mirrors
-- the map's pillar.
--
-- Nothing existing changes (rule 5):
--   * The caps are checked only when a mission is added, moved to another
--     week, moved between a goal and a domain, or brought back from
--     rolled_over/abandoned. Over-cap weeks that already exist stay as they
--     are, and editing a mission inside its own week is never blocked.
--   * No-goal missions created before this migration don't count against
--     the domain slots. The old planner stamped them all Bond without
--     asking (see DECISIONS.md, Checkpoint C); the missions page lists
--     them separately. The cutover moment is stored in app_milestones so
--     the trigger and the page read the same value.
--   * Retired-pillar rules only bite on insert or when the pillar changes,
--     so existing goals on Movement (one, in review) are left alone.
--
-- Errors carry a machine-readable DETAIL that the app turns into plain
-- copy relative to his week ("You already have two Bond missions next
-- week."); the MESSAGE is readable on its own as a fallback.
--   mission_cap:domain:<pillar>:<week_start>
--   mission_cap:goal::<week_start>
--   mission_pillar_retired:<pillar>
--   mission_goal_closed
--   goal_pillar_retired:<pillar>
-- =============================================================================

create table if not exists public.app_milestones (
  key text primary key,
  at timestamptz not null default now()
);
alter table public.app_milestones enable row level security;
drop policy if exists "app_milestones: read" on public.app_milestones;
create policy "app_milestones: read" on public.app_milestones for select using (true);

insert into public.app_milestones (key, at)
values ('mission_structure_v2', now())
on conflict (key) do nothing;

create or replace function public.mission_structure_cutover()
returns timestamptz
language sql stable
security definer
set search_path = public
as $$
  select at from public.app_milestones where key = 'mission_structure_v2';
$$;

-- Missions ---------------------------------------------------------------------

create or replace function public.enforce_mission_weekly_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wk date;
  old_wk date;
  goal_owner uuid;
  goal_status text;
  goal_pillar text;
  pillar_label text;
  n int;
  cutover timestamptz := coalesce(public.mission_structure_cutover(), now());
begin
  -- Rolled-over and abandoned missions never count, same as before.
  if new.status in ('rolled_over', 'abandoned') then
    return new;
  end if;

  wk := date_trunc('week', new.target_date)::date;

  if tg_op = 'UPDATE' then
    old_wk := date_trunc('week', old.target_date)::date;
    -- Same week, same bucket, already counted: an edit, not a placement.
    if wk = old_wk
       and new.quarterly_goal_id is not distinct from old.quarterly_goal_id
       and new.pillar_code = old.pillar_code
       and old.status not in ('rolled_over', 'abandoned') then
      return new;
    end if;
  end if;

  if new.quarterly_goal_id is not null then
    -- Goal mission. Check the goal on insert or when the link changes.
    if tg_op = 'INSERT' or new.quarterly_goal_id is distinct from old.quarterly_goal_id then
      select g.user_id, g.status::text, g.focus_area::text
        into goal_owner, goal_status, goal_pillar
      from quarterly_goals g
      where g.id = new.quarterly_goal_id;
      if goal_owner is null or goal_owner <> new.user_id
         or goal_status not in ('active', 'needs_review') then
        raise exception using
          message = 'That goal is closed, so it can''t take new missions.',
          detail = 'mission_goal_closed';
      end if;
      new.pillar_code := goal_pillar::pillar_code;
    end if;

    select count(*) into n
    from missions
    where user_id = new.user_id
      and id <> new.id
      and quarterly_goal_id is not null
      and status not in ('rolled_over', 'abandoned')
      and date_trunc('week', target_date)::date = wk;
    if n >= 5 then
      raise exception using
        message = format('You already have five goal missions the week of %s.', wk),
        detail = format('mission_cap:goal::%s', wk);
    end if;
    return new;
  end if;

  -- Domain mission.
  if new.pillar_code::text not in ('B', 'R', 'A', 'V', 'E') then
    raise exception using
      message = 'Movement, Action and Network don''t take missions. Pick Bond, Raise, Amplify, Vitality or Enjoyment.',
      detail = format('mission_pillar_retired:%s', new.pillar_code);
  end if;

  select count(*) into n
  from missions
  where user_id = new.user_id
    and id <> new.id
    and quarterly_goal_id is null
    and pillar_code = new.pillar_code
    and status not in ('rolled_over', 'abandoned')
    and created_at >= cutover
    and date_trunc('week', target_date)::date = wk;
  if n >= 2 then
    pillar_label := case new.pillar_code::text
      when 'B' then 'Bond' when 'R' then 'Raise' when 'A' then 'Amplify'
      when 'V' then 'Vitality' when 'E' then 'Enjoyment' else new.pillar_code::text end;
    raise exception using
      message = format('You already have two %s missions the week of %s.', pillar_label, wk),
      detail = format('mission_cap:domain:%s:%s', new.pillar_code, wk);
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_mission_weekly_cap_trg on public.missions;
create trigger enforce_mission_weekly_cap_trg
  before insert or update of target_date, target_dates, quarterly_goal_id, pillar_code, status
  on public.missions
  for each row execute function public.enforce_mission_weekly_cap();

-- Speeds up the per-week counts above.
create index if not exists missions_user_target_date_idx on public.missions (user_id, target_date);

-- Quarterly goals: no cap, pillar limited to the five domains -----------------

drop trigger if exists enforce_active_goals_cap_trg on public.quarterly_goals;
drop function if exists public.enforce_active_goals_cap();

create or replace function public.enforce_goal_pillar()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' or new.focus_area is distinct from old.focus_area)
     and new.focus_area::text not in ('B', 'R', 'A', 'V', 'E') then
    raise exception using
      message = 'Goals go on Bond, Raise, Amplify, Vitality or Enjoyment.',
      detail = format('goal_pillar_retired:%s', new.focus_area);
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_goal_pillar_trg on public.quarterly_goals;
create trigger enforce_goal_pillar_trg
  before insert or update of focus_area on public.quarterly_goals
  for each row execute function public.enforce_goal_pillar();

-- Improvement maps: same five pillars, so the mirrored goal always fits.
create or replace function public.enforce_itc_map_pillar()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' or new.pillar_code is distinct from old.pillar_code)
     and new.pillar_code::text not in ('B', 'R', 'A', 'V', 'E') then
    raise exception using
      message = 'Improvement maps go on Bond, Raise, Amplify, Vitality or Enjoyment.',
      detail = format('goal_pillar_retired:%s', new.pillar_code);
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_itc_map_pillar_trg on public.itc_maps;
create trigger enforce_itc_map_pillar_trg
  before insert or update of pillar_code on public.itc_maps
  for each row execute function public.enforce_itc_map_pillar();
