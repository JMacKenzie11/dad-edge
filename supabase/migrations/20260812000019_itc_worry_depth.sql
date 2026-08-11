-- ITC v2 Elevation, Checkpoint C: worry depth rubric + attempts log.
--
-- Reviewed session: coach accepted practical worries (wasting time, seeming
-- pushy) as if they were the visceral fears the guides call for. Cascade of
-- shallowness. Fix: every worry gets a server-side rubric score before it
-- can lock. Score < 2 cannot lock. Score 2 needs at least two attempts.
-- Score 3 locks immediately.
--
-- itc_worry_attempts tracks every propose_worry the coach sends so we can
-- count excavation passes per behavior without heuristics over transcript
-- messages.

alter table itc_worries
  add column depth_score smallint;

create table itc_worry_attempts (
  id           uuid primary key default gen_random_uuid(),
  map_id       uuid not null references itc_maps(id) on delete cascade,
  behavior_id  uuid not null references itc_behaviors(id) on delete cascade,
  text         text not null,
  depth_score  smallint,
  accepted     boolean not null default false,
  reject_reason text,
  created_at   timestamptz not null default now()
);
create index itc_worry_attempts_behavior_idx on itc_worry_attempts(behavior_id, created_at);

alter table itc_worry_attempts enable row level security;
