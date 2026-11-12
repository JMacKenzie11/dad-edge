# Connecting an outside system over MCP

`/api/mcp` lets an outside AI system (Grok Bot first) look up a community's first names and emails. PRODUCT_SPEC §3.6 has the tools; DECISIONS.md "MCP server for outside systems" has the why.

## Connect Grok Bot, Claude or ChatGPT (sign in, no key)

1. Add a custom connector. Name: `Brave Man OS`. Type: Remote HTTPS. Server URL: `https://<app domain>/api/mcp`. Leave the headers and Client ID empty.
2. The app opens Brave Man OS. Sign in with an admin account and press **ALLOW**.
3. Ask it something like "List the first names and emails for the Basecamp community."

Only platform admins can allow, and only Grok Bot, Claude and ChatGPT are approved (DECISIONS.md "MCP sign-in with OAuth"). To cut an app off, an admin can be taken off the admins, or its return address taken off `mcp_redirect_trusted` in a migration.

### Supabase settings this needs (each project)

Set through the Management API (`PATCH /v1/projects/<ref>/config/auth`):
- `oauth_server_enabled: true`, `oauth_server_authorization_path: "/oauth/consent"`, `oauth_server_allow_dynamic_registration: true`
- `hook_custom_access_token_enabled: true`, `hook_custom_access_token_uri: "pg-functions://postgres/public/mcp_access_token_hook"`
- `mfa_totp_enroll_enabled: false`

The project's Site URL must be the app's address, since the consent link is built from it. Migration `20261112000002_mcp_oauth.sql` must be applied first: the hook setting points at its function.

## Set up a connection with an API key

1. In the app, open **Admin > API keys**. Name the key after the system ("Grok Bot"). Tick the communities it may read, or leave them all unticked for every community. Press **MAKE KEY** and copy the key. It's shown once.
2. In the outside system, add a remote MCP server:
   - URL: `https://<app domain>/api/mcp`
   - Header: key `Authorization`, value `Bearer <the key>`. The key on its own also works, and so does a header named `X-API-Key`.
   - Transport: Streamable HTTP. Leave any OAuth Client ID blank.

If you meant to use a key and the other system starts an OAuth sign-in instead, the server didn't get a key it recognizes. Check the header name and that the whole key was pasted. The Vercel logs show `[mcp] no key` with the header names that arrived.
3. Ask it something like "List the first names and emails for the Basecamp community." It calls `list_members` with the words you used; if they match more than one community, or none, it gets the choices back and should ask you.

## Turn one off

**REVOKE** on Admin > API keys. The next request with that key gets 401. Make a new key if the old one was ever pasted somewhere it shouldn't be.

## Check what's been pulled

Admin > Audit log, action `mcp.list_members`: the key, the community, the words asked and how many men came back.
