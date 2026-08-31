-- Guard assumption deletion when tests exist. Previously
-- itc_tests.assumption_id had ON DELETE CASCADE, which silently wiped
-- test history whenever a coachee removed an assumption. That's the
-- wrong default — a test IS design evidence about the assumption; if
-- the assumption goes away, the coachee should have to explicitly
-- abandon or supersede the tests first, or edit the assumption instead
-- of deleting it.

alter table itc_tests
  drop constraint if exists itc_tests_assumption_id_fkey;

alter table itc_tests
  add constraint itc_tests_assumption_id_fkey
  foreign key (assumption_id)
  references itc_assumptions(id)
  on delete restrict;
