-- =============================================================================
-- Sign-in for outside AI apps (Grok Bot, Claude, ChatGPT) over OAuth, for
-- the MCP server at /api/mcp. DECISIONS.md "MCP sign-in with OAuth".
--
-- The app's Supabase project runs Supabase's OAuth server: the AI app
-- registers itself, sends the person to /oauth/consent, and gets a token
-- that acts as that person. Left alone, that token is an ordinary
-- `authenticated` JWT (plus a client_id claim) that works directly against
-- the database API, Storage and Realtime as the person. For an admin that
-- is nearly everything, partner survey answers included.
--
-- So the custom access token hook below changes three things for any token
-- carrying a client_id:
--
--   1. Only approved apps. Every return address the app registered must
--      be on mcp_redirect_trusted's list, which is the part a lookalike
--      can't fake: a code sent to https://grok.com/... can only be used by
--      Grok. Otherwise no token.
--   2. Only platform admins (Jason, 2026-11-12). Otherwise no token.
--   3. The token's role becomes mcp_assistant, a database role with no
--      privileges on anything. The database API, Storage and Realtime all
--      run as the token's role, so the token reaches no table there. Only
--      /api/mcp accepts it, which checks it again and reads with the
--      service role (src/lib/mcp/oauth.ts).
--
-- Ordinary sign-ins carry no client_id and pass through unchanged.
--
-- The hook is switched on in the project's Auth settings
-- (hook_custom_access_token_uri = pg-functions://postgres/public/mcp_access_token_hook),
-- along with the OAuth server (authorization path /oauth/consent, dynamic
-- registration on). docs/mcp.md has the settings.
-- =============================================================================

-- A role that can do nothing. authenticator may switch to it, so a request
-- carrying it fails with "permission denied" instead of a role error.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mcp_assistant') then
    create role mcp_assistant nologin noinherit;
  end if;
end
$$;
grant mcp_assistant to authenticator;

-- One return address on the approved list. Exact addresses only.
--   Claude:   https://claude.ai/api/mcp/auth_callback, https://claude.com/api/mcp/auth_callback
--   ChatGPT:  https://chatgpt.com/connector_platform_oauth_redirect, https://chatgpt.com/connector/oauth/<id>
--   Grok Bot: one registration carries all six of its addresses, shared
--             with Cursor, so all six are listed or Grok Bot is refused
--             (the same list AiMS HQ uses, its migration 0301). The last
--             two return to a program on the person's own computer; the
--             consent page says so.
-- src/lib/mcp/trusted-clients.ts mirrors this list for the consent page;
-- trusted-clients.test.ts fails if the two disagree.
create or replace function public.mcp_redirect_trusted(uri text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(uri, '') in (
           'https://claude.ai/api/mcp/auth_callback',
           'https://claude.com/api/mcp/auth_callback',
           'https://chatgpt.com/connector_platform_oauth_redirect',
           'https://grok.com/connectors-oauth-exchange-code/',
           'https://www.cursor.com/bot/mcp/oauth/callback',
           'https://www.cursor.com/agents/mcp/oauth/callback',
           'cursor://anysphere.cursor-mcp/oauth/callback',
           'http://localhost:8787/callback',
           'http://127.0.0.1:8787/callback')
      or coalesce(uri, '') ~ '^https://chatgpt\.com/connector/oauth/[A-Za-z0-9_-]{1,128}$'
$$;

-- The app exists and every return address it registered is approved.
-- SECURITY DEFINER: auth.oauth_clients isn't readable by request roles.
create or replace function public.mcp_client_trusted(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*) > 0 and bool_and(public.mcp_redirect_trusted(btrim(u)))
      from auth.oauth_clients c,
           unnest(string_to_array(c.redirect_uris, ',')) as u
     where c.id::text = p_client_id
       and c.deleted_at is null
  ), false)
$$;

-- Platform admin, as the hook and /api/mcp see it.
create or replace function public.mcp_user_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select is_platform_admin from public.users where id = p_user_id), false)
$$;

create or replace function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cid text := nullif(event -> 'claims' ->> 'client_id', '');
  uid uuid := nullif(event ->> 'user_id', '')::uuid;
begin
  if cid is null then
    return event;
  end if;
  if not public.mcp_client_trusted(cid) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'This AI app isn''t approved for Brave Man OS.'));
  end if;
  if uid is null or not public.mcp_user_is_admin(uid) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'AI apps can connect to admin accounts only.'));
  end if;
  return jsonb_set(event, '{claims,role}', '"mcp_assistant"');
end;
$$;

revoke all on function public.mcp_redirect_trusted(text) from public, anon, authenticated;
revoke all on function public.mcp_client_trusted(text) from public, anon, authenticated;
revoke all on function public.mcp_user_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function public.mcp_client_trusted(text) to supabase_auth_admin, service_role;
grant execute on function public.mcp_redirect_trusted(text) to supabase_auth_admin, service_role;
grant execute on function public.mcp_user_is_admin(uuid) to supabase_auth_admin, service_role;

-- Postgres lets every role run a function unless told otherwise, so a
-- role with no table privileges could still call functions through the
-- database API (/rpc/<name>, and GraphQL, which is /rpc/graphql). This
-- gate runs before every database API request and refuses any request
-- made as mcp_assistant, whatever it asks for. Every other request
-- passes straight through.
create or replace function public.mcp_request_gate()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if current_user = 'mcp_assistant' then
    raise exception 'AI apps reach Brave Man OS only through its MCP server.'
      using errcode = '42501';
  end if;
end;
$$;

alter role authenticator set pgrst.db_pre_request to 'public.mcp_request_gate';
notify pgrst, 'reload config';
