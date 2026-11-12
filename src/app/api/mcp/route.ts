import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { auditLog } from "@/lib/audit";
import { bearerKey, keyCoversCommunity, type ApiKeyRow } from "@/lib/mcp/keys";
import { activeCommunities, activeMemberContacts, communitiesFor, findApiKey } from "@/lib/mcp/members";
import { resolveForKey } from "@/lib/mcp/resolve";

/**
 * MCP server for outside systems such as Grok Bot. Read-only. Each
 * request carries "Authorization: Bearer bmos_…", a key an admin made
 * on /admin/api-keys. The key decides which communities can be read.
 * DECISIONS.md "MCP server for outside systems".
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Svc = ReturnType<typeof createSupabaseServiceClient>;

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

function buildServer(svc: Svc, key: ApiKeyRow) {
  const server = new McpServer({ name: "brave-man-os", version: "1.0.0" });

  server.registerTool(
    "list_communities",
    {
      title: "List communities",
      description: "List the Brave Man OS communities this key can read, with each one's name and slug.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const communities = await communitiesFor(svc, key);
      return text({ communities: communities.map(({ name, slug }) => ({ name, slug })) });
    },
  );

  server.registerTool(
    "list_members",
    {
      title: "List members' first names and emails",
      description:
        "First name, email and role (member or leader) of every active man in one community. Canceled members are left out. Pass the community's name or slug as the user wrote it; if it matches more than one or none, the reply lists the choices instead.",
      inputSchema: { community: z.string().min(1).max(120).describe("Community name or slug, e.g. \"austin\" or \"Austin Brotherhood\"") },
      annotations: { readOnlyHint: true },
    },
    async ({ community }) => {
      const all = await activeCommunities(svc);
      const r = resolveForKey(community, all, (id) => keyCoversCommunity(key, id));
      if (r.kind !== "match") {
        const error =
          r.kind === "ambiguous"
            ? `"${community}" matches more than one community. Ask which one.`
            : r.kind === "not_allowed"
              ? `This key can't read "${community}". Pick one of the communities below or ask an admin for a key that covers it.`
              : `No community matches "${community}".`;
        return text({ error, choices: r.choices.map(({ name, slug }) => ({ name, slug })) }, true);
      }
      const members = await activeMemberContacts(svc, r.community.id);
      await auditLog({
        actor_user_id: key.created_by,
        action: "mcp.list_members",
        target_type: "community",
        target_id: r.community.id,
        metadata: { api_key_id: key.id, api_key_label: key.label, query: community, count: members.length },
      });
      return text({ community: { name: r.community.name, slug: r.community.slug }, count: members.length, members });
    },
  );

  return server;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Missing or invalid API key." }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="brave-man-os"' },
  });
}

async function handle(req: Request): Promise<Response> {
  const raw = bearerKey(req.headers.get("authorization"));
  if (!raw) return unauthorized();
  const svc = createSupabaseServiceClient();
  const key = await findApiKey(svc, raw);
  if (!key) return unauthorized();

  // Stateless: a fresh server and transport per request, which suits
  // serverless hosting. Replies come back as plain JSON.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = buildServer(svc, key);
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    void server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
