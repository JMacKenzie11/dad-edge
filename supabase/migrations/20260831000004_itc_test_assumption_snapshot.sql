-- Test-assumption snapshot + supersede status.
--
-- 1. Snapshot the assumption text at test-design time in a new column
--    assumption_text_at_design. Never mutates after the test row is
--    written; lets the results view flag drift when the coachee has
--    since sharpened the assumption.
--
-- 2. Add "superseded" to the itc_test_status enum so the coachee can
--    retire a test whose assumption has drifted and design a fresh one
--    against the current text.

alter table itc_tests
  add column if not exists assumption_text_at_design text;

alter type itc_test_status add value if not exists 'superseded';
