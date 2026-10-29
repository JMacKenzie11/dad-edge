import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules that have to hold across files. Each reads source text and asserts
 * with a regex, so a refactor in one file can't quietly break a promise
 * made in another. When one fails, fix the code; loosening the regex to
 * get green defeats the guard.
 */

const ROOT = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "manifests") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(ROOT, "src")).map((f) => ({ rel: relative(ROOT, f), text: readFileSync(f, "utf8") }));
const codeFiles = [
  ...srcFiles,
  ...walk(join(ROOT, "scripts")).map((f) => ({ rel: relative(ROOT, f), text: readFileSync(f, "utf8") })),
  ...walk(join(ROOT, "tests")).map((f) => ({ rel: relative(ROOT, f), text: readFileSync(f, "utf8") })),
];

describe("source guards", () => {
  it("found the source", () => {
    expect(srcFiles.length).toBeGreaterThan(100);
  });

  it("no client component imports the service-role client", () => {
    // The service key bypasses every access rule; in a "use client" file it
    // would ship to the browser.
    const offenders = srcFiles
      .filter((f) => /^\s*["']use client["']/.test(f.text))
      .filter((f) => /@\/lib\/supabase\/service|createSupabaseServiceClient/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every file that inserts missions translates refusals with friendlyMissionError", () => {
    // The weekly-cap trigger refuses with a code; without the translation a
    // raw Postgres message reaches the man (docs/failure-modes.md FM-2).
    const inserters = srcFiles.filter((f) => /from\(\s*["']missions["']\s*\)\s*\.insert\(/.test(f.text));
    expect(inserters.length).toBeGreaterThanOrEqual(4);
    const offenders = inserters.filter((f) => !/friendlyMissionError\(/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("lesson PDFs are never given a public URL, and only the download route signs one", () => {
    const touching = srcFiles.filter((f) => /LESSON_FILES_BUCKET|["']lesson-files["']/.test(f.text));
    expect(touching.filter((f) => /getPublicUrl\(/.test(f.text)).map((f) => f.rel)).toEqual([]);
    const signers = touching.filter((f) => /\.createSignedUrl\(/.test(f.text)).map((f) => f.rel).sort();
    // The member download route, and the admin upload check that reads the
    // first bytes of a just-uploaded file.
    expect(signers).toEqual(["src/app/(admin)/admin/courses/actions.ts", "src/app/api/resources/files/[fileId]/route.ts"]);
  });

  it("only scripts/lib/target.ts names the production project", () => {
    const PROD = ["tybupnroikeqbqdfjaql"].join("");
    const offenders = codeFiles.filter((f) => f.text.includes(PROD) && f.rel !== join("scripts", "lib", "target.ts")).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every LLM call goes through model-config (thinking off, output floor)", () => {
    // PRODUCT_SPEC §2026-09-02: one middleware in model-config.ts turns
    // extended thinking off and floors the output budget. A model built
    // anywhere else skips it.
    const offenders = srcFiles
      .filter((f) => f.rel !== join("src", "lib", "model-config.ts"))
      .filter((f) => /@ai-sdk\/anthropic|\banthropic\(/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

describe("routes don't read files from public/ at runtime (FM-14)", () => {
  it("no file under src/app reads public/ with fs", () => {
    // Vercel doesn't bundle public/ into server functions, so a route that
    // opens public/brand/mark-white.png works locally and throws ENOENT in
    // production. Ship the file as a static asset instead.
    const offenders = srcFiles
      .filter((f) => f.rel.startsWith("src/app/"))
      .filter((f) => /readFileSync|readFile\(/.test(f.text) && /["']public["']/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("a control: the rule's regex does catch the old icon route", () => {
    const old = 'const markPath = path.join(process.cwd(), "public", "brand", "mark-white.png");\nfs.readFileSync(markPath)';
    expect(/readFileSync|readFile\(/.test(old) && /["']public["']/.test(old)).toBe(true);
  });
});

describe("which community the Community pages show", () => {
  it("the Community pages choose his community through viewer-community.ts, never the first membership row", () => {
    // A man in several communities (every platform admin) saw whichever
    // membership came back first: 11am CST Braveman instead of the
    // Business Owner Brotherhood (2026-10-27).
    const offenders = srcFiles
      .filter((f) => f.rel.startsWith("src/app/(app)/community/"))
      .filter((f) => /from\("memberships"\)[\s\S]{0,300}?\.eq\("user_id", user\.id\)[\s\S]{0,120}?\.limit\(1\)/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

