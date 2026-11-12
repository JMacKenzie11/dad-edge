import { describe, expect, it } from "vitest";
import { countsAsMember } from "./members";

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
