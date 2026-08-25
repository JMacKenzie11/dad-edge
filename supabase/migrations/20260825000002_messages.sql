-- =============================================================================
-- Messages — 1:1 direct messaging between men in the same community
--
-- Design decisions (Jason 2026-08-25):
--   - 1-on-1 only. No group chats, ever.
--   - Text only. No attachments, ever.
--   - Coach never sees message contents.
--   - Any signed-in member can message any other signed-in member
--     (no per-user opt-out in v1 — add later if a user asks).
--   - Emoji reactions supported (👍 ❤️ 💪 style, one per user per message).
--   - No read receipts surfaced in UI, but read_at IS tracked server-side
--     for unread-count purposes.
--   - Realtime enabled on messages + reactions so the inbox + open
--     thread + header badge update instantly across tabs / devices.
--
-- Thread uniqueness: one thread per pair of users, regardless of who
-- opened it. Enforced by storing the pair in canonical order
-- (participant_a < participant_b as text uuids) + unique constraint.
-- Application code must sort the two ids before insert; a CHECK
-- guards against accidents.
-- =============================================================================

create table if not exists message_threads (
  id                uuid primary key default gen_random_uuid(),
  participant_a     uuid not null references users(id) on delete cascade,
  participant_b     uuid not null references users(id) on delete cascade,
  -- Denormalized for cheap inbox sort ("most recent thread first")
  -- without joining messages. Written by the app when a message is
  -- inserted; nullable so an "empty" thread created but never used
  -- doesn't appear at the top of every inbox forever.
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  unique (participant_a, participant_b),
  -- Canonical ordering guardrail. Prevents (a=X, b=Y) and (a=Y, b=X)
  -- both existing as separate threads for the same pair.
  check (participant_a < participant_b),
  -- A user can't have a self-thread. Not a real use case, and it'd
  -- break "the other participant" resolution elsewhere.
  check (participant_a <> participant_b)
);

create index if not exists message_threads_participant_a_idx
  on message_threads (participant_a, last_message_at desc);
create index if not exists message_threads_participant_b_idx
  on message_threads (participant_b, last_message_at desc);

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references message_threads(id) on delete cascade,
  sender_id    uuid not null references users(id) on delete cascade,
  body         text not null check (length(body) between 1 and 4000),
  -- Timestamp when the RECIPIENT (not the sender) marked the
  -- message read. Sender's own messages have this null perpetually —
  -- they don't need to mark their own messages read. Unread count
  -- for a user = messages where sender != me AND read_at is null.
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists messages_thread_created_idx
  on messages (thread_id, created_at desc);
-- Unread count query: "messages in threads I participate in, not
-- sent by me, unread". Partial index makes it near-free.
create index if not exists messages_unread_idx
  on messages (thread_id, sender_id) where read_at is null;

create table if not exists message_reactions (
  message_id   uuid not null references messages(id) on delete cascade,
  user_id      uuid not null references users(id) on delete cascade,
  emoji        text not null check (length(emoji) between 1 and 16),
  created_at   timestamptz not null default now(),
  -- One reaction per user per message. Toggling means DELETE + INSERT.
  -- Multi-emoji per user per message is possible if a future product
  -- decision wants it; drop this PK and add (message_id, user_id, emoji).
  primary key (message_id, user_id)
);

create index if not exists message_reactions_message_idx
  on message_reactions (message_id);

-- ----------------------------------------------------------------------------
-- RLS: participants-only. Coach visibility is deliberately blocked at
-- the RLS layer, not just the app layer — even if a future admin
-- surface accidentally queries messages via the anon key, RLS says
-- no. Service role bypasses RLS (per usual) so migrations, backups,
-- and any legitimate admin ops still work.
-- ----------------------------------------------------------------------------

alter table message_threads   enable row level security;
alter table messages          enable row level security;
alter table message_reactions enable row level security;

--
-- message_threads
--

drop policy if exists "message_threads_read_own" on message_threads;
create policy "message_threads_read_own"
  on message_threads for select
  to authenticated
  using (auth.uid() in (participant_a, participant_b));

-- Insert allowed only when (a) the caller is one of the two
-- participants AND (b) both participants share at least one active
-- community membership. This is the "you can only message men in
-- your community" rule enforced at the RLS layer so it holds even
-- if application code has a bug. Once the thread exists, ongoing
-- messages don't re-check — if two men drift into different
-- communities later they can still finish the current conversation
-- (matches how Slack + Facebook handle "left the group" nuances).
drop policy if exists "message_threads_insert_participant" on message_threads;
drop policy if exists "message_threads_insert_shared_community" on message_threads;
create policy "message_threads_insert_shared_community"
  on message_threads for insert
  to authenticated
  with check (
    auth.uid() in (participant_a, participant_b)
    and exists (
      select 1
      from memberships m_a
      join memberships m_b on m_a.community_id = m_b.community_id
      where m_a.user_id = participant_a
        and m_b.user_id = participant_b
        and m_a.status = 'active'
        and m_b.status = 'active'
    )
  );

-- last_message_at gets stamped by the app after inserting a message;
-- both participants can update the thread (only for that column, in
-- practice — app code never touches the other cols post-create).
drop policy if exists "message_threads_touch_own" on message_threads;
create policy "message_threads_touch_own"
  on message_threads for update
  to authenticated
  using (auth.uid() in (participant_a, participant_b))
  with check (auth.uid() in (participant_a, participant_b));

--
-- messages
--

drop policy if exists "messages_read_participant" on messages;
create policy "messages_read_participant"
  on messages for select
  to authenticated
  using (
    exists (
      select 1 from message_threads t
      where t.id = messages.thread_id
        and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

drop policy if exists "messages_insert_sender" on messages;
create policy "messages_insert_sender"
  on messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from message_threads t
      where t.id = thread_id
        and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

-- Read receipts: the recipient (not the sender) marks read_at.
-- Recipient = the other participant in the thread.
drop policy if exists "messages_mark_read_recipient" on messages;
create policy "messages_mark_read_recipient"
  on messages for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and exists (
      select 1 from message_threads t
      where t.id = messages.thread_id
        and auth.uid() in (t.participant_a, t.participant_b)
    )
  )
  with check (
    sender_id <> auth.uid()
  );

--
-- message_reactions
--

drop policy if exists "message_reactions_read_participant" on message_reactions;
create policy "message_reactions_read_participant"
  on message_reactions for select
  to authenticated
  using (
    exists (
      select 1 from messages m
      join message_threads t on t.id = m.thread_id
      where m.id = message_reactions.message_id
        and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

drop policy if exists "message_reactions_write_own" on message_reactions;
create policy "message_reactions_write_own"
  on message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from messages m
      join message_threads t on t.id = m.thread_id
      where m.id = message_id
        and auth.uid() in (t.participant_a, t.participant_b)
    )
  );

drop policy if exists "message_reactions_delete_own" on message_reactions;
create policy "message_reactions_delete_own"
  on message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Realtime: enable on messages + reactions + threads so the client
-- can subscribe to inserts/updates and paint the UI without a poll.
-- Threads publish for the header unread-count subscription (a new
-- thread bumps the count too).
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table message_reactions;
alter publication supabase_realtime add table message_threads;
