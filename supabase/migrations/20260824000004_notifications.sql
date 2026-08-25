-- =============================================================================
-- Notifications — in-app bell system
--
-- Each row is one notification for one user. Nightly cron jobs
-- (daily-reminders, week-lock, digest, mark-goals-for-review, plus
-- the new goal-midpoint-check) insert rows here alongside their
-- existing email sends. The bell UI reads unread count + recent rows.
--
-- Design intent:
--   - dedup_key makes every writer idempotent. Cron can re-run without
--     duplicating rows (unique constraint on user_id + kind + dedup_key,
--     ON CONFLICT DO NOTHING at the writer).
--   - deep_link is stored, not computed, so the click destination
--     survives even if the underlying object is later renamed.
--   - No actor_id in v1 — every notification kind so far is system-
--     generated. Add later when social events land.
--   - No delivery-channel column — email vs in-app is a job-level
--     decision, not per-row. Preferences UI comes later.
-- =============================================================================

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,

  -- Event type. Enum-in-text (not a Postgres enum) so adding a new
  -- kind is a code-only change, no migration required.
  kind        text not null,

  -- One-line title shown in the dropdown ("Week locks in 2 days. 3 unlogged.").
  title       text not null,
  -- Optional second line for context. Nullable.
  body        text,
  -- Route the user lands on when they click the row.
  deep_link   text not null,

  -- What the notification is about, for future filtering / grouping.
  -- Nullable — daily reminders aren't "about" a specific object.
  target_type text,   -- 'goal' | 'week' | 'digest' | ...
  target_id   uuid,

  -- Idempotency key. Writers pick a value that means "this occurrence
  -- of this kind for this user has already been sent":
  --   daily_reminder    → 'YYYY-MM-DD'
  --   week_lock         → week Monday 'YYYY-MM-DD'
  --   weekly_digest     → ISO week 'YYYY-Www'
  --   quarter_closing   → quarter start 'YYYY-MM-DD' + ':' + goal id
  --   goal_midpoint     → goal id
  dedup_key   text not null,

  -- Kind-specific extras (unlogged day count, digest metrics, etc.).
  -- Rendered by the bell dropdown; not queryable except at read time.
  metadata    jsonb not null default '{}'::jsonb,

  created_at  timestamptz not null default now(),
  read_at     timestamptz,

  unique (user_id, kind, dedup_key)
);

-- Dropdown query: last N notifications for a user, newest first.
create index if not exists notifications_user_recent_idx
  on notifications (user_id, created_at desc);

-- Unread badge count: cheap COUNT(*) on the partial index.
create index if not exists notifications_user_unread_idx
  on notifications (user_id) where read_at is null;

-- ----------------------------------------------------------------------------
-- RLS: a user can read + update (mark-read) their own notifications.
-- Writes happen server-side via the service client from cron jobs.
-- ----------------------------------------------------------------------------

alter table notifications enable row level security;

drop policy if exists "notifications_read_own" on notifications;
create policy "notifications_read_own"
  on notifications for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "notifications_mark_read_own" on notifications;
create policy "notifications_mark_read_own"
  on notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
