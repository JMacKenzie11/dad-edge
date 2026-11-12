import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * An AI app signing in to the MCP server over OAuth, end to end on dev
 * (DECISIONS.md "MCP sign-in with OAuth"): register the app the way Grok
 * Bot does, send the person through Supabase's authorize step to
 * /oauth/consent, press ALLOW, trade the code for a token, then use it.
 *
 * Needs dev's OAuth server and token hook on (docs/mcp.md).
 */

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GROK = "https://grok.com/connectors-oauth-exchange-code/";

async function register(request: APIRequestContext, redirects: string[]): Promise<string> {
  const r = await request.post(`${SUPA}/auth/v1/oauth/clients/register`, {
    headers: { apikey: ANON },
    data: { client_name: "zz e2e Grok", redirect_uris: redirects, grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" },
  });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).client_id as string;
}

/** Start the sign-in and stop when Supabase sends the browser back to GROK with a code. */
async function authorize(page: Page, clientId: string, challenge: string): Promise<void> {
  const url = new URL(`${SUPA}/auth/v1/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: GROK, code_challenge: challenge, code_challenge_method: "S256", state: "zz" }).toString();
  // Never really leave for grok.com.
  await page.route("https://grok.com/**", (route) => route.fulfill({ status: 200, body: "back at the app" }));
  await page.goto(url.toString());
  await page.waitForURL(/\/oauth\/consent\?authorization_id=/);
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

async function mcp(request: APIRequestContext, token: string, body: object) {
  return request.post("/api/mcp", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: body,
  });
}

test("an admin connects an approved AI app and it can list members, nothing more", async ({ asAdmin: page, request }) => {
  // The 401 points the app at where to sign in.
  const unauth = await request.post("/api/mcp", { data: {} });
  expect(unauth.status()).toBe(401);
  expect(unauth.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource");
  const meta = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(meta.authorization_servers).toEqual([`${SUPA}/auth/v1`]);

  const clientId = await register(request, [GROK]);
  const { verifier, challenge } = pkce();
  await authorize(page, clientId, challenge);
  await expect(page.getByRole("heading", { name: /Connect .+ to Brave Man OS\?/ })).toBeVisible();
  await expect(page.getByText(/can't read goals, missions, check-ins or survey answers/)).toBeVisible();
  await page.getByRole("button", { name: "ALLOW" }).click();
  await page.waitForURL(/^https:\/\/grok\.com\//);
  const code = new URL(page.url()).searchParams.get("code");
  expect(code).toBeTruthy();

  const tok = await request.post(`${SUPA}/auth/v1/oauth/token`, {
    headers: { apikey: ANON },
    form: { grant_type: "authorization_code", code: code!, redirect_uri: GROK, client_id: clientId, code_verifier: verifier },
  });
  expect(tok.ok(), await tok.text()).toBe(true);
  const token = (await tok.json()).access_token as string;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  expect(claims.role).toBe("mcp_assistant");
  expect(claims.client_id).toBe(clientId);

  // Through the MCP server: works.
  const list = await mcp(request, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_members", arguments: { community: "E2E Basecamp" } } });
  expect(list.status()).toBe(200);
  const result = JSON.parse((await list.json()).result.content[0].text);
  expect(result.community.name).toBe("E2E Basecamp");
  expect(result.members.length).toBeGreaterThan(0);
  expect(Object.keys(result.members[0]).sort()).toEqual(["email", "first_name", "role"]);

  // Straight at the database with the same token: refused.
  const direct = await request.get(`${SUPA}/rest/v1/users?select=email&limit=1`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
  expect(direct.ok()).toBe(false);
  const rpc = await request.post(`${SUPA}/rest/v1/rpc/mcp_user_is_admin`, { headers: { apikey: ANON, authorization: `Bearer ${token}` }, data: { p_user_id: claims.sub } });
  expect(rpc.ok()).toBe(false);
});

test("a member can't connect an AI app", async ({ asMember: page, request }) => {
  const clientId = await register(request, [GROK]);
  await authorize(page, clientId, pkce().challenge);
  await expect(page.getByRole("heading", { name: "AI apps can connect to admin accounts only." })).toBeVisible();
  await expect(page.getByRole("button", { name: "ALLOW" })).toHaveCount(0);
});

test("an app that also returns somewhere unapproved is refused", async ({ asAdmin: page, request }) => {
  const clientId = await register(request, [GROK, "https://evil.example/cb"]);
  await authorize(page, clientId, pkce().challenge);
  await expect(page.getByRole("heading", { name: "This AI app isn't approved for Brave Man OS." })).toBeVisible();
  await expect(page.getByRole("button", { name: "ALLOW" })).toHaveCount(0);
});
