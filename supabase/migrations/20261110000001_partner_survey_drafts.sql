-- =============================================================================
-- Partner Connection Survey: save as he goes, finish later
-- (DECISIONS.md "Partner survey saves every answer").
--
--   - partner_surveys.completed_at: null while the survey is in progress,
--     set when he finishes. Every survey already on record is finished, so it
--     takes its taken_at.
--   - The column defaults to now(), so a plain insert (the code before this
--     change) still creates a finished survey. Only the draft path inserts
--     completed_at = null on purpose. This keeps the old deploy correct if the
--     migration lands before the new code.
--   - One survey in progress per member, enforced by a partial unique index.
--   - A draft answer can have a note before it has a score, so score becomes
--     nullable. The 1-5 check still applies to any score that is set; the
--     finish action refuses unless every question has a score and a note.
--
-- Access rules don't change: both tables stay self-only.
-- =============================================================================

alter table partner_surveys add column completed_at timestamptz;

update partner_surveys set completed_at = taken_at where completed_at is null;

alter table partner_surveys alter column completed_at set default now();

create unique index partner_surveys_one_draft_per_user
  on partner_surveys (user_id)
  where completed_at is null;

alter table partner_survey_responses alter column score drop not null;
