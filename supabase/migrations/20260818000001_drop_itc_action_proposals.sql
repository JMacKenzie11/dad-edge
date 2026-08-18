-- Form-First Rewrite drops the proposal-card path. Cards were the
-- "coachee accepts what the coach proposed" surface; under form-first
-- the coachee writes every entry directly. No proposals, no accept
-- flow, no orphan rows to worry about.
--
-- Drop table (and its dependent index rows) via cascade.
drop table if exists itc_action_proposals cascade;
