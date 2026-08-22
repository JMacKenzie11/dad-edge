-- =============================================================================
-- ITC: one active map per participant
--
-- Design intent (confirmed 2026-08-28): a participant can have at most ONE
-- in-progress ITC map at a time. An ITC map is slow, intense work; running
-- three in parallel isn't realistic.
--
-- Prior state: the app-level guard in startNewMap only prevented a duplicate
-- in-progress map of the SAME pillar (`existingMaps.find(m => m.status ===
-- "in_progress" && m.pillar_code === input.pillar_code)`). The DB had no
-- unique constraint at all — just a non-unique index on
-- (participant_id, created_at desc). Coachees could start Bond + Amplify +
-- Raise all in parallel; the ITC admin page showed this happening.
--
-- Fix:
--   1. Cleanup: for any participant with multiple in-progress maps, keep
--      the most-recently-updated one active. Move the older ones to
--      status='complete'. History (behaviors, worries, commitments,
--      assumptions, tests, messages) stays intact — nothing cascades on
--      a status change.
--   2. Enforcement: unique partial index on (participant_id) filtered to
--      status='in_progress'. Postgres native, no trigger needed.
--
-- After this migration:
--   - The DB rejects any second in-progress row.
--   - startNewMap (updated in this same commit) redirects to the existing
--     in-progress map regardless of pillar, so the coachee sees a friendly
--     redirect instead of a DB error.
-- =============================================================================

-- 1. Cleanup: within each participant's in-progress set, keep the latest
--    updated_at as-is and mark the rest complete. Uses a window function
--    to rank per participant so this handles participants with 2, 3, or
--    more parallel maps uniformly.
with ranked as (
  select id,
         row_number() over (
           partition by participant_id
           order by updated_at desc, created_at desc, id
         ) as rn
  from itc_maps
  where status = 'in_progress'
)
update itc_maps
   set status = 'complete'
  from ranked
 where itc_maps.id = ranked.id
   and ranked.rn > 1;

-- 2. Unique partial index. Participants with a completed map + a new
--    in-progress map are unaffected (the constraint filters to in_progress).
create unique index if not exists itc_maps_one_active_per_participant
  on itc_maps (participant_id)
  where status = 'in_progress';
