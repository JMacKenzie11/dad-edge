-- Per-turn action proposals surfaced as UI cards.
--
-- Every state-changing action the coach wants to take on the map now
-- becomes a "proposal" the coachee explicitly accepts, edits, or
-- rejects via an inline UI card. Eliminates the "did that land?"
-- ambiguity that comes from inferring state changes from prose.
--
-- Populated by:
--   1. The coach's inline markers (e.g. <<lock_worry behavior=2>>text
--      <</lock_worry>>) — parsed server-side after the turn.
--   2. The extractor as a safety net if the coach forgot to emit a
--      marker but the reply clearly implies a state change.
--
-- Resolved by:
--   - acceptProposal: applies the underlying action via the existing
--     applyCoachAction path (rubric, dedup, stage guard all still fire).
--   - editAndAcceptProposal: same, with a coachee-edited payload.
--   - rejectProposal: marks rejected + appends a system message so the
--     coach knows on its next turn.
--
-- Stage-transition actions (advance_stage, mark_walkthrough_delivered)
-- do NOT become proposals — they apply immediately from the marker.
-- Users don't want to click a card to "advance to the next stage."

create table if not exists public.itc_action_proposals (
  id                    uuid primary key default gen_random_uuid(),
  map_id                uuid not null references public.itc_maps(id) on delete cascade,
  assistant_message_id  uuid not null references public.itc_messages(id) on delete cascade,
  -- Which CoachAction variant this represents. Kept as text (not enum)
  -- so we can add proposal types without a migration each time; the
  -- app-side CoachActionSchema is the source of truth.
  action_type           text not null,
  -- The full CoachAction payload the extractor / marker produced.
  -- Applied through applyCoachAction on accept.
  payload               jsonb not null,
  -- Present only when the coachee edited before locking. Applied
  -- instead of `payload` in that case. NULL otherwise.
  edited_payload        jsonb,
  status                text not null default 'pending'
    check (status in ('pending', 'locked', 'edited_locked', 'rejected', 'stale')),
  -- Source of the proposal: 'marker' (coach emitted an inline tag) or
  -- 'extractor' (safety-net LLM inferred it). Diagnostic — helps track
  -- which path is doing the work.
  source                text not null default 'marker'
    check (source in ('marker', 'extractor')),
  -- Free-text reason on rejection. Optional.
  reject_reason         text,
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

-- All proposals for one map, newest first (used by the page render).
create index if not exists itc_action_proposals_map_created_idx
  on public.itc_action_proposals (map_id, created_at desc);

-- Proposals attached to a specific assistant message (used by
-- conversation.tsx to render cards inline).
create index if not exists itc_action_proposals_message_idx
  on public.itc_action_proposals (assistant_message_id, created_at asc);

-- Cross-map "still pending" filter for cleanup / stale detection.
create index if not exists itc_action_proposals_pending_idx
  on public.itc_action_proposals (status, created_at)
  where status = 'pending';

alter table public.itc_action_proposals enable row level security;
