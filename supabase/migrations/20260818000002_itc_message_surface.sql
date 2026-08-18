-- Amendment: coach output moves inline. Adds two columns to
-- itc_messages so the client can render each message in the right
-- surface (stage note, entry thread, focus mode, dock) and anchor
-- entry-thread messages to the specific row they concern.
--
-- surface tells the client where to render:
--   stage_note   — pinned coach framing at the top of the active section
--   entry_thread — inline thread under a specific entry row
--   focus        — set-piece full-screen surfaces (walkthrough, review, etc.)
--   dock         — the "Ask the coach" drawer
--   NULL         — legacy / system message not rendered as chat
--
-- entry_ref_table + entry_ref_id form a polymorphic pointer to the
-- entry a thread message is anchored to. Table name is one of
-- itc_behaviors, itc_worries, itc_commitments, itc_assumptions,
-- itc_tests. NULL when the message isn't entry-anchored (stage note,
-- dock, focus). No FK because polymorphic; app-side enforcement.

alter table itc_messages
  add column if not exists surface text
    check (surface in ('stage_note', 'entry_thread', 'focus', 'dock')),
  add column if not exists entry_ref_table text
    check (entry_ref_table in (
      'itc_behaviors',
      'itc_worries',
      'itc_commitments',
      'itc_assumptions',
      'itc_tests',
      'itc_maps'
    )),
  add column if not exists entry_ref_id uuid;

-- Index for fetching a specific entry's thread quickly.
create index if not exists itc_messages_entry_ref_idx
  on itc_messages (map_id, entry_ref_table, entry_ref_id, created_at)
  where entry_ref_id is not null;

-- Index for fetching everything on a stage at render time.
create index if not exists itc_messages_stage_surface_idx
  on itc_messages (map_id, stage_at_creation, surface, created_at);
