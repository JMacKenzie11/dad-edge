create table communities (
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

create table memberships (
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

create index memberships_community_status_idx on memberships (community_id, status);

create table weeks (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  start_date            date not null,
  is_intensive          boolean not null default false,
  locked_at             timestamptz,
  unique (community_id, start_date)
);

--
-- Helper: does the current user share an active community with the target user?
-- Used by member-visibility policies.
--
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

--
-- Helper: is the current user a leader of any community that the target user belongs to?
--
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
