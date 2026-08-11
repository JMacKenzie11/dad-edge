-- =============================================================================
-- BRAVE MAN OS — full database schema (Phase 1)
-- Consolidated from supabase/migrations/*. Run this once on a fresh Postgres
-- database (Supabase project). Idempotent-ish: uses `if not exists` where
-- possible so a repeat run against a clean project won't error, but this is
-- NOT a migration — do not run on an existing populated database.
--
-- Source of truth: braveman-app-build-config.md
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_source as enum ('manual', 'stripe');
exception when duplicate_object then null; end $$;

do $$ begin
  create type community_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type membership_role as enum ('member', 'leader');
exception when duplicate_object then null; end $$;

do $$ begin
  create type membership_status as enum ('active', 'inactive', 'removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type goal_status as enum ('active', 'completed', 'abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mission_status as enum ('planned', 'completed', 'missed', 'rolled_over');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mission_creator as enum ('user', 'coach_suggested');
exception when duplicate_object then null; end $$;

do $$ begin
  create type coach_mode as enum ('general', 'mission');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pillar_code as enum ('B', 'R', 'A', 'V', 'E', 'M', 'A2', 'N');
exception when duplicate_object then null; end $$;

do $$ begin
  create type relationship_label as enum ('wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'fiancee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type flag_status as enum ('open', 'reviewed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type employment_type as enum (
    'w2', 'contract', 'self_employed', 'business_owner', 'other'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- 2. Users
--    id must equal auth.uid(). Extends auth.users with app-level state.
-- -----------------------------------------------------------------------------
create table if not exists users (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text unique not null,
  first_name            text,
  last_name             text,
  phone                 text,
  timezone              text not null default 'America/Chicago',
  is_platform_admin     boolean not null default false,
  subscription_status   subscription_status not null default 'trialing',
  subscription_source   subscription_source not null default 'manual',
  stripe_customer_id    text,
  canceled_at           timestamptz,
  onboarding_step       smallint not null default 0,   -- 0 = not started, 7 = complete
  why_yes               text,                          -- §12.1 step 2, fuel for coach
  occupation            text,                          -- free-text "Software engineer", "Electrician", "Sales director"
  employment_type       employment_type,               -- w2 / contract / self_employed / business_owner / other
  created_at            timestamptz not null default now(),
  last_seen_at          timestamptz
);

create index if not exists users_email_idx on users (lower(email));

-- Auto-provision app row when a new auth user signs up.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.is_platform_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.users where id = auth.uid()), false);
$$;

-- -----------------------------------------------------------------------------
-- 3. Communities, memberships, weeks
-- -----------------------------------------------------------------------------
create table if not exists communities (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text unique not null,
  accent_color          text,
  timezone              text not null default 'America/Chicago',
  leaderboard_enabled   boolean not null default true,
  missions_visible      boolean not null default true,
  status                community_status not null default 'active',
  week_lock_days        smallint not null default 3,
  created_at            timestamptz not null default now()
);

create table if not exists memberships (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  community_id          uuid not null references communities(id) on delete cascade,
  role                  membership_role not null default 'member',
  status                membership_status not null default 'active',
  joined_at             timestamptz not null default now(),
  deactivated_at        timestamptz,
  canceled_visible_until timestamptz,
  unique (user_id, community_id)
);

create index if not exists memberships_community_status_idx on memberships (community_id, status);

create table if not exists weeks (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  start_date            date not null,
  is_intensive          boolean not null default false,
  locked_at             timestamptz,
  unique (community_id, start_date)
);

create or replace function public.shares_active_community(target_user uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m1
    join memberships m2 on m1.community_id = m2.community_id
    where m1.user_id = auth.uid()
      and m1.status = 'active'
      and m2.user_id = target_user
      and m2.status in ('active', 'inactive')
      and (
        m2.status = 'active'
        or (m2.canceled_visible_until is not null and m2.canceled_visible_until > now())
      )
  );
$$;

create or replace function public.is_leader_of_target(target_user uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m_leader
    join memberships m_target on m_leader.community_id = m_target.community_id
    where m_leader.user_id = auth.uid()
      and m_leader.role = 'leader'
      and m_leader.status = 'active'
      and m_target.user_id = target_user
  );
$$;

-- Bypasses RLS on memberships to avoid infinite recursion in the
-- "memberships: leader manage own community" policy.
create or replace function public.is_leader_of_community(target_community uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships lm
    where lm.user_id = auth.uid()
      and lm.community_id = target_community
      and lm.role = 'leader'
      and lm.status = 'active'
  );
$$;

-- -----------------------------------------------------------------------------
-- 4. Pillar framework, check-ins, goals, missions
-- -----------------------------------------------------------------------------
create table if not exists pillar_framework_versions (
  id                    uuid primary key default gen_random_uuid(),
  version               text not null unique,
  effective_date        date not null,
  definition            jsonb not null,
  created_at            timestamptz not null default now()
);

create table if not exists daily_checkins (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  date                  date not null,
  pillar_code           pillar_code not null,
  value                 smallint not null check (value in (0, 1)),
  logged_at             timestamptz not null default now(),
  edited_at             timestamptz,
  unique (user_id, date, pillar_code)
);

create index if not exists daily_checkins_user_date_idx on daily_checkins (user_id, date);
create index if not exists daily_checkins_date_idx on daily_checkins (date);

create table if not exists quarterly_goals (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  quarter_start         date not null,
  focus_area            pillar_code not null,
  description           text not null,
  status                goal_status not null default 'active',
  created_at            timestamptz not null default now()
);

create index if not exists quarterly_goals_user_quarter_idx on quarterly_goals (user_id, quarter_start);

create table if not exists missions (
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
  is_exemplar           boolean not null default false,
  created_at            timestamptz not null default now()
);

create index if not exists missions_user_target_idx on missions (user_id, target_date);
create index if not exists missions_community_target_idx on missions (community_id, target_date);
create index if not exists missions_exemplar_pillar_idx
  on missions (pillar_code, is_exemplar)
  where is_exemplar = true;

do $$ begin
  alter table missions
    add constraint mission_description_min_length
    check (char_length(trim(description)) >= 8);
exception when duplicate_object then null; end $$;

-- Weekly mission caps: 15 total, 5 per goal bucket, 5 for "other" (unattached).
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

drop trigger if exists enforce_mission_weekly_cap_trg on missions;
create trigger enforce_mission_weekly_cap_trg
  before insert or update of target_date on missions
  for each row execute function public.enforce_mission_weekly_cap();

-- Two active quarterly goals per user per quarter.
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

-- -----------------------------------------------------------------------------
-- 5. Family layer — partner, children, Partner Connection Survey
--    Privacy per §12.4: owning user only. RLS enforces below.
-- -----------------------------------------------------------------------------
create table if not exists partner_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references users(id) on delete cascade,
  partner_name          text,
  relationship_label    relationship_label,
  partner_birthdate     date,
  relationship_date     date,
  things_loved          text[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists children (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  name                  text not null,
  birthdate             date,
  things_loved          text[] not null default '{}',
  created_at            timestamptz not null default now()
);

create index if not exists children_user_idx on children (user_id);

create table if not exists survey_question_sets (
  id                    uuid primary key default gen_random_uuid(),
  version               text not null unique,
  effective_date        date not null,
  created_at            timestamptz not null default now()
);

create table if not exists survey_questions (
  id                    uuid primary key default gen_random_uuid(),
  question_set_id       uuid not null references survey_question_sets(id) on delete cascade,
  sort_order            int not null,
  text                  text not null,
  unique (question_set_id, sort_order)
);

create table if not exists partner_surveys (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  question_set_id       uuid not null references survey_question_sets(id),
  taken_at              timestamptz not null default now(),
  context_note          text
);

create index if not exists partner_surveys_user_idx on partner_surveys (user_id, taken_at desc);

create table if not exists partner_survey_responses (
  id                    uuid primary key default gen_random_uuid(),
  survey_id             uuid not null references partner_surveys(id) on delete cascade,
  question_id           uuid not null references survey_questions(id),
  score                 smallint not null check (score between 1 and 5),
  note                  text,
  unique (survey_id, question_id)
);

-- -----------------------------------------------------------------------------
-- 6. Coach, admin, audit
-- -----------------------------------------------------------------------------
create table if not exists coach_conversations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  mode                  coach_mode not null,
  title                 text,
  summary               text,
  summary_updated_at    timestamptz,
  archived_at           timestamptz,
  started_at            timestamptz not null default now(),
  last_message_at       timestamptz
);

create index if not exists coach_conversations_user_recent_idx
  on coach_conversations (user_id, archived_at, last_message_at desc);

create table if not exists coach_messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references coach_conversations(id) on delete cascade,
  role                  text not null check (role in ('user','assistant','system')),
  content               text not null,
  model_used            text,
  tokens_in             int,
  tokens_out            int,
  flagged               boolean not null default false,
  flag_reason           text,
  created_at            timestamptz not null default now()
);

create index if not exists coach_messages_conversation_idx on coach_messages (conversation_id, created_at);

create table if not exists coach_flags_queue (
  id                    uuid primary key default gen_random_uuid(),
  message_id            uuid not null references coach_messages(id) on delete cascade,
  severity              text not null,
  status                flag_status not null default 'open',
  reviewed_by           uuid references users(id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now()
);

create table if not exists score_corrections (
  id                    uuid primary key default gen_random_uuid(),
  admin_user_id         uuid not null references users(id) on delete set null,
  target_user_id        uuid not null references users(id) on delete cascade,
  date                  date not null,
  pillar_code           pillar_code not null,
  old_value             smallint,
  new_value             smallint,
  reason                text not null,
  created_at            timestamptz not null default now()
);

create table if not exists audit_log (
  id                    uuid primary key default gen_random_uuid(),
  actor_user_id         uuid references users(id) on delete set null,
  action                text not null,
  target_type           text,
  target_id             uuid,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index if not exists audit_log_actor_idx on audit_log (actor_user_id, created_at desc);
create index if not exists audit_log_target_idx on audit_log (target_type, target_id);

create table if not exists nudge_settings (
  community_id          uuid primary key references communities(id) on delete cascade,
  daily_reminder_time   time not null default '18:00',
  disengagement_ladder  jsonb not null default '{"day3":true,"day7":true,"day14":true}'::jsonb
);

create table if not exists digests (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  week_start            date not null,
  generated_at          timestamptz not null default now(),
  body                  jsonb not null,
  unique (community_id, week_start)
);

create table if not exists invites (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  email                 text not null,
  first_name            text,
  last_name             text,
  invited_by            uuid references users(id) on delete set null,
  redeemed_by           uuid references users(id) on delete set null,
  redeemed_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (community_id, email)
);

-- Daily reflections — two optional free-text fields per user per day, used as
-- coach context. Self-only per §12.4 posture.
create table if not exists daily_reflections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  date                  date not null,
  wins                  text,
  learnings             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists daily_reflections_user_date_idx
  on daily_reflections (user_id, date desc);

-- =============================================================================
-- Row Level Security (§3 posture + §12.4 family-layer privacy)
-- Platform admin uses the service role (bypasses RLS) — all such reads must be
-- audit-logged from application code.
-- =============================================================================
alter table users enable row level security;
alter table communities enable row level security;
alter table memberships enable row level security;
alter table pillar_framework_versions enable row level security;
alter table weeks enable row level security;
alter table daily_checkins enable row level security;
alter table quarterly_goals enable row level security;
alter table missions enable row level security;
alter table partner_profiles enable row level security;
alter table children enable row level security;
alter table survey_question_sets enable row level security;
alter table survey_questions enable row level security;
alter table partner_surveys enable row level security;
alter table partner_survey_responses enable row level security;
alter table coach_conversations enable row level security;
alter table coach_messages enable row level security;
alter table coach_flags_queue enable row level security;
alter table score_corrections enable row level security;
alter table audit_log enable row level security;
alter table nudge_settings enable row level security;
alter table digests enable row level security;
alter table invites enable row level security;
alter table daily_reflections enable row level security;

-- Drop any pre-existing policies of the same names, then recreate.
drop policy if exists "users: self read"              on users;
drop policy if exists "users: community-mate read"    on users;
drop policy if exists "users: platform admin read"    on users;
drop policy if exists "users: self update"            on users;
create policy "users: self read"           on users for select using (id = auth.uid());
create policy "users: community-mate read" on users for select using (public.shares_active_community(id));
create policy "users: platform admin read" on users for select using (public.is_platform_admin());
create policy "users: self update"         on users for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "communities: member read"  on communities;
drop policy if exists "communities: admin manage" on communities;
create policy "communities: member read" on communities for select using (
  exists (select 1 from memberships where user_id = auth.uid() and community_id = communities.id and status = 'active')
);
create policy "communities: admin manage" on communities for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "memberships: self read"             on memberships;
drop policy if exists "memberships: community-mate read"   on memberships;
drop policy if exists "memberships: leader manage own community" on memberships;
drop policy if exists "memberships: admin all"             on memberships;
create policy "memberships: self read" on memberships for select using (user_id = auth.uid());
create policy "memberships: community-mate read" on memberships for select using (public.shares_active_community(user_id));
create policy "memberships: leader manage own community" on memberships for all
  using (public.is_leader_of_community(community_id))
  with check (public.is_leader_of_community(community_id));
create policy "memberships: admin all" on memberships for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "framework: authenticated read" on pillar_framework_versions;
drop policy if exists "framework: admin manage"       on pillar_framework_versions;
create policy "framework: authenticated read" on pillar_framework_versions for select using (auth.role() = 'authenticated');
create policy "framework: admin manage"       on pillar_framework_versions for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "weeks: member read"   on weeks;
drop policy if exists "weeks: leader manage" on weeks;
create policy "weeks: member read" on weeks for select using (
  exists (select 1 from memberships where user_id = auth.uid() and community_id = weeks.community_id)
);
create policy "weeks: leader manage" on weeks for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = weeks.community_id
        and lm.role = 'leader'
        and lm.status = 'active'
    )
  )
  with check (true);

drop policy if exists "checkins: self read"           on daily_checkins;
drop policy if exists "checkins: community-mate read" on daily_checkins;
drop policy if exists "checkins: self write"          on daily_checkins;
drop policy if exists "checkins: self update"         on daily_checkins;
drop policy if exists "checkins: self delete"         on daily_checkins;
create policy "checkins: self read"           on daily_checkins for select using (user_id = auth.uid());
create policy "checkins: community-mate read" on daily_checkins for select using (public.shares_active_community(user_id));
create policy "checkins: self write"          on daily_checkins for insert with check (user_id = auth.uid());
create policy "checkins: self update"         on daily_checkins for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "checkins: self delete"         on daily_checkins for delete using (user_id = auth.uid());

drop policy if exists "goals: self read"           on quarterly_goals;
drop policy if exists "goals: community-mate read" on quarterly_goals;
drop policy if exists "goals: self write"          on quarterly_goals;
create policy "goals: self read"           on quarterly_goals for select using (user_id = auth.uid());
create policy "goals: community-mate read" on quarterly_goals for select using (public.shares_active_community(user_id));
create policy "goals: self write"          on quarterly_goals for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "missions: self read"           on missions;
drop policy if exists "missions: community-mate read" on missions;
drop policy if exists "missions: self write"          on missions;
create policy "missions: self read"           on missions for select using (user_id = auth.uid());
create policy "missions: community-mate read" on missions for select using (public.shares_active_community(user_id));
create policy "missions: self write"          on missions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Family layer — owning user only. Never community, never leaders. §12.4.
drop policy if exists "partner_profiles: self only" on partner_profiles;
drop policy if exists "children: self only"         on children;
drop policy if exists "surveys: self only"          on partner_surveys;
drop policy if exists "survey_responses: self only" on partner_survey_responses;
drop policy if exists "survey_questions: authenticated read"     on survey_questions;
drop policy if exists "survey_question_sets: authenticated read" on survey_question_sets;
create policy "partner_profiles: self only" on partner_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "children: self only"         on children         for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "surveys: self only"          on partner_surveys  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "survey_responses: self only" on partner_survey_responses for all
  using (
    exists (select 1 from partner_surveys ps where ps.id = partner_survey_responses.survey_id and ps.user_id = auth.uid())
  )
  with check (
    exists (select 1 from partner_surveys ps where ps.id = partner_survey_responses.survey_id and ps.user_id = auth.uid())
  );
create policy "survey_questions: authenticated read"     on survey_questions     for select using (auth.role() = 'authenticated');
create policy "survey_question_sets: authenticated read" on survey_question_sets for select using (auth.role() = 'authenticated');

-- Coach — self only. Flags visible to platform admin only (DECISION #6).
drop policy if exists "coach_conversations: self"       on coach_conversations;
drop policy if exists "coach_conversations: admin read" on coach_conversations;
drop policy if exists "coach_messages: self"            on coach_messages;
drop policy if exists "coach_messages: admin read"      on coach_messages;
drop policy if exists "coach_flags: admin only"         on coach_flags_queue;
create policy "coach_conversations: self"       on coach_conversations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "coach_conversations: admin read" on coach_conversations for select using (public.is_platform_admin());
create policy "coach_messages: self" on coach_messages for all
  using (exists (select 1 from coach_conversations cc where cc.id = coach_messages.conversation_id and cc.user_id = auth.uid()))
  with check (exists (select 1 from coach_conversations cc where cc.id = coach_messages.conversation_id and cc.user_id = auth.uid()));
create policy "coach_messages: admin read" on coach_messages for select using (public.is_platform_admin());
create policy "coach_flags: admin only" on coach_flags_queue for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Score corrections + audit log.
drop policy if exists "score_corrections: admin all"   on score_corrections;
drop policy if exists "score_corrections: target read" on score_corrections;
drop policy if exists "audit_log: admin read"          on audit_log;
create policy "score_corrections: admin all"   on score_corrections for all using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "score_corrections: target read" on score_corrections for select using (target_user_id = auth.uid());
create policy "audit_log: admin read"          on audit_log for select using (public.is_platform_admin());

-- Nudges + digests.
drop policy if exists "nudge_settings: community-mate read" on nudge_settings;
drop policy if exists "nudge_settings: leader manage"       on nudge_settings;
drop policy if exists "digests: community-mate read"        on digests;
create policy "nudge_settings: community-mate read" on nudge_settings for select
  using (exists (select 1 from memberships where user_id = auth.uid() and community_id = nudge_settings.community_id));
create policy "nudge_settings: leader manage" on nudge_settings for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = nudge_settings.community_id
        and lm.role = 'leader'
    )
  )
  with check (true);
create policy "digests: community-mate read" on digests for select
  using (exists (select 1 from memberships where user_id = auth.uid() and community_id = digests.community_id));

-- Invites — leaders manage their community; admin all.
drop policy if exists "invites: leader manage" on invites;
drop policy if exists "invites: admin all"     on invites;
create policy "invites: leader manage" on invites for all
  using (
    exists (
      select 1 from memberships lm
      where lm.user_id = auth.uid()
        and lm.community_id = invites.community_id
        and lm.role = 'leader'
    )
  )
  with check (true);
create policy "invites: admin all" on invites for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "reflections: self only" on daily_reflections;
create policy "reflections: self only"
  on daily_reflections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- Seed data: pillar framework v1 + Partner Connection Survey v1
-- Idempotent via `on conflict do nothing`.
-- =============================================================================
insert into pillar_framework_versions (version, effective_date, definition)
values (
  'v1',
  '2026-01-05',
  jsonb_build_object(
    'pillars', jsonb_build_array(
      jsonb_build_object('code', 'B',  'label', 'Bond',     'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'R',  'label', 'Raise',    'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'A',  'label', 'Amplify',  'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'V',  'label', 'Vitality', 'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'E',  'label', 'Enjoyment', 'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'M',  'label', 'Movement',  'point_rule', 'daily_binary'),
      jsonb_build_object('code', 'A2', 'label', 'Action',    'point_rule', 'derived_from_missions'),
      jsonb_build_object('code', 'N',  'label', 'Network',  'point_rule', 'daily_binary')
    ),
    'weekly_max', 56
  )
)
on conflict (version) do nothing;

-- Partner Connection Survey v1 — §12.3.
do $$
declare
  qset_id uuid;
begin
  select id into qset_id from survey_question_sets where version = 'v1';
  if qset_id is null then
    insert into survey_question_sets (version, effective_date) values ('v1', '2026-01-05') returning id into qset_id;

    insert into survey_questions (question_set_id, sort_order, text) values
      (qset_id,  1, 'How well do I truly know you?'),
      (qset_id,  2, 'How respected do you feel by me?'),
      (qset_id,  3, 'How vulnerable do you think I am with you?'),
      (qset_id,  4, 'How safe do you feel being vulnerable with me?'),
      (qset_id,  5, 'How much trust do you have in me?'),
      (qset_id,  6, 'How well do I receive constructive criticism from you?'),
      (qset_id,  7, 'How well do I express empathy toward you?'),
      (qset_id,  8, 'How well do I prioritize being kind to you?'),
      (qset_id,  9, 'How well do I respect your boundaries?'),
      (qset_id, 10, 'How committed do you believe I am to you?'),
      (qset_id, 11, 'How thoughtful am I toward you?'),
      (qset_id, 12, 'How well do I express my appreciation for you?'),
      (qset_id, 13, 'How well do I understand all the unseen work you do for our family?'),
      (qset_id, 14, 'How well do I support you when you need it most?'),
      (qset_id, 15, 'How good am I at following through on my commitments?');
  end if;
end $$;

-- =============================================================================
-- Done.
-- Next: create your first platform admin by signing in via magic link, then
-- run once:  update users set is_platform_admin = true where email = 'you@example.com';
-- =============================================================================
