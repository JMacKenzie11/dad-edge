-- =============================================================================
-- Auth phase — schema (Checkpoint A of the Password Auth + ITC Migration spec)
--
-- Three additive columns, no data changes. Every backfill happens at
-- application-time (invite trigger, migration script) so we don't
-- silently create rows or move ownership as a side effect of this
-- migration.
--
--   communities.itc_enabled   — gate for the /itc route group under
--                                the unified auth. Boardroom
--                                community(ies) get this flipped to
--                                true via a data migration that lives
--                                separately from this schema DDL, per
--                                the "no hardcoded app knowledge of
--                                which community is ITC" rule.
--
--   users.invited_at          — null means: account exists but no
--                                activation email has been sent yet.
--                                Set to now() by the admin Send Invite
--                                action, never by any other flow. An
--                                account creation never populates this
--                                column; a login flow never populates
--                                this column; only the explicit
--                                Send Invite action does.
--
--   itc_maps.user_id          — nullable during the transition.
--                                itc_participants.id (still on the row
--                                for audit history) → users.id (the
--                                new source of truth for ownership).
--                                The ITC migration script (Checkpoint E
--                                dry-run, Checkpoint F apply) writes
--                                this column via matched email lookup.
--                                Never populated by any user-facing
--                                flow.
-- =============================================================================

alter table communities
  add column if not exists itc_enabled boolean not null default false;

alter table users
  add column if not exists invited_at timestamptz;

alter table itc_maps
  add column if not exists user_id uuid references users(id);

-- Index for the /itc first-login redirect. When a user hits /itc after
-- authenticating, we need to look up "does this user have any
-- itc_maps.user_id = his id?" cheaply. Non-unique because a user can
-- have multiple maps over time (only one in-progress at a time per
-- the 20260828000001 constraint, but completed maps stack up).
create index if not exists itc_maps_user_id_idx
  on itc_maps (user_id)
  where user_id is not null;
