-- =============================================================================
-- Challenges (DECISIONS.md "Challenges").
--
-- A leader (or a platform admin) sets a challenge for one community: a
-- domain, a mission, the days it's done on, how many of those days a week
-- count as hitting it, and a start and end date. A member who opts in gets
-- one mission a week for the rest of the challenge, created when he joins.
-- He closes each week with the ordinary COMPLETE; a week counts when its
-- challenge mission is completed.
--
--   challenges                one row per challenge
--   challenge_participants    who's in, who left, who said "not for me"
--   missions.challenge_id     marks a challenge mission
--
-- Joining and leaving go through join_challenge() / leave_challenge(),
-- which run as the member (security invoker), so row-level security and
-- the mission trigger apply exactly as they do to anything he writes.
--
-- Weekly caps: a challenge mission takes one of his two slots in its domain
-- and is allowed to push that domain over two. To keep that from becoming a
-- way round the cap, the trigger checks every challenge mission against its
-- challenge on the way in (his challenge, he's in it, the challenge's own
-- wording, domain and days, one per week) and refuses edits to its days,
-- domain or wording afterwards.
-- =============================================================================

create table if not exists public.challenges (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities(id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 3 and 80),
  pillar_code         pillar_code not null check (pillar_code::text in ('B', 'R', 'A', 'V', 'E')),
  mission_description text not null check (char_length(btrim(mission_description)) between 8 and 280),
  -- ISO weekdays, 1 = Monday .. 7 = Sunday, sorted, no repeats.
  days                smallint[] not null
                      check (cardinality(days) between 1 and 7 and days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- How many of `days` he has to do in a week. The mission wording carries
  -- it; the app shows it beside the mission.
  target              smallint not null check (target >= 1 and target <= cardinality(days)),
  starts_on           date not null,
  ends_on             date not null,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 366)
);

create index if not exists challenges_community_idx on public.challenges (community_id, ends_on);

create table if not exists public.challenge_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  -- in: opted in.  left: opted out partway.  declined: tapped "Not for me".
  status       text not null check (status in ('in', 'left', 'declined')),
  joined_at    timestamptz,
  left_at      timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create index if not exists challenge_participants_user_idx on public.challenge_participants (user_id);

alter table public.missions
  add column if not exists challenge_id uuid references public.challenges(id) on delete set null;

create index if not exists missions_challenge_idx on public.missions (challenge_id, user_id) where challenge_id is not null;

-- Helper: is the current user an active member of this community?
create or replace function public.is_active_member_of(target_community uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and community_id = target_community and status = 'active'
  );
$$;

-- Row-level security ----------------------------------------------------------

alter table public.challenges enable row level security;
alter table public.challenge_participants enable row level security;

drop policy if exists "challenges: member read" on public.challenges;
create policy "challenges: member read"
  on public.challenges for select to authenticated
  using (public.is_active_member_of(community_id) or public.is_platform_admin());

drop policy if exists "challenges: leader manage" on public.challenges;
create policy "challenges: leader manage"
  on public.challenges for all to authenticated
  using (public.is_leader_of_community(community_id) or public.is_platform_admin())
  with check (public.is_leader_of_community(community_id) or public.is_platform_admin());

-- The community board shows who's in and how each man is doing, so
-- community-mates read each other's rows. Only he writes his own.
drop policy if exists "challenge_participants: community read" on public.challenge_participants;
create policy "challenge_participants: community read"
  on public.challenge_participants for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.challenges c
      where c.id = challenge_participants.challenge_id
        and (public.is_active_member_of(c.community_id) or public.is_platform_admin())
    )
  );

drop policy if exists "challenge_participants: self insert" on public.challenge_participants;
create policy "challenge_participants: self insert"
  on public.challenge_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenges c
      where c.id = challenge_participants.challenge_id
        and public.is_active_member_of(c.community_id)
    )
  );

drop policy if exists "challenge_participants: self update" on public.challenge_participants;
create policy "challenge_participants: self update"
  on public.challenge_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.challenges, public.challenge_participants from anon;
grant select, insert, update, delete on public.challenges to authenticated;
grant select, insert, update on public.challenge_participants to authenticated;
revoke delete on public.challenge_participants from authenticated;

-- Challenge edits -------------------------------------------------------------

-- Once anyone has joined, the days, dates, target and domain are fixed:
-- missions already exist for them. The name and wording can still change,
-- and new wording flows to everyone's upcoming missions.
create or replace function public.guard_challenge_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.days, new.target, new.starts_on, new.ends_on, new.pillar_code, new.community_id)
       is distinct from
     (old.days, old.target, old.starts_on, old.ends_on, old.pillar_code, old.community_id)
     and exists (select 1 from challenge_participants where challenge_id = old.id and joined_at is not null) then
    raise exception using
      message = 'Someone has already joined, so the days, dates, target and domain are locked.',
      detail = 'challenge_locked';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guard_challenge_update_trg on public.challenges;
create trigger guard_challenge_update_trg
  before update on public.challenges
  for each row execute function public.guard_challenge_update();

-- Runs as the owner: the leader editing the wording can't write other
-- members' missions himself.
create or replace function public.sync_challenge_missions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update missions
     set description = new.mission_description
   where challenge_id = new.id
     and status = 'planned'
     and target_date >= current_date;
  return null;
end;
$$;

drop trigger if exists sync_challenge_missions_trg on public.challenges;
create trigger sync_challenge_missions_trg
  after update of mission_description on public.challenges
  for each row
  when (new.mission_description is distinct from old.mission_description)
  execute function public.sync_challenge_missions();

-- Deleting a challenge removes everyone's upcoming challenge missions.
-- Finished and past ones stay as ordinary missions (challenge_id goes null).
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
     and target_date >= current_date;
  return old;
end;
$$;

drop trigger if exists clear_challenge_missions_trg on public.challenges;
create trigger clear_challenge_missions_trg
  before delete on public.challenges
  for each row execute function public.clear_challenge_missions();

-- Weekly cap, now aware of challenge missions --------------------------------
-- Unchanged from 20261015000001 except the challenge block at the top and
-- two more columns in the trigger's column list.

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
  ch public.challenges;
begin
  -- Challenge missions ---------------------------------------------------
  -- Checked before anything else, whatever the status, so no combination
  -- of columns slips a changed one past.
  if tg_op = 'UPDATE' and old.challenge_id is not null then
    if new.challenge_id is null then
      -- Leaving and keeping it: it stays in its week as an ordinary
      -- mission. Already counted, so no cap check.
      if new.target_dates is distinct from old.target_dates
         or new.pillar_code is distinct from old.pillar_code
         or new.quarterly_goal_id is distinct from old.quarterly_goal_id then
        raise exception using
          message = 'A challenge mission keeps its days and domain.',
          detail = 'challenge_mission_locked';
      end if;
      return new;
    end if;
    select * into ch from challenges where id = new.challenge_id;
    if new.challenge_id is distinct from old.challenge_id
       or new.target_dates is distinct from old.target_dates
       or new.target_date is distinct from old.target_date
       or new.pillar_code is distinct from old.pillar_code
       or new.quarterly_goal_id is distinct from old.quarterly_goal_id
       or new.community_id is distinct from old.community_id
       or new.description is distinct from ch.mission_description then
      raise exception using
        message = 'A challenge mission keeps the challenge''s wording, days and domain.',
        detail = 'challenge_mission_locked';
    end if;
    return new;
  end if;

  if new.challenge_id is not null then
    if tg_op = 'UPDATE' then
      raise exception using
        message = 'An existing mission can''t be turned into a challenge mission.',
        detail = 'challenge_mission_locked';
    end if;
    select * into ch from challenges where id = new.challenge_id;
    if ch.id is null
       or new.community_id is distinct from ch.community_id
       or new.pillar_code is distinct from ch.pillar_code
       or new.quarterly_goal_id is not null
       or new.description is distinct from ch.mission_description then
      raise exception using
        message = 'That mission doesn''t match its challenge.',
        detail = 'challenge_mission_invalid';
    end if;
    if not exists (
      select 1 from challenge_participants p
      where p.challenge_id = ch.id and p.user_id = new.user_id and p.status = 'in'
    ) then
      raise exception using
        message = 'Join the challenge first.',
        detail = 'challenge_not_joined';
    end if;
    if new.target_date is distinct from (select max(d) from unnest(new.target_dates) d)
       or exists (
         select 1 from unnest(new.target_dates) d
         where d < ch.starts_on or d > ch.ends_on
            or extract(isodow from d)::smallint <> all (ch.days)
            or date_trunc('week', d) <> date_trunc('week', new.target_date)
       ) then
      raise exception using
        message = 'A challenge mission falls on the challenge''s days, inside its dates, in one week.',
        detail = 'challenge_mission_invalid';
    end if;
    if exists (
      select 1 from missions m
      where m.user_id = new.user_id
        and m.challenge_id = ch.id
        and m.id <> new.id
        and m.status not in ('rolled_over', 'abandoned')
        and date_trunc('week', m.target_date) = date_trunc('week', new.target_date)
    ) then
      raise exception using
        message = 'You already have this challenge''s mission that week.',
        detail = 'challenge_mission_duplicate';
    end if;
    -- Takes a domain slot but may go over two: the cap check is skipped.
    return new;
  end if;

  -- Everything below is unchanged ---------------------------------------

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

  -- Challenge missions count here: each takes one of the two slots.
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
  before insert or update of target_date, target_dates, quarterly_goal_id, pillar_code, status, challenge_id, description, community_id
  on public.missions
  for each row execute function public.enforce_mission_weekly_cap();

-- Joining and leaving ---------------------------------------------------------

-- Opts the current user in and creates one mission per remaining week:
-- the challenge's days from today (his own timezone) to the end date. A
-- week with none of the days left gets no mission; a part week's mission
-- carries only the days left, and the app cuts that week's target to fit.
-- Returns the number of missions created (0 if he was already in).
create or replace function public.join_challenge(p_challenge uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ch public.challenges;
  today date;
  current_status text;
  n int;
begin
  select * into ch from challenges where id = p_challenge;
  if ch.id is null or not public.is_active_member_of(ch.community_id) then
    raise exception using message = 'That challenge isn''t open to you.', detail = 'challenge_not_found';
  end if;

  select (now() at time zone coalesce(u.timezone, 'America/Chicago'))::date into today
  from users u where u.id = uid;
  if today > ch.ends_on then
    raise exception using message = 'That challenge has ended.', detail = 'challenge_over';
  end if;

  select status into current_status from challenge_participants
  where challenge_id = ch.id and user_id = uid;
  if current_status = 'in' then
    return 0;
  end if;

  insert into challenge_participants (challenge_id, user_id, status, joined_at, left_at, updated_at)
  values (ch.id, uid, 'in', now(), null, now())
  on conflict (challenge_id, user_id)
  do update set status = 'in', joined_at = now(), left_at = null, updated_at = now();

  insert into missions (user_id, community_id, description, pillar_code, target_date, target_dates, created_by, challenge_id)
  select uid, ch.community_id, ch.mission_description, ch.pillar_code, max(w.d), array_agg(w.d order by w.d), 'user', ch.id
  from (
    select g::date as d
    from generate_series(greatest(ch.starts_on, today), ch.ends_on, interval '1 day') g
    where extract(isodow from g)::smallint = any (ch.days)
  ) w
  group by date_trunc('week', w.d)
  -- Coming back after leaving: a week that still has his challenge
  -- mission keeps it.
  having not exists (
    select 1 from missions m
    where m.user_id = uid
      and m.challenge_id = ch.id
      and m.status not in ('rolled_over', 'abandoned')
      and date_trunc('week', m.target_date) = date_trunc('week', min(w.d))
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Opts the current user out. From today on, his challenge missions are
-- either removed or kept as ordinary missions, his choice. Finished and
-- past weeks stay on the board.
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
       and status = 'planned' and target_date >= today;
  else
    delete from missions
     where user_id = uid and challenge_id = p_challenge
       and status = 'planned' and target_date >= today;
  end if;
end;
$$;

revoke all on function public.join_challenge(uuid) from public, anon;
revoke all on function public.leave_challenge(uuid, boolean) from public, anon;
grant execute on function public.join_challenge(uuid) to authenticated;
grant execute on function public.leave_challenge(uuid, boolean) to authenticated;
