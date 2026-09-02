-- Score once, carry the verdict.
--
-- A coach draft was scored twice: once by the drafter to decide
-- whether to offer it, and again by the save action when the coachee
-- tapped "Use this draft". Same function, same inputs, but two
-- separate calls to a language model, so the two can disagree, and
-- every disagreement surfaces to the coachee as the coach
-- contradicting itself: a draft it offered, then a red box on the
-- same words the moment he accepts it. That is the exact failure the
-- shared-judge work has been removing everywhere else.
--
-- The verdict now travels with the draft. On accept, if the text is
-- byte-identical to the draft that was verified, the stored verdict
-- is reused instead of re-scoring. Any edit, however small, re-scores
-- as normal, because the verdict belongs to that exact text.
--
-- Immune to the three ways the two calls could differ: model skew
-- (the tiers are env-configured and can change), a deploy landing
-- between drafting and accepting, and ordinary non-determinism at
-- the margin. It is also one fewer model call on the accept path.
--
-- draft_depth_score  the 0-3 the drafter's verification produced
-- draft_rubric_reason the rubric's one-line reason for that score
--
-- Both null when no draft is pending, and cleared with the draft.

alter table itc_behaviors
  add column if not exists coach_worry_draft_depth_score smallint,
  add column if not exists coach_worry_draft_rubric_reason text;

alter table itc_assumption_drafts
  add column if not exists draft_depth_score smallint,
  add column if not exists draft_rubric_reason text;
