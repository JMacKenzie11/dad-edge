-- ITC v2 Elevation, Checkpoint D: columns 3–4, prioritization, test design.

-- 3.3b: brief gas-and-brake reveal at column 3 delivery. Track separately
-- from the deeper immune-system walkthrough stage that comes later.
alter table itc_maps
  add column reveal_delivered boolean not null default false;

-- Column 4 depth: same rubric shape as worries. Finished-then, first-person,
-- lands in identity/big-time-bad territory.
alter table itc_assumptions
  add column depth_score smallint;

-- Assumption ↔ commitment fan-out. One foundational assumption typically
-- underwrites several competing commitments; the join table records which
-- commitments a given assumption covers so the map panel can render the
-- consolidation visually.
create table itc_assumption_commitments (
  assumption_id uuid not null references itc_assumptions(id) on delete cascade,
  commitment_id uuid not null references itc_commitments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (assumption_id, commitment_id)
);
create index itc_assumption_commitments_a_idx on itc_assumption_commitments(assumption_id);
create index itc_assumption_commitments_c_idx on itc_assumption_commitments(commitment_id);

alter table itc_assumption_commitments enable row level security;
