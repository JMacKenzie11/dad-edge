-- Fix: the itc_maps_touch_self trigger references new.map_id, but itc_maps
-- itself has `id` (not map_id). Every UPDATE on itc_maps has been failing
-- with `record "new" has no field "map_id"` since the original migration.
-- Only surfaced now because updates to itc_maps (saving improvement_goal,
-- advancing stage, etc.) go through server actions that swallow the error.
--
-- Correct behaviour for the parent-table trigger: just touch this row's
-- updated_at. The multi-table version stays available for child-table
-- triggers that reference new.map_id.

create or replace function itc_touch_own_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists itc_maps_touch_self on itc_maps;

create trigger itc_maps_touch_self
  before update on itc_maps
  for each row execute function itc_touch_own_updated_at();
