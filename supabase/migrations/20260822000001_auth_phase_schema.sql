-- =============================================================================
-- Auth phase — schema (Checkpoint A of the Password Auth + ITC Migration spec)
--
-- Product decision 2026-08-22: ITC access is a per-user grant, not a
-- community-level flag. The earlier draft of this migration added
-- communities.itc_enabled, but pinning ITC to community membership
-- can't accommodate cross-community coaching programs or ad-hoc
-- coachees not in any community. The user-level flag matches how
-- coaching actually works — access is granted to the person, not
-- the group.
--
-- If we later want proper cohorts (facilitator + roster + season),
-- those become new tables layered ON TOP of this flag; the flag
-- stays as the low-level access primitive.
--
-- Three additive columns, one data backfill:
--
--   users.itc_access          — boolean, default false. True grants
--                                the user access to /itc/*. Set by
--                                the ITC migration script for
--                                existing participants; set by the
--                                admin when granting a net-new
--                                coachee access.
--
--   users.invited_at          — null means: account exists but no
--                                activation email has been sent yet.
--                                Set to now() by the admin Send Invite
--                                action, never by any other flow.
--
--   itc_maps.user_id          — nullable during the transition.
--                                itc_participants.id (still on the
--                                row for audit history) → users.id
--                                (the new source of truth for
--                                ownership). The ITC migration
--                                script (E dry-run, F apply) writes
--                                this via matched email lookup.
--
-- One backfill in this migration: any users.id whose email matches an
-- itc_participants.email (case-insensitive) gets itc_access=true.
-- Handles the historical population in one shot. The migration
-- script's --apply path also sets this idempotently for any
-- participant it links, so participants added later stay consistent.
-- =============================================================================

alter table users
  add column if not exists itc_access boolean not null default false;

alter table users
  add column if not exists invited_at timestamptz;

alter table itc_maps
  add column if not exists user_id uuid references users(id);

-- Backfill: grant itc_access to every user whose email matches an
-- existing itc_participants row. Case-insensitive; safe on repeat
-- runs because it only sets true (never resets).
update users u
   set itc_access = true
  from itc_participants p
 where lower(u.email) = lower(p.email)
   and u.itc_access = false;

-- Index for the /itc first-login redirect. When a user hits /itc
-- after authenticating, we look up "does this user have any
-- itc_maps.user_id = his id?" cheaply. Non-unique because a user
-- can have multiple maps over time (only one in-progress at a time
-- per the 20260828000001 constraint, but completed maps stack up).
create index if not exists itc_maps_user_id_idx
  on itc_maps (user_id)
  where user_id is not null;
