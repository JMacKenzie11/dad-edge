-- Extend the rubric-gated excavation loop to Column 4 (competing
-- commitments). Same shape as worries: server pipeline scores every
-- save (deterministic, not coach), stores 0-3 on the row, increments
-- attempts. Continue advances when every commitment passes at 3/3 or
-- 2/3 with attempts >= 2. See DECISIONS.md "ITC Form-First Layout
-- Amendment — Checkpoint C" for the pattern.

alter table itc_commitments
  add column if not exists depth_score int
    check (depth_score is null or (depth_score >= 0 and depth_score <= 3)),
  add column if not exists attempts int not null default 0;
