-- Adds "column_review" to the itc_message_surface check constraint so
-- the coach's end-of-column set-review can be persisted as a distinct
-- surface. Renders inline at the bottom of the completed column above
-- the Continue button (see ColumnReview component in map-canvas.tsx).
--
-- Purpose (from the spec): tighten the map-build so shallow / bundled /
-- redundant entries get flagged BEFORE the coachee advances to the
-- next column, rather than surfacing only later in a hone-mode audit.
--
-- Safe additive change: existing surface values unchanged, new value
-- added to the check. Prior itc_messages rows with older surface
-- values (stage_note, entry_thread, focus, dock) are untouched.

alter table itc_messages
  drop constraint if exists itc_messages_surface_check;

alter table itc_messages
  add constraint itc_messages_surface_check
  check (surface in ('stage_note', 'entry_thread', 'focus', 'dock', 'column_review'));
