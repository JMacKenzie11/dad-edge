-- Add updated_at + bump trigger to itc_worries, itc_commitments,
-- itc_assumptions so the UI can detect a downstream row whose upstream
-- has moved since the downstream was written. Enables the post-edit
-- "worry changed since you wrote this — re-derive?" nudge.

alter table itc_worries
  add column if not exists updated_at timestamptz not null default now();

alter table itc_commitments
  add column if not exists updated_at timestamptz not null default now();

alter table itc_assumptions
  add column if not exists updated_at timestamptz not null default now();

create or replace function itc_touch_row_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists itc_worries_touch_updated_at on itc_worries;
create trigger itc_worries_touch_updated_at
  before update on itc_worries
  for each row execute function itc_touch_row_updated_at();

drop trigger if exists itc_commitments_touch_updated_at on itc_commitments;
create trigger itc_commitments_touch_updated_at
  before update on itc_commitments
  for each row execute function itc_touch_row_updated_at();

drop trigger if exists itc_assumptions_touch_updated_at on itc_assumptions;
create trigger itc_assumptions_touch_updated_at
  before update on itc_assumptions
  for each row execute function itc_touch_row_updated_at();
