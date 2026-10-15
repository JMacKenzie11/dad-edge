import { describe, expect, it } from "vitest";
import { assertDevTarget, classifyTarget, DEV_PROJECT_REFS, PROD_PROJECT_REF, projectRefFromUrl } from "./target";

const prod = `https://${PROD_PROJECT_REF}.supabase.co`;
const dev = `https://${DEV_PROJECT_REFS[0]}.supabase.co`;

describe("assertDevTarget", () => {
  it("refuses production by project id", () => {
    expect(() => assertDevTarget(prod)).toThrow(/production database/);
  });

  it("refuses an unknown project (allowlist, not denylist)", () => {
    expect(() => assertDevTarget("https://abcdefghijklmnopqrst.supabase.co")).toThrow(/isn't a known dev/);
  });

  it("refuses a missing or malformed URL", () => {
    expect(() => assertDevTarget("")).toThrow(/not set/);
    expect(() => assertDevTarget("not a url")).toThrow(/isn't a URL/);
  });

  it("allows the dev project and a local Supabase", () => {
    expect(assertDevTarget(dev)).toEqual({ kind: "dev", ref: DEV_PROJECT_REFS[0] });
    expect(classifyTarget("http://127.0.0.1:54321")).toEqual({ kind: "local", host: "127.0.0.1" });
  });

  it("isn't fooled by a production id in the path or a lookalike host", () => {
    expect(() => assertDevTarget(`https://evil.example.com/${PROD_PROJECT_REF}.supabase.co`)).toThrow();
    expect(projectRefFromUrl(`https://${DEV_PROJECT_REFS[0]}.supabase.co.evil.com`)).toBeNull();
  });
});
