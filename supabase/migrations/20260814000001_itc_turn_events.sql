-- Per-turn diagnostic event log for the ITC coach.
--
-- Vercel Runtime Logs drop most of the console.warn output we emit
-- (~10% survives on the free tier). That makes it impossible to
-- diagnose a slow or wrong turn after the fact — the [action rejected]
-- messages we already surface in itc_messages tell us "something
-- broke" but not WHY, and the timing lines we scattered through the
-- code never make it out of the sandbox.
--
-- This table captures every event we care about with enough structure
-- to reconstruct a full turn: prefetch DB timing, per-LLM-attempt
-- timing + outcome, rubric calls with scores, action-apply results,
-- action-rejected reasons, reconciliation output, backstop fires, and
-- the turn-summary line. All events for one turn share a turn_id so
-- you can select * from itc_turn_events where turn_id = '...' to see
-- the whole picture ordered by created_at.
--
-- Writes go through the service role from server actions only. Table
-- has RLS enabled with no policies — anon clients cannot read or
-- write. Query it via Supabase Studio SQL editor when debugging.
--
-- Retention is not enforced here; add a scheduled cleanup later if
-- volume becomes a problem (~10 events per turn * ~30 turns per map *
-- N maps).

create table if not exists public.itc_turn_events (
  id           uuid primary key default gen_random_uuid(),
  map_id       uuid not null references public.itc_maps(id) on delete cascade,
  turn_id      uuid not null,
  -- 0-based ordinal of this turn within the map (i.e. number of prior
  -- user+assistant message pairs). Redundant with turn_id but makes
  -- 'find the 7th turn on map X' trivial.
  turn_index   int not null,
  event_type   text not null,
  -- Snapshot of current_stage at the moment the event fired. Useful
  -- for filtering to 'all rubric calls that ran at the assumptions
  -- stage' etc.
  stage        text,
  -- Nullable — set only for timing events (llm_attempt, rubric,
  -- prefetch, reconcile, turn_summary). Backstop-fire / action-apply
  -- rows leave this null.
  duration_ms  int,
  -- Event-specific structured payload. Schema per event_type:
  --   prefetch:       { msgs }
  --   llm_attempt:    { attempt, outcome, action_types[] }
  --   rubric:         { kind, score, passed }
  --   action_apply:   { action_type, applied, reason? }
  --   action_rejected:{ action_type, error }
  --   reconcile:      { emitted_actions[], applied_count }
  --   backstop_fire:  { name, note }
  --   turn_summary:   { prefetch_ms, llm_ms, cascade_ms, reconcile_ms,
  --                     reconcile_applied, other_ms, total_ms,
  --                     stage_from, stage_to, actions[] }
  --   error:          { where, message }
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Latest events for a specific map, newest-first.
create index if not exists itc_turn_events_map_created_idx
  on public.itc_turn_events (map_id, created_at desc);

-- Reconstruct one turn in emission order.
create index if not exists itc_turn_events_turn_idx
  on public.itc_turn_events (turn_id, created_at asc);

-- Filter by event type across all maps (e.g. all action_rejected
-- events in the last day).
create index if not exists itc_turn_events_type_created_idx
  on public.itc_turn_events (event_type, created_at desc);

alter table public.itc_turn_events enable row level security;
