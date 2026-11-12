import { describe, expect, it } from "vitest";
import { claimsProblem } from "./oauth";

const URL = "https://abc.supabase.co";
const ok = { sub: "u1", client_id: "c1", iss: `${URL}/auth/v1`, role: "mcp_assistant", exp: Date.now() / 1000 + 600 };

describe("claimsProblem", () => {
  it("accepts an app token the hook made", () => {
    expect(claimsProblem(ok, URL)).toBeNull();
  });
  it("refuses an ordinary sign-in token", () => {
    expect(claimsProblem({ ...ok, client_id: undefined, role: "authenticated" }, URL)).toBe("not an app token");
  });
  it("refuses an app token that kept the authenticated role", () => {
    expect(claimsProblem({ ...ok, role: "authenticated" }, URL)).toBe("wrong role");
  });
  it("refuses another project's token", () => {
    expect(claimsProblem({ ...ok, iss: "https://other.supabase.co/auth/v1" }, URL)).toBe("wrong issuer");
  });
  it("refuses an expired token", () => {
    expect(claimsProblem({ ...ok, exp: 1 }, URL)).toBe("expired");
  });
});
