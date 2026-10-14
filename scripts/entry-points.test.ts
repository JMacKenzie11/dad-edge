import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Importing a script must never run it. Every script calls main() only
 * inside `if (isEntryPoint(import.meta.url))`, and nothing at module scope
 * exits the process or throws when the environment is empty (which is
 * what CI looks like). See docs/failure-modes.md FM-8.
 */

const ROOT = join(__dirname);
const SKIP_DIRS = new Set(["manifests", "lib"]);

function scriptFiles(dir = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...scriptFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = scriptFiles();

describe("scripts: main() only runs when the file is executed", () => {
  it("found the scripts", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    it(`${rel} guards every main() call`, () => {
      const lines = readFileSync(file, "utf8").split("\n");
      const unguarded: number[] = [];
      lines.forEach((line, i) => {
        // A call, not the definition or a comment: `main()`, `main().catch`, `void main()`.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!/(^|[^\w.])main\(\)/.test(line) || /function\s+main\s*\(/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
        if (!/if \(isEntryPoint\(import\.meta\.url\)\)/.test(window)) unguarded.push(i + 1);
      });
      expect(unguarded, `unguarded main() call on line(s) ${unguarded.join(", ")}`).toEqual([]);
    });
  }
});

describe("scripts: importing one has no side effects, even with no env", () => {
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"];
  beforeAll(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) at import time`);
    }) as never);
  });
  afterAll(() => {
    for (const k of KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
    vi.restoreAllMocks();
  });

  for (const file of files) {
    const rel = relative(ROOT, file);
    it(`import ${rel}`, async () => {
      // dotenv would refill the env from .env.local; stub it for the import.
      vi.doMock("dotenv", () => ({ config: () => ({}), default: { config: () => ({}) } }));
      vi.doMock("dotenv/config", () => ({}));
      await expect(import(file)).resolves.toBeDefined();
    });
  }
});
