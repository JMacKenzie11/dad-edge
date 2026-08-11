--
-- Phase A: multi-conversation coach. Each conversation is a titled thread
-- with an auto-generated title (Haiku) and a soft-archive flag.
--
-- Phase B will add `summary` + `summary_updated_at` for cross-conversation
-- context injection — reserving the columns now so the app can read them
-- without a schema change later.
--
alter table coach_conversations
  add column if not exists title                text,
  add column if not exists summary              text,
  add column if not exists summary_updated_at   timestamptz,
  add column if not exists archived_at          timestamptz;

create index if not exists coach_conversations_user_recent_idx
  on coach_conversations (user_id, archived_at, last_message_at desc);
