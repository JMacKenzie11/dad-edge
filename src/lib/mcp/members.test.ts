import { describe, expect, it } from "vitest";
import { countsAsMember, memberContact } from "./members";

const man = { subscription_status: "comped", is_admin_only: false, is_platform_admin: false };
const active = { status: "active", role: "member" as const };

describe("countsAsMember", () => {
  it("counts an active, paid-up member or leader", () => {
    expect(countsAsMember(active, man)).toBe(true);
    expect(countsAsMember({ ...active, role: "leader" }, man)).toBe(true);
  });
  it("leaves out inactive memberships and canceled subscriptions", () => {
    expect(countsAsMember({ ...active, status: "inactive" }, man)).toBe(false);
    expect(countsAsMember(active, { ...man, subscription_status: "canceled" })).toBe(false);
  });
  it("leaves out staff: admin-only logins and platform admins added as leaders", () => {
    expect(countsAsMember(active, { ...man, is_admin_only: true })).toBe(false);
    expect(countsAsMember({ ...active, role: "leader" }, { ...man, is_platform_admin: true })).toBe(false);
  });
  it("counts a platform admin who joined as an ordinary member", () => {
    expect(countsAsMember(active, { ...man, is_platform_admin: true })).toBe(true);
  });
});

describe("memberContact", () => {
  it("sends first and last name, city and photo, trimmed", () => {
    expect(
      memberContact({ userId: "u", first_name: "Scott ", last_name: " Zemens", email: "s@x.test", role: "member", city: "Detroit, MI", avatar_url: "https://x/p.jpg" }),
    ).toEqual({ first_name: "Scott", last_name: "Zemens", email: "s@x.test", role: "member", city: "Detroit, MI", photo_url: "https://x/p.jpg" });
    expect(memberContact({ userId: "u", first_name: null, last_name: null, email: "s@x.test", role: "leader", city: " ", avatar_url: null })).toMatchObject({ city: null, photo_url: null });
  });
});
