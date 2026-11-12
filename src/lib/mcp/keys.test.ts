import { describe, expect, it } from "vitest";
import { bearerKey, generateApiKey, hashApiKey, hashesMatch, keyCoversCommunity, keyHint, KEY_PREFIX } from "./keys";

describe("API keys", () => {
  it("makes long random keys with the prefix", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.startsWith(KEY_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
    expect(keyHint(a)).toHaveLength(KEY_PREFIX.length + 4);
  });

  it("stores a hash, not the key", () => {
    const k = generateApiKey();
    expect(hashApiKey(k)).not.toContain(k);
    expect(hashesMatch(hashApiKey(k), hashApiKey(k))).toBe(true);
    expect(hashesMatch(hashApiKey(k), hashApiKey(generateApiKey()))).toBe(false);
  });

  it("reads only bearer keys with our prefix", () => {
    expect(bearerKey("Bearer bmos_abc")).toBe("bmos_abc");
    expect(bearerKey("bearer bmos_abc ")).toBe("bmos_abc");
    expect(bearerKey("Bearer sk-other")).toBeNull();
    expect(bearerKey("Basic bmos_abc")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });

  it("limits a key to its communities", () => {
    expect(keyCoversCommunity({ community_ids: [], revoked_at: null }, "c1")).toBe(true);
    expect(keyCoversCommunity({ community_ids: ["c1"], revoked_at: null }, "c1")).toBe(true);
    expect(keyCoversCommunity({ community_ids: ["c1"], revoked_at: null }, "c2")).toBe(false);
    expect(keyCoversCommunity({ community_ids: [], revoked_at: "2026-11-12T00:00:00Z" }, "c1")).toBe(false);
  });
});
