create table pillar_framework_versions (
  id                    uuid primary key default gen_random_uuid(),
  version               text not null unique,
  effective_date        date not null,
  definition            jsonb not null,
  created_at            timestamptz not null default now()
);

create table daily_checkins (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  date                  date not null,
  pillar_code           pillar_code not null,
  value                 smallint not null check (value in (0, 1)),
  logged_at             timestamptz not null default now(),
  edited_at             timestamptz,
  unique (user_id, date, pillar_code)
);

create index daily_checkins_user_date_idx on daily_checkins (user_id, date);
create index daily_checkins_date_idx on daily_checkins (date);

create table quarterly_goals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  quarter_start         date not null,
  focus_area            pillar_code not null,
  description           text not null,
  status                goal_status not null default 'active',
  created_at            timestamptz not null default now()
);

create index quarterly_goals_user_quarter_idx on quarterly_goals (user_id, quarter_start);

create table missions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  community_id          uuid not null references communities(id) on delete cascade,
  quarterly_goal_id     uuid references quarterly_goals(id) on delete set null,
  description           text not null,
  pillar_code           pillar_code not null,
  target_date           date not null,
  status                mission_status not null default 'planned',
  rolled_over_from_mission_id uuid references missions(id) on delete set null,
  created_by            mission_creator not null default 'user',
  completed_at          timestamptz,
  completed_late        boolean not null default false,
  legacy_import         boolean not null default false,
  created_at            timestamptz not null default now()
);

create index missions_user_target_idx on missions (user_id, target_date);
create index missions_community_target_idx on missions (community_id, target_date);

--
-- Server-enforced concreteness check: description must be non-trivial and target_date must be set.
-- The full behavior+day validator lives in application code; this is the DB backstop.
--
alter table missions
  add constraint mission_description_min_length
  check (char_length(trim(description)) >= 8);

--
-- Missions per week cap = 5 (per DECISIONS #3).
-- Enforced by a trigger that counts sibling missions for the same target-week and user.
--
create or replace function public.enforce_mission_weekly_cap()
returns trigger
language plpgsql
as $$
declare
  week_start date;
  week_end   date;
  n int;
begin
  week_start := date_trunc('week', new.target_date)::date;
  week_end   := week_start + 6;
  select count(*) into n
  from missions
  where user_id = new.user_id
    and target_date between week_start and week_end
    and id <> new.id
    and status <> 'rolled_over';
  if n >= 5 then
    raise exception 'Missions per week cap reached (5) for user % week %', new.user_id, week_start;
  end if;
  return new;
end;
$$;

create trigger enforce_mission_weekly_cap_trg
  before insert or update of target_date on missions
  for each row execute function public.enforce_mission_weekly_cap();
