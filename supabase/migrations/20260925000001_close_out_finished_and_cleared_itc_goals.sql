-- Two gaps in how ITC maps closed their linked quarterly goal, both
-- fixed in code alongside this migration. Backfill the rows they left.
--
-- 1. Finishing a map (advance to Done) never marked the map complete
--    or touched its goal. The map stayed 'in_progress' (blocking a new
--    map) and the goal kept a "close out the map" wrap-up prompt.
update public.quarterly_goals g
set status = 'completed'
from public.itc_maps m
where m.quarterly_goal_id = g.id
  and m.current_stage = 'done'
  and g.status in ('active', 'needs_review');

update public.itc_maps
set status = 'complete'
where current_stage = 'done'
  and status = 'in_progress';

-- 2. Clearing a map abandoned its goal only while 'active'. Goals
--    already flipped to 'needs_review' were skipped, leaving a wrap-up
--    prompt pointing at a map that no longer exists.
update public.quarterly_goals g
set status = 'abandoned'
where g.source = 'itc'
  and g.status in ('active', 'needs_review')
  and not exists (
    select 1 from public.itc_maps m where m.quarterly_goal_id = g.id
  );
