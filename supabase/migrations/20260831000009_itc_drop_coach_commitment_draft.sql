-- Drop coach_commitment_draft — the drafts-and-accept workflow for
-- competing commitments is gone.
--
-- New model: commitments auto-derive directly from worries on advance
-- to Column 4 and on any worry edit thereafter. The derived text
-- writes straight to itc_commitments.text (via upsertCommitmentForWorry
-- + the standard scoreCommitmentDepth pipeline). No "Use this draft"
-- card, no accept step — the commitment is real from the moment the
-- worry lands. Coachees still edit the commitment inline; that path
-- is unchanged.
--
-- Column added in migration 20260819000001_commitment_drafts.sql,
-- retired here.
alter table itc_worries
  drop column if exists coach_commitment_draft;
