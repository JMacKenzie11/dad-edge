import { describe, expect, it } from "vitest";
import { buildCoachContext } from "@/lib/coach/context";
import type { ContextProvider } from "@/lib/coach/context";
import type { SessionUser } from "@/lib/session";

/**
 * Coach context assembler tests. The provider pattern's value is
 * additive extensibility: a new context source is added by writing
 * one file and appending to the registry, with zero changes to the
 * assembler, prompts, or existing providers. This test proves that
 * property.
 */

const fakeUser: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "test@example.com",
  first_name: "Test",
  last_name: "User",
  phone: null,
  timezone: "America/Chicago",
  is_platform_admin: false,
  subscription_status: "active",
  canceled_at: null,
  onboarding_step: 7,
  occupation: null,
  employment_type: null,
};

function fakeProvider(overrides: Partial<ContextProvider> = {}): ContextProvider {
  return {
    key: "throwaway",
    priority: 999,
    cacheable: false,
    async build() {
      return {
        label: "Throwaway",
        text: "This block came from a test-only provider.",
        tokenEstimate: 42,
      };
    },
    ...overrides,
  };
}

describe("buildCoachContext (provider assembler)", () => {
  it("returns an empty AssembledContext when no providers register anything", async () => {
    const nullProvider: ContextProvider = {
      key: "null",
      priority: 1,
      cacheable: false,
      async build() {
        return null;
      },
    };
    const out = await buildCoachContext(fakeUser, [nullProvider]);
    expect(out.systemContextText).toBe("");
    expect(out.cacheablePrefix).toBe("");
    expect(out.volatileBody).toBe("");
    expect(out.providerKeys).toEqual([]);
    expect(out.tokenEstimate).toBe(0);
  });

  it("EXTENSIBILITY CHECK: a throwaway provider appears in output with no changes to build.ts", async () => {
    // This is the load-bearing test. The provider pattern only earns
    // its keep if adding a source is exactly "write a file + register
    // it." If this test ever needs a change to build.ts to pass, the
    // pattern is broken.
    const out = await buildCoachContext(fakeUser, [fakeProvider()]);
    expect(out.providerKeys).toContain("throwaway");
    expect(out.systemContextText).toContain("## Throwaway");
    expect(out.systemContextText).toContain(
      "This block came from a test-only provider.",
    );
    expect(out.tokenEstimate).toBe(42);
  });

  it("skips null blocks silently (no empty sections)", async () => {
    const yes = fakeProvider({ key: "keep" });
    const no: ContextProvider = {
      key: "drop",
      priority: 1,
      cacheable: false,
      async build() {
        return null;
      },
    };
    const out = await buildCoachContext(fakeUser, [no, yes]);
    expect(out.providerKeys).toEqual(["keep"]);
    expect(out.systemContextText).not.toContain("drop");
  });

  it("separates cacheable from volatile blocks into distinct sections", async () => {
    const cacheable = fakeProvider({
      key: "cache-me",
      priority: 1,
      cacheable: true,
    });
    const volatileP = fakeProvider({
      key: "recompute-me",
      priority: 2,
      cacheable: false,
      async build() {
        return {
          label: "Volatile",
          text: "This one moves.",
          tokenEstimate: 10,
        };
      },
    });
    const out = await buildCoachContext(fakeUser, [volatileP, cacheable]);
    expect(out.cacheablePrefix).toContain("# Live user context (stable)");
    expect(out.cacheablePrefix).toContain("Throwaway");
    expect(out.cacheablePrefix).not.toContain("Volatile");
    expect(out.volatileBody).toContain("# Live user context (this turn)");
    expect(out.volatileBody).toContain("Volatile");
    expect(out.volatileBody).not.toContain("Throwaway");
    // In systemContextText the cacheable prefix precedes the volatile
    // body (order-sensitive for Anthropic's stable-prefix caching).
    const stableIdx = out.systemContextText.indexOf("(stable)");
    const turnIdx = out.systemContextText.indexOf("(this turn)");
    expect(stableIdx).toBeGreaterThanOrEqual(0);
    expect(turnIdx).toBeGreaterThanOrEqual(0);
    expect(stableIdx).toBeLessThan(turnIdx);
  });

  it("sums token estimates across all included blocks", async () => {
    const a = fakeProvider({ key: "a" }); // 42 tokens
    const b = fakeProvider({
      key: "b",
      async build() {
        return { label: "B", text: "b", tokenEstimate: 8 };
      },
    });
    const out = await buildCoachContext(fakeUser, [a, b]);
    expect(out.tokenEstimate).toBe(50);
  });

  it("orders providers by priority within cacheability bucket", async () => {
    const first = fakeProvider({
      key: "first",
      priority: 1,
      cacheable: true,
      async build() {
        return { label: "First", text: "1", tokenEstimate: 1 };
      },
    });
    const second = fakeProvider({
      key: "second",
      priority: 2,
      cacheable: true,
      async build() {
        return { label: "Second", text: "2", tokenEstimate: 1 };
      },
    });
    // Insert in reverse order — assembler must sort by priority.
    const out = await buildCoachContext(fakeUser, [second, first]);
    expect(out.providerKeys).toEqual(["first", "second"]);
    const firstIdx = out.systemContextText.indexOf("First");
    const secondIdx = out.systemContextText.indexOf("Second");
    expect(firstIdx).toBeLessThan(secondIdx);
  });

  it("swallows provider errors without breaking the assembler", async () => {
    const good = fakeProvider();
    const broken: ContextProvider = {
      key: "explodes",
      priority: 1,
      cacheable: false,
      async build() {
        throw new Error("intentional test explosion");
      },
    };
    const out = await buildCoachContext(fakeUser, [broken, good]);
    // Broken provider is dropped as if it returned null; good one lands.
    expect(out.providerKeys).toEqual(["throwaway"]);
    expect(out.systemContextText).toContain("Throwaway");
  });
});
