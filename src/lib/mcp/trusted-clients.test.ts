import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRUSTED_REDIRECTS, TRUSTED_REDIRECT_PATTERN, appLabel, redirectTrusted, returnsToThisComputer } from "./trusted-clients";

const SQL = readFileSync("supabase/migrations/20261112000002_mcp_oauth.sql", "utf8");

describe("trusted AI apps", () => {
  it("matches the database's list exactly", () => {
    const fn = SQL.slice(SQL.indexOf("function public.mcp_redirect_trusted"), SQL.indexOf("function public.mcp_client_trusted"));
    const inList = [...fn.matchAll(/'([a-z]+:\/\/[^']+)'/g)].map((m) => m[1]);
    expect(inList.sort()).toEqual([...TRUSTED_REDIRECTS].sort());
    expect(fn).toContain(`'${TRUSTED_REDIRECT_PATTERN.source.replace(/\\\//g, "/")}'`);
  });

  it("approves exact addresses only", () => {
    expect(redirectTrusted("https://grok.com/connectors-oauth-exchange-code/")).toBe(true);
    expect(redirectTrusted("https://grok.com/connectors-oauth-exchange-code/x")).toBe(false);
    expect(redirectTrusted("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(redirectTrusted("http://localhost:9999/callback")).toBe(false);
    expect(redirectTrusted("https://chatgpt.com/connector/oauth/abc_123")).toBe(true);
    expect(redirectTrusted("https://chatgpt.com/connector/oauth/abc/../x")).toBe(false);
  });

  it("names the app by where it returns", () => {
    expect(appLabel("Anything", "https://claude.ai/api/mcp/auth_callback")).toBe("Claude");
    expect(appLabel("Grok", "https://grok.com/connectors-oauth-exchange-code/")).toBe("Grok");
    expect(appLabel("", "https://grok.com/connectors-oauth-exchange-code/")).toBe("Grok Bot");
    expect(returnsToThisComputer("http://127.0.0.1:8787/callback")).toBe(true);
    expect(returnsToThisComputer("https://grok.com/connectors-oauth-exchange-code/")).toBe(false);
  });
});
