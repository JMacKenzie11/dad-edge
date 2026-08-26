import { afterEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/session";

/**
 * requirePlatformAdmin guards every (admin) route. If this check
 * inverts, weakens, or stops calling redirect(), non-admins get
 * silent access to the admin surface. That failure mode won't show
 * up in a UI walkthrough because admins see the same thing — this
 * test is the guardrail.
 *
 * Pure unit test: mock requireUser + next/navigation.redirect so we
 * verify the gate logic itself, not the cookies/Supabase chain
 * underneath (that chain is exercised by every other test that runs
 * against dev Supabase).
 */

// Mock next/navigation so redirect() is a spyable no-op that throws
// (matches Next.js runtime behavior — redirect() throws NEXT_REDIRECT
// under the hood, which callers unwind up the stack).
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(),
}));

// Import AFTER the mocks so the module under test picks them up.
const { requirePlatformAdmin } = await import("@/lib/admin");
const { requireUser } = await import("@/lib/session");

function fakeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "u@example.com",
    first_name: "U",
    last_name: "Ser",
    timezone: "America/Chicago",
    is_platform_admin: false,
    is_admin_only: false,
    subscription_status: "active",
    deactivated_at: null,
    onboarding_step: 7,
    occupation: null,
    employment_type: null,
    avatar_url: null,
    city: null,
    phone: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.mocked(redirect).mockClear();
  vi.mocked(requireUser).mockReset();
});

describe("requirePlatformAdmin", () => {
  it("redirects a non-admin to /today", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      fakeUser({ is_platform_admin: false }),
    );

    await expect(requirePlatformAdmin()).rejects.toThrow(/NEXT_REDIRECT:\/today/);
    expect(redirect).toHaveBeenCalledWith("/today");
  });

  it("returns the user when they ARE a platform admin", async () => {
    const admin = fakeUser({ is_platform_admin: true });
    vi.mocked(requireUser).mockResolvedValue(admin);

    await expect(requirePlatformAdmin()).resolves.toEqual(admin);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("propagates the requireUser redirect when there's no session", async () => {
    // requireUser itself calls redirect('/login') when unauthenticated.
    // requirePlatformAdmin should let that propagate — NOT catch it and
    // send them to /today instead (which would leak the /admin path's
    // existence via a different response).
    vi.mocked(requireUser).mockImplementation(async () => {
      redirect("/login");
      throw new Error("unreachable");
    });

    await expect(requirePlatformAdmin()).rejects.toThrow(/NEXT_REDIRECT:\/login/);
    expect(redirect).toHaveBeenCalledWith("/login");
    expect(redirect).not.toHaveBeenCalledWith("/today");
  });
});
