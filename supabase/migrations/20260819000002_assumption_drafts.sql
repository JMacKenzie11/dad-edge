-- Coach-drafted Big Assumptions with many-to-many commitment coverage,
-- shown as suggestion cards in the Column 5 UI before the coachee
-- authors any assumption of their own.
--
-- Mirror of the C-α commitment-draft flow (itc_worries.coach_commitment_draft),
-- but assumptions are many-to-many with commitments — one Big Assumption
-- typically underwrites several competing commitments — so a single-column
-- fk on itc_commitments won't do. Two tables:
--
--   itc_assumption_drafts             — the draft text
--   itc_assumption_draft_commitments  — which commitments each draft covers
--
-- Form-First-pure: these are METADATA (the coach's suggestions). The
-- authoritative assumption.text lives in itc_assumptions and is only
-- written when the user explicitly acts on a draft (Use this draft →
-- server writes itc_assumptions row + copies coverage links + deletes
-- the draft) or types their own from scratch.

create table itc_assumption_drafts (
  id         uuid primary key default gen_random_uuid(),
  map_id     uuid not null references itc_maps(id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now()
);
create index itc_assumption_drafts_map_idx on itc_assumption_drafts(map_id);

create table itc_assumption_draft_commitments (
  draft_id      uuid not null references itc_assumption_drafts(id) on delete cascade,
  commitment_id uuid not null references itc_commitments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (draft_id, commitment_id)
);
create index itc_assumption_draft_commitments_c_idx
  on itc_assumption_draft_commitments(commitment_id);

alter table itc_assumption_drafts enable row level security;
alter table itc_assumption_draft_commitments enable row level security;
