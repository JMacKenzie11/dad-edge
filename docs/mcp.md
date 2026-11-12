# Connecting an outside system over MCP

`/api/mcp` lets an outside AI system (Grok Bot first) look up a community's first names and emails. PRODUCT_SPEC §3.6 has the tools; DECISIONS.md "MCP server for outside systems" has the why.

## Set up a connection

1. In the app, open **Admin > API keys**. Name the key after the system ("Grok Bot"). Tick the communities it may read, or leave them all unticked for every community. Press **MAKE KEY** and copy the key. It's shown once.
2. In the outside system, add a remote MCP server:
   - URL: `https://<app domain>/api/mcp`
   - Header: `Authorization: Bearer <the key>`
   - Transport: Streamable HTTP. Use the key header, not OAuth.
3. Ask it something like "List the first names and emails for the Basecamp community." It calls `list_members` with the words you used; if they match more than one community, or none, it gets the choices back and should ask you.

## Turn one off

**REVOKE** on Admin > API keys. The next request with that key gets 401. Make a new key if the old one was ever pasted somewhere it shouldn't be.

## Check what's been pulled

Admin > Audit log, action `mcp.list_members`: the key, the community, the words asked and how many men came back.
