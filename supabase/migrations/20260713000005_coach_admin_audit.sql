create table coach_conversations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users(id) on delete cascade,
  mode                  coach_mode not null,
  started_at            timestamptz not null default now(),
  last_message_at       timestamptz
);

create table coach_messages (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null references coach_conversations(id) on delete cascade,
  role                  text not null check (role in ('user','assistant','system')),
  content               text not null,
  model_used            text,
  tokens_in             int,
  tokens_out            int,
  flagged               boolean not null default false,
  flag_reason           text,
  created_at            timestamptz not null default now()
);

create index coach_messages_conversation_idx on coach_messages (conversation_id, created_at);

create table coach_flags_queue (
  id                    uuid primary key default gen_random_uuid(),
  message_id            uuid not null references coach_messages(id) on delete cascade,
  severity              text not null,
  status                flag_status not null default 'open',
  reviewed_by           uuid references users(id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now()
);

create table score_corrections (
  id                    uuid primary key default gen_random_uuid(),
  admin_user_id         uuid not null references users(id) on delete set null,
  target_user_id        uuid not null references users(id) on delete cascade,
  date                  date not null,
  pillar_code           pillar_code not null,
  old_value             smallint,
  new_value             smallint,
  reason                text not null,
  created_at            timestamptz not null default now()
);

create table audit_log (
  id                    uuid primary key default gen_random_uuid(),
  actor_user_id         uuid references users(id) on delete set null,
  action                text not null,
  target_type           text,
  target_id             uuid,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);

create index audit_log_actor_idx on audit_log (actor_user_id, created_at desc);
create index audit_log_target_idx on audit_log (target_type, target_id);

create table nudge_settings (
  community_id          uuid primary key references communities(id) on delete cascade,
  daily_reminder_time   time not null default '18:00',
  disengagement_ladder  jsonb not null default '{"day3":true,"day7":true,"day14":true}'::jsonb
);

create table digests (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  week_start            date not null,
  generated_at          timestamptz not null default now(),
  body                  jsonb not null,
  unique (community_id, week_start)
);

--
-- Invites — issued by leader/admin, redeemed on first magic link.
--
create table invites (
  id                    uuid primary key default gen_random_uuid(),
  community_id          uuid not null references communities(id) on delete cascade,
  email                 text not null,
  first_name            text,
  last_name             text,
  invited_by            uuid references users(id) on delete set null,
  redeemed_by           uuid references users(id) on delete set null,
  redeemed_at           timestamptz,
  created_at            timestamptz not null default now(),
  unique (community_id, email)
);
