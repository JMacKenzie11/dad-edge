-- =============================================================================
-- Weekly summaries
--
-- Once per user per week, after the community grace period (week lock)
-- closes, an LLM generates a positively-framed, opportunity-oriented
-- recap of the prior week from that user's data (check-ins, missions,
-- reflections, streak, active goals). Rendered on /dashboard.
--
-- Generation is lazy: kicked off on first view of /dashboard once the
-- gate passes, streamed token-by-token for a typewriter feel, and
-- persisted on stream close so subsequent views just render.
--
-- Body is JSONB with a structured shape:
--   { highlight: string, what_worked: string, opportunity: string }
--
-- Structured so the UI can style sections independently (heading
-- treatments, per-section reveal animation), not one blob of text.
-- =============================================================================

create table if not exists weekly_summaries (
  user_id      uuid not null references users(id) on delete cascade,
  -- Monday (yyyy-MM-dd, UTC) of the week being summarized. Pairing
  -- (user_id, week_start) is the natural key — one summary per user
  -- per week.
  week_start   date not null,
  body         jsonb not null,
  model        text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Fast "does a summary exist for last week?" lookup — the /dashboard
-- gate query. Descending on week_start lands most recent first.
create index if not exists weekly_summaries_user_recent_idx
  on weekly_summaries (user_id, week_start desc);

-- ----------------------------------------------------------------------------
-- RLS: a user can read their own summaries. Writes happen server-side
-- via the streaming route using the service client — no user-facing
-- INSERT/UPDATE policy needed.
-- ----------------------------------------------------------------------------

alter table weekly_summaries enable row level security;

drop policy if exists "weekly_summaries_read_own" on weekly_summaries;
create policy "weekly_summaries_read_own"
  on weekly_summaries for select
  to authenticated
  using (user_id = auth.uid());
