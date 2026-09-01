-- Coach text on honed rows: one rendered "what's off" block plus one
-- verified rewrite, written together so every surface (row box,
-- column review, hone banner) reads the same thing.
--
--   rubric_reason  — RESTORED to its original meaning: the depth
--                    rubric's raw one-line reason. Null when depth
--                    passed. (Since 2026-08-31 it had been carrying a
--                    " · "-joined composite of reason + advice, which
--                    the hone auditor then re-read as if it were the
--                    raw reason.)
--   sharpen_text   — the coach's rendered lines for the row, from the
--                    criteria module's findings. Shown verbatim.
--   suggested_fix  — a rewrite the drafters produced AND verified
--                    against the same checks. Null when none cleared.
--
-- Also retargets the staleness triggers so writing coach text onto a
-- row does not (a) flag the hone audit that just wrote it as stale,
-- (b) flag the walkthrough as stale, or (c) bump updated_at and
-- trigger the "upstream moved, re-derive?" nudge downstream. Only a
-- change to the coachee's own content (text, selection, links) means
-- the map moved.

alter table itc_worries
  add column if not exists sharpen_text text,
  add column if not exists suggested_fix text;

alter table itc_commitments
  add column if not exists sharpen_text text,
  add column if not exists suggested_fix text;

alter table itc_assumptions
  add column if not exists sharpen_text text,
  add column if not exists suggested_fix text;

-- Backfill: keep showing the old composite text in the box until the
-- next save or audit rewrites it, and split the raw reason back out.
update itc_worries
  set sharpen_text = rubric_reason,
      rubric_reason = case
        when depth_score is not null and depth_score >= 3 then null
        else split_part(rubric_reason, ' · ', 1)
      end
  where rubric_reason is not null;

update itc_commitments
  set sharpen_text = rubric_reason,
      rubric_reason = case
        when depth_score is not null and depth_score >= 3 then null
        else split_part(rubric_reason, ' · ', 1)
      end
  where rubric_reason is not null;

update itc_assumptions
  set sharpen_text = rubric_reason,
      rubric_reason = case
        when depth_score is not null and depth_score >= 3 then null
        else split_part(rubric_reason, ' · ', 1)
      end
  where rubric_reason is not null;

-- ---------------------------------------------------------------------
-- Staleness triggers: fire on content changes only.
--
-- Self-contained: the columns and trigger functions from
-- 20260831000002 / 000003 / 000007 are (re)declared here with
-- `if not exists` / `create or replace`, so this migration applies
-- cleanly whether or not those three ran on the target database.
-- ---------------------------------------------------------------------

alter table itc_worries
  add column if not exists updated_at timestamptz not null default now();
alter table itc_commitments
  add column if not exists updated_at timestamptz not null default now();
alter table itc_assumptions
  add column if not exists updated_at timestamptz not null default now();

alter table itc_maps
  add column if not exists walkthrough_delivered boolean not null default false,
  add column if not exists walkthrough_stale boolean not null default false,
  add column if not exists hone_diagnostic_stale boolean not null default false;

create or replace function itc_touch_row_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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

-- Link-table and goal triggers (unchanged in behavior; declared here
-- so a database that skipped the 0831 migrations gets them too).
drop trigger if exists itc_assumption_commitments_walkthrough_stale on itc_assumption_commitments;
create trigger itc_assumption_commitments_walkthrough_stale
  after insert or update or delete on itc_assumption_commitments
  for each row execute function itc_links_mark_walkthrough_stale();

drop trigger if exists itc_maps_goal_walkthrough_stale on itc_maps;
create trigger itc_maps_goal_walkthrough_stale
  before update on itc_maps
  for each row execute function itc_map_goal_mark_walkthrough_stale();

drop trigger if exists itc_assumption_commitments_hone_diagnostic_stale on itc_assumption_commitments;
create trigger itc_assumption_commitments_hone_diagnostic_stale
  after insert or update or delete on itc_assumption_commitments
  for each row execute function itc_links_mark_hone_diagnostic_stale();

drop trigger if exists itc_maps_goal_hone_diagnostic_stale on itc_maps;
create trigger itc_maps_goal_hone_diagnostic_stale
  before update on itc_maps
  for each row execute function itc_map_goal_mark_hone_diagnostic_stale();

-- updated_at bump: only when the coachee's text moves.
drop trigger if exists itc_worries_touch_updated_at on itc_worries;
create trigger itc_worries_touch_updated_at
  before update on itc_worries
  for each row
  when (old.text is distinct from new.text)
  execute function itc_touch_row_updated_at();

drop trigger if exists itc_commitments_touch_updated_at on itc_commitments;
create trigger itc_commitments_touch_updated_at
  before update on itc_commitments
  for each row
  when (old.text is distinct from new.text)
  execute function itc_touch_row_updated_at();

drop trigger if exists itc_assumptions_touch_updated_at on itc_assumptions;
create trigger itc_assumptions_touch_updated_at
  before update on itc_assumptions
  for each row
  when (old.text is distinct from new.text)
  execute function itc_touch_row_updated_at();

-- walkthrough_stale (20260831000003): inserts/deletes unconditional,
-- updates only on content.
drop trigger if exists itc_behaviors_walkthrough_stale on itc_behaviors;
create trigger itc_behaviors_walkthrough_stale
  after insert or delete on itc_behaviors
  for each row execute function itc_mark_walkthrough_stale();
drop trigger if exists itc_behaviors_walkthrough_stale_upd on itc_behaviors;
create trigger itc_behaviors_walkthrough_stale_upd
  after update on itc_behaviors
  for each row
  when (old.text is distinct from new.text or old.selected is distinct from new.selected)
  execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_worries_walkthrough_stale on itc_worries;
create trigger itc_worries_walkthrough_stale
  after insert or delete on itc_worries
  for each row execute function itc_mark_walkthrough_stale();
drop trigger if exists itc_worries_walkthrough_stale_upd on itc_worries;
create trigger itc_worries_walkthrough_stale_upd
  after update on itc_worries
  for each row
  when (old.text is distinct from new.text)
  execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_commitments_walkthrough_stale on itc_commitments;
create trigger itc_commitments_walkthrough_stale
  after insert or delete on itc_commitments
  for each row execute function itc_mark_walkthrough_stale();
drop trigger if exists itc_commitments_walkthrough_stale_upd on itc_commitments;
create trigger itc_commitments_walkthrough_stale_upd
  after update on itc_commitments
  for each row
  when (old.text is distinct from new.text)
  execute function itc_mark_walkthrough_stale();

drop trigger if exists itc_assumptions_walkthrough_stale on itc_assumptions;
create trigger itc_assumptions_walkthrough_stale
  after insert or delete on itc_assumptions
  for each row execute function itc_mark_walkthrough_stale();
drop trigger if exists itc_assumptions_walkthrough_stale_upd on itc_assumptions;
create trigger itc_assumptions_walkthrough_stale_upd
  after update on itc_assumptions
  for each row
  when (old.text is distinct from new.text or old.selected_for_testing is distinct from new.selected_for_testing)
  execute function itc_mark_walkthrough_stale();

-- hone_diagnostic_stale (20260831000007): same split.
drop trigger if exists itc_behaviors_hone_diagnostic_stale on itc_behaviors;
create trigger itc_behaviors_hone_diagnostic_stale
  after insert or delete on itc_behaviors
  for each row execute function itc_mark_hone_diagnostic_stale();
drop trigger if exists itc_behaviors_hone_diagnostic_stale_upd on itc_behaviors;
create trigger itc_behaviors_hone_diagnostic_stale_upd
  after update on itc_behaviors
  for each row
  when (old.text is distinct from new.text or old.selected is distinct from new.selected)
  execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_worries_hone_diagnostic_stale on itc_worries;
create trigger itc_worries_hone_diagnostic_stale
  after insert or delete on itc_worries
  for each row execute function itc_mark_hone_diagnostic_stale();
drop trigger if exists itc_worries_hone_diagnostic_stale_upd on itc_worries;
create trigger itc_worries_hone_diagnostic_stale_upd
  after update on itc_worries
  for each row
  when (old.text is distinct from new.text)
  execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_commitments_hone_diagnostic_stale on itc_commitments;
create trigger itc_commitments_hone_diagnostic_stale
  after insert or delete on itc_commitments
  for each row execute function itc_mark_hone_diagnostic_stale();
drop trigger if exists itc_commitments_hone_diagnostic_stale_upd on itc_commitments;
create trigger itc_commitments_hone_diagnostic_stale_upd
  after update on itc_commitments
  for each row
  when (old.text is distinct from new.text)
  execute function itc_mark_hone_diagnostic_stale();

drop trigger if exists itc_assumptions_hone_diagnostic_stale on itc_assumptions;
create trigger itc_assumptions_hone_diagnostic_stale
  after insert or delete on itc_assumptions
  for each row execute function itc_mark_hone_diagnostic_stale();
drop trigger if exists itc_assumptions_hone_diagnostic_stale_upd on itc_assumptions;
create trigger itc_assumptions_hone_diagnostic_stale_upd
  after update on itc_assumptions
  for each row
  when (old.text is distinct from new.text)
  execute function itc_mark_hone_diagnostic_stale();
