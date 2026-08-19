-- Reinstate the depth-scoring rubric columns dropped by
-- 20260818000003. That drop overreached: the Form-First rewrite
-- spec keeps rubric-gates-Continue for the depth stages (worries
-- and assumptions); dropping the columns silently removed the gate
-- and let a shallow worry like "I'm afraid of wasting time" pass
-- Continue with no excavation.
--
-- Form-First purity note: the coach does not write these values.
-- A deterministic server pipeline step (src/lib/itc/rubric.ts)
-- runs a dedicated LLM scoring call on every worry/assumption
-- save, stores the result here, and increments attempts. The
-- coach receives the score as prompt input for its prose and
-- never mentions it. Same class as the dedup step — the LLM
-- computes, the server writes.
--
-- attempts is a plain counter on the entry row. Every save/edit
-- of a worry (or assumption) increments this. Combined with
-- depth_score, the Continue gate reads:
--   pairing rules always AND (depth_score = 3 OR (depth_score = 2 AND attempts >= 2))
-- so a man who genuinely can't get to depth-3 wording gets through
-- after two honest attempts at depth-2, but a one-shot shallow
-- entry does not.

alter table itc_worries
  add column if not exists depth_score int
    check (depth_score is null or (depth_score >= 0 and depth_score <= 3)),
  add column if not exists attempts int not null default 0;

alter table itc_assumptions
  add column if not exists depth_score int
    check (depth_score is null or (depth_score >= 0 and depth_score <= 3)),
  add column if not exists attempts int not null default 0;
