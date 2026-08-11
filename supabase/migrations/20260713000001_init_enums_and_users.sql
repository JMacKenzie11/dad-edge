-- BRAVE MAN OS — initial schema
-- Section 3 data model. Row Level Security per Section 12.4 privacy posture.

create extension if not exists "pgcrypto";

--
-- Enum types
--
create type subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'comped');
create type subscription_source as enum ('manual', 'stripe');
create type community_status as enum ('active', 'archived');
create type membership_role as enum ('member', 'leader');
create type membership_status as enum ('active', 'inactive', 'removed');
create type goal_status as enum ('active', 'completed', 'abandoned');
create type mission_status as enum ('planned', 'completed', 'missed', 'rolled_over');
create type mission_creator as enum ('user', 'coach_suggested');
create type coach_mode as enum ('general', 'mission');
create type pillar_code as enum ('B', 'R', 'A', 'V', 'E', 'M', 'A2', 'N');
create type relationship_label as enum ('wife', 'husband', 'partner', 'girlfriend', 'boyfriend', 'fiancee');
create type flag_status as enum ('open', 'reviewed');

--
-- users: extends auth.users. Row per authenticated user.
-- id must equal auth.uid() for the app-level user row.
--
create table users (
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
  created_at            timestamptz not null default now(),
  last_seen_at          timestamptz
);

create index users_email_idx on users (lower(email));

--
-- Trigger: automatically create app users row on auth signup.
--
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

--
-- helper: is_platform_admin() reads from public.users
--
create or replace function public.is_platform_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.users where id = auth.uid()), false);
$$;
