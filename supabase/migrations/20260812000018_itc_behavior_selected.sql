-- ITC v2 Elevation, Checkpoint B: pruning the behavior list.
--
-- Prior to worries, the coach leads a pruning pass down to the 4–5 most
-- impactful behaviors. Pruned behaviors are parked (kept for context), not
-- deleted, so the man doesn't lose the fuller picture. `selected` gates the
-- worries→commitments 1:1 check (only selected behaviors require a worry).

alter table itc_behaviors
  add column selected boolean not null default true;

-- Fast filter for selected behaviors when checking the 1:1 worry gate.
create index itc_behaviors_selected_idx on itc_behaviors(map_id, selected);
