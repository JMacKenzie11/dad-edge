-- =============================================================================
-- users.is_admin_only
--
-- Marks a user as backstage-only: no onboarding required, no community
-- required, no coachee-facing surfaces rendered. They exist to run
-- /admin. Distinct from is_platform_admin, which is the AUTH flag
-- (governs whether /admin is reachable). Admin-only is the UX flag
-- (governs whether the coachee shell is even shown).
--
-- Three valid combinations:
--   is_platform_admin=false, is_admin_only=false → coachee (default)
--   is_platform_admin=true,  is_admin_only=false → coachee + admin
--   is_platform_admin=true,  is_admin_only=true  → admin only
--
-- is_admin_only=true WITHOUT is_platform_admin=true is nonsense (an
-- admin-only user who can't reach /admin has no surfaces at all).
-- Enforced via a CHECK — the New Account form + user detail page
-- refuse the combination, and any DB-level attempt to set it fails.
-- =============================================================================

alter table users
  add column if not exists is_admin_only boolean not null default false;

-- Guard against the nonsense case (see comment above).
alter table users
  drop constraint if exists users_admin_only_requires_platform_admin;
alter table users
  add constraint users_admin_only_requires_platform_admin
  check (
    is_admin_only = false
    or is_platform_admin = true
  );

comment on column users.is_admin_only is
  'When true, user skips onboarding, has no community, and the coachee shell (Today, Missions, etc.) is hidden. Requires is_platform_admin=true (CHECK).';
