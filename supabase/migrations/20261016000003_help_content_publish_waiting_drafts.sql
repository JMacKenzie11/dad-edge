-- =============================================================================
-- Help publishes itself (DECISIONS.md "Help publishes itself", Jason,
-- 2026-10-16). There is no approval step any more: generated help is
-- live as soon as it passes the voice lint.
--
-- Publish the drafts that were waiting in the old review queue and
-- passed the lint. Drafts that failed it stay unpublished; the next
-- `help:generate` or nightly run replaces them with a draft that passes.
-- `reviewed` now means "published"; the help widget still serves on it.
-- =============================================================================

update public.help_content
set reviewed = true,
    reviewed_by = null,
    reviewed_at = now()
where reviewed = false
  and voice_lint_passed;

comment on column public.help_content.reviewed is
  'Published: only reviewed=true rows are served. Set on write when the draft passes the voice lint; no human approval step.';
