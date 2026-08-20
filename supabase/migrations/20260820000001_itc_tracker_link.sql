-- =============================================================================
-- ITC ↔ Tracker link
--   1. Bridge ITC identity to main-app users (itc_participants.user_id).
--   2. Link ITC maps to quarterly_goals (itc_maps.quarterly_goal_id).
--   3. Link ITC tests to missions (itc_tests.mission_id).
--   4. Add 'abandoned' to mission_status so a map-clear cascade can mark
--      planned missions abandoned without pretending they were missed.
--   5. Add 'itc' to mission_creator so the application-level concreteness
--      validator can bypass for ITC-authored missions (test descriptions
--      like "stay in the room during the next argument" don't fit the
--      CONCRETE_VERBS list; the ITC coach already validates the test via
--      SMART).
--   6. Update the weekly-cap trigger to exclude 'abandoned' from the count
--      so abandoning a planned mission frees the slot (matches the
--      "abandoned = never happened" semantics).
-- =============================================================================

--
-- 1. itc_participants ↔ users bridge. Nullable + unique — one user per
--    participant. Existing ITC-only participants remain unlinked until
--    the first tracker-touching action fires ensureUserForItcParticipant()
--    (server-side helper), which lazily creates a comped users row.
--
alter table itc_participants
  add column if not exists user_id uuid references users(id) on delete set null;

create unique index if not exists itc_participants_user_id_uniq
  on itc_participants (user_id)
  where user_id is not null;

--
-- 2. Map → quarterly_goal. Nullable — legacy maps predate this link, and
--    a fresh map is unlinked until the coachee saves their goal. On the
--    tracker side, deleting a quarterly_goal (which shouldn't happen —
--    goals are abandoned, not deleted) leaves the map link null.
--
alter table itc_maps
  add column if not exists quarterly_goal_id uuid references quarterly_goals(id) on delete set null;

create index if not exists itc_maps_quarterly_goal_idx
  on itc_maps (quarterly_goal_id)
  where quarterly_goal_id is not null;

--
-- 3. Test → mission. Nullable — Run the Test creates the mission and
--    stores its id here. On the tracker side, deleting a mission (again,
--    shouldn't happen normally) leaves the test link null; the ITC map
--    still has the test record.
--
alter table itc_tests
  add column if not exists mission_id uuid references missions(id) on delete set null;

create index if not exists itc_tests_mission_idx
  on itc_tests (mission_id)
  where mission_id is not null;

--
-- 4. Add 'abandoned' to mission_status. Used when an ITC map-clear
--    cascade wipes planned linked missions, and when the coachee
--    abandons an in-flight test whose mission was still 'planned'.
--
alter type mission_status add value if not exists 'abandoned';

--
-- 5. Add 'itc' to mission_creator. Used by the application-level
--    concreteness validator to bypass the CONCRETE_VERBS check for
--    ITC-authored test missions.
--
alter type mission_creator add value if not exists 'itc';

--
-- 6. Update weekly-cap trigger to exclude 'abandoned' from the count.
--    Abandoned = never happened = doesn't consume a slot. Same reasoning
--    that already excludes 'rolled_over'.
--
create or replace function public.enforce_mission_weekly_cap()
returns trigger
language plpgsql
as $$
declare
  week_start date;
  week_end   date;
  total      int;
  in_bucket  int;
begin
  week_start := date_trunc('week', new.target_date)::date;
  week_end   := week_start + 6;

  select count(*) into total
  from missions
  where user_id = new.user_id
    and target_date between week_start and week_end
    and id <> new.id
    and status not in ('rolled_over', 'abandoned');
  if total >= 15 then
    raise exception
      'Weekly mission cap reached (15) for user % week %', new.user_id, week_start;
  end if;

  select count(*) into in_bucket
  from missions
  where user_id = new.user_id
    and target_date between week_start and week_end
    and id <> new.id
    and status not in ('rolled_over', 'abandoned')
    and quarterly_goal_id is not distinct from new.quarterly_goal_id;
  if in_bucket >= 5 then
    if new.quarterly_goal_id is null then
      raise exception
        'Weekly cap of 5 unattached ("other") missions reached for user % week %',
        new.user_id, week_start;
    else
      raise exception
        'Weekly cap of 5 missions per goal reached (goal %) for user % week %',
        new.quarterly_goal_id, new.user_id, week_start;
    end if;
  end if;
  return new;
end;
$$;
