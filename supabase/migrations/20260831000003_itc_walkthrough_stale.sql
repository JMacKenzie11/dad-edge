-- Walkthrough staleness flag. Once the immune-system walkthrough has
-- been delivered, any subsequent edit to the map's goal / behaviors /
-- worries / commitments / assumptions / assumption-commitment links
-- means the persuasion is quoting a version of the map that no longer
-- exists. Flip walkthrough_stale=true on those edits so the UI can
-- surface a "regenerate" nudge without silently rewriting.

alter table itc_maps
  add column if not exists walkthrough_stale boolean not null default false;

-- Child-row edits: only mark stale if the walkthrough is already
-- delivered on the parent map. Otherwise no signal to invalidate.
create or replace function itc_mark_walkthrough_stale() returns trigger
language plpgsql as $$
declare
  target_map_id uuid;
begin
  target_map_id := coalesce(new.map_id, old.map_id);
  update itc_maps
    set walkthrough_stale = true
    where id = target_map_id
      and walkthrough_delivered = true
      and walkthrough_stale = false;
  return coalesce(new, old);
end;
$$;

drop trigger if exists itc_behaviors_walkthrough_stale on itc_behaviors;
create trigger itc_behaviors_walkthrough_stale
  after insert or update or delete on itc_behaviors
  for each row execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_worries_walkthrough_stale on itc_worries;
create trigger itc_worries_walkthrough_stale
  after insert or update or delete on itc_worries
  for each row execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_commitments_walkthrough_stale on itc_commitments;
create trigger itc_commitments_walkthrough_stale
  after insert or update or delete on itc_commitments
  for each row execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_assumptions_walkthrough_stale on itc_assumptions;
create trigger itc_assumptions_walkthrough_stale
  after insert or update or delete on itc_assumptions
  for each row execute function itc_mark_walkthrough_stale();

-- Assumption-commitment link table: no map_id column. Resolve it via
-- assumption_id → itc_assumptions.map_id (works for INSERT/UPDATE via
-- NEW, DELETE via OLD).
create or replace function itc_links_mark_walkthrough_stale() returns trigger
language plpgsql as $$
declare
  target_map_id uuid;
  source_assumption uuid;
begin
  source_assumption := coalesce(new.assumption_id, old.assumption_id);
  select map_id into target_map_id from itc_assumptions where id = source_assumption;
  if target_map_id is null then
    return coalesce(new, old);
  end if;
  update itc_maps
    set walkthrough_stale = true
    where id = target_map_id
      and walkthrough_delivered = true
      and walkthrough_stale = false;
  return coalesce(new, old);
end;
$$;

drop trigger if exists itc_assumption_commitments_walkthrough_stale on itc_assumption_commitments;
create trigger itc_assumption_commitments_walkthrough_stale
  after insert or update or delete on itc_assumption_commitments
  for each row execute function itc_links_mark_walkthrough_stale();

-- Goal edits live on itc_maps.improvement_goal itself. Only mark stale
-- when the goal actually changes AND the walkthrough is already
-- delivered. Piggybacks on the existing itc_maps_touch_self trigger
-- as a separate BEFORE UPDATE to avoid recursion.
create or replace function itc_map_goal_mark_walkthrough_stale() returns trigger
language plpgsql as $$
begin
  if new.walkthrough_delivered = true
     and new.walkthrough_stale = false
     and new.improvement_goal is distinct from old.improvement_goal then
    new.walkthrough_stale := true;
  end if;
  return new;
end;
$$;

drop trigger if exists itc_maps_goal_walkthrough_stale on itc_maps;
create trigger itc_maps_goal_walkthrough_stale
  before update on itc_maps
  for each row execute function itc_map_goal_mark_walkthrough_stale();
