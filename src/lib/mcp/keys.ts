import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * API keys for outside systems that connect over MCP (/api/mcp), such
 * as Grok Bot. DECISIONS.md "MCP server for outside systems".
 *
 * A key is shown once when an admin makes it; only its SHA-256 hash is
 * stored. Each key carries the communities it may read. An empty list
 * means every community.
 */

export const KEY_PREFIX = "bmos_";

export type ApiKeyRow = {
  id: string;
  label: string;
  created_by: string | null;
  community_ids: string[];
  revoked_at: string | null;
};

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** The part of the key shown in the admin list so keys can be told apart. */
export function keyHint(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 4);
}

/** Pull the key out of an "Authorization: Bearer <key>" header. */
export function bearerKey(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m || !m[1].startsWith(KEY_PREFIX)) return null;
  return m[1];
}

export function hashesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Can this key read this community? */
export function keyCoversCommunity(key: Pick<ApiKeyRow, "community_ids" | "revoked_at">, communityId: string): boolean {
  if (key.revoked_at) return false;
  return key.community_ids.length === 0 || key.community_ids.includes(communityId);
}
