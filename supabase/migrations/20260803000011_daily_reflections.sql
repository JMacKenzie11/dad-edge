--
-- Daily reflections — two optional free-text fields per user per day.
-- Purpose: give the coach real material to work with. Not for the community.
--
-- Privacy: self-only, mirroring the family layer posture (§12.4). Coach reads
-- via the service role for context injection.
--
create table if not exists daily_reflections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  date                  date not null,
  wins                  text,
  learnings             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists daily_reflections_user_date_idx
  on daily_reflections (user_id, date desc);

alter table daily_reflections enable row level security;

drop policy if exists "reflections: self only" on daily_reflections;
create policy "reflections: self only"
  on daily_reflections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
