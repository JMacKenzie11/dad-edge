/**
 * OAuth Protected Resource Metadata (RFC 9728) for /api/mcp. An AI app
 * that gets a 401 from /api/mcp reads this to find where to sign the
 * person in: this project's Supabase Auth, which runs the OAuth server
 * and sends the person to /oauth/consent. Served at
 * /.well-known/oauth-protected-resource and
 * /.well-known/oauth-protected-resource/api/mcp, the two forms apps ask
 * for. DECISIONS.md "MCP sign-in with OAuth".
 */

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [`${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "")}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Brave Man OS",
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
