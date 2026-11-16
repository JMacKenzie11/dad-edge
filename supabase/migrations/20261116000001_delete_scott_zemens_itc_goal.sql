-- Jason, 2026-11-16: delete Scott Zemens's leftover ITC goal from Q3 2026
-- ("...running my business in an organized, proactive way..."), still
-- waiting on its quarter review. Nothing else points at it: no missions,
-- no fit judgments. His ITC map stays; its link to the goal goes null
-- (itc_maps.quarterly_goal_id on delete set null).
--
-- Matched on id, owner and source together, so it can only ever remove
-- that one row. A no-op on any database that doesn't have it (dev).
delete from public.quarterly_goals
where id = '4df01dac-c5ab-46c0-b35d-a20fba697d0b'
  and user_id = '0035dd46-1787-4bea-a5b9-6056aa907507'
  and source = 'itc';
