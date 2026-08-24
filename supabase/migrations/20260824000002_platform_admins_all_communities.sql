-- =============================================================================
-- Platform admins get automatic leader membership in every community.
--
-- Product decision (2026-08-24): platform admins should have full
-- access to every community — existing ones and any created in the
-- future. Rather than special-casing admin queries throughout the
-- app, we materialize this as real memberships (role='leader',
-- status='active') so every existing membership-scoped query path
-- (leaderboards, roster, community page, mission targeting) works
-- unchanged.
--
-- Three moving parts:
--   1. Backfill: for every (admin, community) pair not already in
--      memberships, insert as leader.
--   2. Trigger on communities INSERT: any new community
--      auto-provisions leader memberships for every current admin.
--   3. Trigger on users when is_platform_admin flips true (INSERT or
--      UPDATE): backfill memberships for that user across all
--      existing communities.
--
-- Idempotent via ON CONFLICT DO NOTHING (unique (user_id,
-- community_id) already exists). Never demotes an existing member to
-- leader — if an admin was already a plain member of a community for
-- some reason, that row stays as-is; the insert simply no-ops.
-- =============================================================================

-- 1. Backfill existing state.
insert into memberships (user_id, community_id, role, status)
select u.id, c.id, 'leader', 'active'
from users u
cross join communities c
where u.is_platform_admin = true
  and c.status = 'active'
on conflict (user_id, community_id) do nothing;

-- 2. On community insert, auto-provision leader memberships for
--    every current platform admin.
create or replace function public.grant_admins_new_community()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into memberships (user_id, community_id, role, status)
  select u.id, new.id, 'leader', 'active'
  from users u
  where u.is_platform_admin = true
  on conflict (user_id, community_id) do nothing;
  return new;
end;
$$;

drop trigger if exists communities_grant_admins on communities;
create trigger communities_grant_admins
  after insert on communities
  for each row
  execute function public.grant_admins_new_community();

-- 3. On users insert/update with is_platform_admin = true,
--    backfill memberships for that admin across all active
--    communities. Fires for both fresh admin creations
--    (createAccount with the checkbox) and flag-flips on the
--    /admin/users detail page (setPlatformAdmin).
create or replace function public.grant_admin_all_communities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_platform_admin is not true then
    return new;
  end if;
  -- On UPDATE, only fire when the flag actually flipped on. Avoids
  -- unnecessary work when the admin's row is touched for other
  -- reasons (name, subscription, etc.).
  if tg_op = 'UPDATE' and old.is_platform_admin is true then
    return new;
  end if;
  insert into memberships (user_id, community_id, role, status)
  select new.id, c.id, 'leader', 'active'
  from communities c
  where c.status = 'active'
  on conflict (user_id, community_id) do nothing;
  return new;
end;
$$;

drop trigger if exists users_grant_admin_communities on users;
create trigger users_grant_admin_communities
  after insert or update of is_platform_admin on users
  for each row
  execute function public.grant_admin_all_communities();
