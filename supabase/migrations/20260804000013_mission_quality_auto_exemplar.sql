--
-- Auto-exemplar plumbing.
--
--   quality_score: 0-10 rubric total at creation. Math: with 5 criteria capped
--     at 2 each, a total >= 9 requires every criterion to be > 0 — so a single
--     scalar check is sufficient to guarantee "no zero-scored criterion".
--
--   exemplar_text: anonymized version of description (proper nouns stripped)
--     used when this mission is shown to other men. NULL until promoted.
--     Read path prefers exemplar_text over description.
--
--   exemplar_last_review_at: last time the weekly novelty scan looked at this
--     row. Lets the job skip rows it just reviewed.
--
alter table missions
  add column if not exists quality_score smallint check (quality_score between 0 and 10),
  add column if not exists exemplar_text text,
  add column if not exists exemplar_last_review_at timestamptz;
