--
-- Entitlement gate (§5) needs a per-user "when did canceled state begin?"
-- moment to compute the win-back window (DECISION #4: 30 days).
-- memberships.deactivated_at is per-community; the app-level gate needs an
-- app-level column.
--
alter table users
  add column canceled_at timestamptz;
