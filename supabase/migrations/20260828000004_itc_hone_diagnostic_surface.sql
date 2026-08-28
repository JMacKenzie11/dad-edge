-- Adds "hone_diagnostic" to the itc_message_surface check constraint
-- so the coach's whole-map audit — delivered on demand via the "Hone
-- this map" button on the canvas — can be persisted as a distinct
-- surface with its own render treatment (banner at the top of the
-- canvas) and its own invalidation semantics (wiped by any entry
-- write anywhere on the map, so re-clicking regenerates against
-- current state).
--
-- Additive change: existing surface values unchanged, new value
-- added to the check.

alter table itc_messages
  drop constraint if exists itc_messages_surface_check;

alter table itc_messages
  add constraint itc_messages_surface_check
  check (
    surface in (
      'stage_note',
      'entry_thread',
      'focus',
      'dock',
      'column_review',
      'hone_diagnostic'
    )
  );
