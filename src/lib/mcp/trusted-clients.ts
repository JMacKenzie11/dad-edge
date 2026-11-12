/**
 * The AI apps allowed to sign in over OAuth, by where they send the
 * person back. Mirrors public.mcp_redirect_trusted in
 * supabase/migrations/20261112000002_mcp_oauth.sql, which is what
 * actually decides (the token hook asks it). trusted-clients.test.ts
 * fails if the two lists disagree. This copy is for the consent page's
 * wording only.
 */

export const TRUSTED_REDIRECTS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/bot/mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "http://localhost:8787/callback",
  "http://127.0.0.1:8787/callback",
] as const;

export const TRUSTED_REDIRECT_PATTERN = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;

export function redirectTrusted(uri: string): boolean {
  return (TRUSTED_REDIRECTS as readonly string[]).includes(uri) || TRUSTED_REDIRECT_PATTERN.test(uri);
}

/** Returns to a program on the person's own computer. */
export function returnsToThisComputer(uri: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1):8787\//.test(uri) || uri.startsWith("cursor://");
}

/** What to call the app on the consent page, by where it returns. */
export function appLabel(name: string | null | undefined, redirectUri: string): string {
  if (/^https:\/\/claude\.(ai|com)\//.test(redirectUri)) return "Claude";
  if (/^https:\/\/chatgpt\.com\//.test(redirectUri)) return "ChatGPT";
  if (redirectUri.startsWith("https://grok.com/") || returnsToThisComputer(redirectUri) || redirectUri.startsWith("https://www.cursor.com/")) {
    return name?.trim() ? name.trim().slice(0, 60) : "Grok Bot";
  }
  return name?.trim() ? name.trim().slice(0, 60) : "An AI app";
}
