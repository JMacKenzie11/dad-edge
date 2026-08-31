-- Hone-diagnostic staleness flag. Mirrors walkthrough_stale (see
-- 20260831000003) but for the whole-map hone audit banner.
--
-- Motivation: cross-column criteria checks (worry-commitment
-- redundancy, assumption drift/overload/coverage) only run inside
-- the hone waterfall, not on every save — they're LLM-backed and
-- multiply cost per save. That means after an entry edit, the
-- previously-rendered hone banner's findings can become stale
-- without the UI signaling anything.
--
-- Prior behavior deleted the hone_diagnostic message on any entry
-- write (invalidateReviewsForColumn wiped both column_review AND
-- hone_diagnostic). Silent — coachee lost their banner and had to
-- remember to re-run. New behavior: keep the message, flip a stale
-- flag so the banner renders in a "map has moved" state with an
-- emphasized RE-RUN AUDIT affordance.

alter table itc_maps
  add column if not exists hone_diagnostic_stale boolean not null default false;

-- Child-row edits: any insert/update/delete on a map column flags the
-- hone diagnostic as stale, unconditionally (the flag is a no-op when
-- there's no hone_diagnostic message; runHoneDiagnostic clears it on
-- next audit write).
create or replace function itc_mark_hone_diagnostic_stale() returns trigger
language plpgsql as $$
declare
  target_map_id uuid;
begin
  target_map_id := coalesce(new.map_id, old.map_id);
  update itc_maps
    set hone_diagnostic_stale = true
    where id = target_map_id
      and hone_diagnostic_stale = false;
  return coalesce(new, old);
end;
$$;

drop trigger if exists itc_behaviors_hone_diagnostic_stale on itc_behaviors;
create trigger itc_behaviors_hone_diagnostic_stale
  after insert or update or delete on itc_behaviors
  for each row execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_worries_hone_diagnostic_stale on itc_worries;
create trigger itc_worries_hone_diagnostic_stale
  after insert or update or delete on itc_worries
  for each row execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_commitments_hone_diagnostic_stale on itc_commitments;
create trigger itc_commitments_hone_diagnostic_stale
  after insert or update or delete on itc_commitments
  for each row execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_assumptions_hone_diagnostic_stale on itc_assumptions;
create trigger itc_assumptions_hone_diagnostic_stale
  after insert or update or delete on itc_assumptions
  for each row execute function itc_mark_hone_diagnostic_stale();

-- Link table: resolve map_id via assumption_id (same pattern as the
-- walkthrough_stale trigger).
create or replace function itc_links_mark_hone_diagnostic_stale() returns trigger
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
    set hone_diagnostic_stale = true
    where id = target_map_id
      and hone_diagnostic_stale = false;
  return coalesce(new, old);
end;
$$;

drop trigger if exists itc_assumption_commitments_hone_diagnostic_stale on itc_assumption_commitments;
create trigger itc_assumption_commitments_hone_diagnostic_stale
  after insert or update or delete on itc_assumption_commitments
  for each row execute function itc_links_mark_hone_diagnostic_stale();

-- Goal edits live on itc_maps.improvement_goal itself. Piggybacks on
-- the existing itc_maps_touch_self trigger as a separate BEFORE UPDATE
-- to avoid recursion (same reasoning as walkthrough_stale).
create or replace function itc_map_goal_mark_hone_diagnostic_stale() returns trigger
language plpgsql as $$
begin
  if new.hone_diagnostic_stale = false
     and new.improvement_goal is distinct from old.improvement_goal then
    new.hone_diagnostic_stale := true;
  end if;
  return new;
end;
$$;

drop trigger if exists itc_maps_goal_hone_diagnostic_stale on itc_maps;
create trigger itc_maps_goal_hone_diagnostic_stale
  before update on itc_maps
  for each row execute function itc_map_goal_mark_hone_diagnostic_stale();
