import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isEntryPoint } from "./entry";

describe("isEntryPoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "entry-"));
  const file = join(dir, "script.ts");
  writeFileSync(file, "");

  it("is true when argv[1] is this file", () => {
    expect(isEntryPoint(pathToFileURL(file).href, file)).toBe(true);
  });

  it("matches through a symlink", () => {
    const link = join(dir, "link.ts");
    symlinkSync(file, link);
    expect(isEntryPoint(pathToFileURL(file).href, link)).toBe(true);
  });

  it("is false for another file, a missing argv, or under the test runner", () => {
    expect(isEntryPoint(pathToFileURL(file).href, join(dir, "other.ts"))).toBe(false);
    expect(isEntryPoint(pathToFileURL(file).href, undefined)).toBe(false);
    expect(isEntryPoint(import.meta.url)).toBe(false);
  });
});
