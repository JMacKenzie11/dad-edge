-- ITC v2 Elevation: immune-system walkthrough stage.
--
-- New stage `immune_system` slots between `review` and `prioritize`. The
-- brief gas-and-brake reveal fires during column 3 delivery (reveal_delivered).
-- This later stage is the full three-movement walkthrough: the loop run
-- forward on a concrete pressure moment, the system seen whole, the hinge to
-- testing. Prioritize is gated on it.
--
-- current_stage is a plain text column (per the original migration) so this
-- is purely an app-layer stage-machine change on the DB side; only the flag
-- ships as new schema.

alter table itc_maps
  add column walkthrough_delivered boolean not null default false;
