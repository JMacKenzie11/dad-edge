-- ITC Map Builder (ad-hoc addition for Boardroom)
-- Isolated from the main users/community graph. See DECISIONS.md "ITC Addendum".
-- RLS is enabled with NO policies so only the service role can read/write.
-- Auth for these tables is handled entirely at the API layer via itc_session cookie.

create extension if not exists "pgcrypto";

--
-- Enum types
--
create type itc_map_status as enum ('in_progress', 'complete');
create type itc_map_stage as enum (
  'goal', 'behaviors', 'worries', 'commitments', 'assumptions',
  'review', 'prioritize', 'test_design', 'test_running', 'results', 'done'
);
create type itc_behavior_source as enum ('user', 'suggested');
create type itc_test_type as enum ('data_mining', 'observation', 'thought_experiment', 'behavioral');
create type itc_test_status as enum ('designed', 'run', 'abandoned');
create type itc_assumption_verdict as enum ('held', 'partially_challenged', 'challenged');
create type itc_next_step as enum ('new_test', 'new_assumption', 'map_complete');

--
-- Participants. Not linked to public.users. Email is the natural key.
--
create table itc_participants (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  name          text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

--
-- Maps. One participant may have many maps (multiple attempts / goals).
-- pillar_code reuses the BRAVEMAN enum from the main app for a consistent domain.
--
create table itc_maps (
  id                uuid primary key default gen_random_uuid(),
  participant_id   uuid not null references itc_participants(id) on delete cascade,
  pillar_code       pillar_code not null,
  status            itc_map_status not null default 'in_progress',
  current_stage     itc_map_stage not null default 'goal',
  improvement_goal  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index itc_maps_participant_idx on itc_maps(participant_id, created_at desc);

--
-- Column 2: doing / not-doing behaviors.
--
create table itc_behaviors (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references itc_maps(id) on delete cascade,
  sort_order  smallint not null default 0,
  text        text not null,
  source      itc_behavior_source not null default 'user',
  created_at  timestamptz not null default now()
);
create index itc_behaviors_map_idx on itc_behaviors(map_id, sort_order);

--
-- Worry box. Exactly one worry per behavior (UNIQUE constraint on behavior_id).
--
create table itc_worries (
  id           uuid primary key default gen_random_uuid(),
  map_id       uuid not null references itc_maps(id) on delete cascade,
  behavior_id  uuid not null unique references itc_behaviors(id) on delete cascade,
  text         text not null,
  created_at   timestamptz not null default now()
);
create index itc_worries_map_idx on itc_worries(map_id);

--
-- Column 3: hidden competing commitments. Each follows from a worry.
--
create table itc_commitments (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references itc_maps(id) on delete cascade,
  worry_id    uuid not null references itc_worries(id) on delete cascade,
  text        text not null,
  created_at  timestamptz not null default now()
);
create index itc_commitments_map_idx on itc_commitments(map_id);

--
-- Column 4: Big Assumptions. If-then format. One flagged for testing at a time.
--
create table itc_assumptions (
  id                    uuid primary key default gen_random_uuid(),
  map_id                uuid not null references itc_maps(id) on delete cascade,
  sort_order            smallint not null default 0,
  text                  text not null,
  selected_for_testing  boolean not null default false,
  coach_recommended     boolean not null default false,
  created_at            timestamptz not null default now()
);
create index itc_assumptions_map_idx on itc_assumptions(map_id, sort_order);

--
-- Tests. Guides' Appendix D template: four fields + mission-format target date.
--
create table itc_tests (
  id                  uuid primary key default gen_random_uuid(),
  map_id              uuid not null references itc_maps(id) on delete cascade,
  assumption_id       uuid not null references itc_assumptions(id) on delete cascade,
  test_type           itc_test_type not null,
  assumption_says     text,
  behavior_change     text,
  data_to_collect     text,
  in_order_to_find_out text,
  target_date         date,
  status              itc_test_status not null default 'designed',
  created_at          timestamptz not null default now()
);
create index itc_tests_map_idx on itc_tests(map_id, created_at desc);

--
-- Test results. Debrief captured verbatim.
--
create table itc_test_results (
  id                          uuid primary key default gen_random_uuid(),
  test_id                     uuid not null references itc_tests(id) on delete cascade,
  ran_on                      date,
  what_i_did                  text,
  data_collected              text,
  what_it_says_about_assumption text,
  assumption_verdict          itc_assumption_verdict,
  next_step                   itc_next_step,
  created_at                  timestamptz not null default now()
);
create index itc_test_results_test_idx on itc_test_results(test_id);

--
-- Full coaching transcript. Role is TEXT to match main coach_messages convention.
--
create table itc_messages (
  id          uuid primary key default gen_random_uuid(),
  map_id      uuid not null references itc_maps(id) on delete cascade,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index itc_messages_map_idx on itc_messages(map_id, created_at);

--
-- Row Level Security: enable on every table with NO policies.
-- The anon key cannot read or write these tables. Only the service role
-- (used exclusively by /api/itc/* server code) has access. API-layer
-- checks enforce participant scoping using the itc_session cookie.
--
alter table itc_participants   enable row level security;
alter table itc_maps           enable row level security;
alter table itc_behaviors      enable row level security;
alter table itc_worries        enable row level security;
alter table itc_commitments    enable row level security;
alter table itc_assumptions    enable row level security;
alter table itc_tests          enable row level security;
alter table itc_test_results   enable row level security;
alter table itc_messages       enable row level security;

--
-- Touch updated_at on itc_maps whenever any child row changes.
--
create or replace function itc_touch_map_updated_at() returns trigger
language plpgsql as $$
begin
  update itc_maps set updated_at = now() where id = coalesce(new.map_id, old.map_id);
  return coalesce(new, old);
end;
$$;

create trigger itc_maps_touch_self
  before update on itc_maps
  for each row execute function itc_touch_map_updated_at();
