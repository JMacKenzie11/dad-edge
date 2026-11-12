-- =============================================================================
-- API keys for outside systems connecting over MCP (/api/mcp), such as
-- Grok Bot (DECISIONS.md "MCP server for outside systems").
--
--   key_hash       SHA-256 of the key. The key itself is shown once to the
--                  admin who makes it and never stored.
--   key_hint       the first characters, so keys can be told apart in the
--                  admin list.
--   community_ids  communities the key may read. Empty means all of them.
--   revoked_at     set when an admin turns the key off.
--
-- Row-level security is on with NO policies: no browser session, admin
-- included, can read or write this table. The admin page and /api/mcp
-- use the service role after their own checks.
-- =============================================================================

create table api_keys (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (char_length(label) between 1 and 80),
  key_hash       text not null unique,
  key_hint       text not null,
  community_ids  uuid[] not null default '{}',
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);

alter table api_keys enable row level security;
