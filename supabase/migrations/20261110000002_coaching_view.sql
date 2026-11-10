-- =============================================================================
-- Coaching view for admins and leaders (DECISIONS.md "Coaching view").
--
--   mission_goal_fit    the model's call on whether a goal-linked mission
--                       moves that goal forward. Seen only by admins and
--                       leaders on the Coaching pages, never by the man.
--                       input_hash covers the mission wording and the goal
--                       it's judged against, so an edit to either is judged
--                       again.
--   coaching_followups  "Reached out" log a leader or admin keeps about a
--                       man in one community, with an optional note.
--   coaching_digests    one row per person per week the Monday Coaching
--                       email went to, so a rerun doesn't send it twice.
--
-- All three have row-level security on and NO policies: no member,
-- leader or admin can touch them through a browser session. The server
-- reads and writes them with the service role, after the leader check on
-- the page or action (src/lib/coaching/access.ts). The man can't read his
-- own fit judgments or the notes about him.
-- =============================================================================

create table mission_goal_fit (
  mission_id   uuid primary key references missions(id) on delete cascade,
  goal_id      uuid not null references quarterly_goals(id) on delete cascade,
  verdict      text not null check (verdict in ('moves_it', 'related', 'no_link')),
  input_hash   text not null,
  model        text not null,
  judged_at    timestamptz not null default now()
);

create index mission_goal_fit_goal_idx on mission_goal_fit (goal_id);

create table coaching_followups (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references communities(id) on delete cascade,
  member_user_id  uuid not null references users(id) on delete cascade,
  author_user_id  uuid references users(id) on delete set null,
  note            text check (note is null or char_length(note) <= 2000),
  created_at      timestamptz not null default now()
);

create index coaching_followups_member_idx
  on coaching_followups (community_id, member_user_id, created_at desc);

create table coaching_digests (
  user_id     uuid not null references users(id) on delete cascade,
  week_start  date not null,
  sent_at     timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table mission_goal_fit enable row level security;
alter table coaching_followups enable row level security;
alter table coaching_digests enable row level security;
