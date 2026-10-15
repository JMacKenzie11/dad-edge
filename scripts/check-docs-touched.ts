/**
 * Docs-in-the-same-PR gate (.github/workflows/docs.yml).
 *
 * A PR that changes how the app behaves, who can do what, or how it's
 * operated updates the docs in the same PR. Docs written "later" don't get
 * written, and PRODUCT_SPEC.md stops describing what IS.
 *
 *   npx tsx scripts/check-docs-touched.ts --files <changed.txt> --body <pr-body.md>
 *
 * Passes when no source changed, when a doc changed, or when the PR body has
 * a line `Docs-exempt: <reason>` (for pure refactors, test-only fixes, and
 * the like). The workflow writes the PR body to a file through an env var;
 * it is never interpolated into a shell command.
 */
import { readFileSync } from "node:fs";
import { isEntryPoint } from "./lib/entry";

/** Files whose change means "the docs were updated". */
const DOC_PATTERNS: RegExp[] = [
  /^docs\//,
  /^CLAUDE\.md$/,
  /^README\.md$/,
  // This repo's product spec and decision log live at the root.
  /^PRODUCT_SPEC\.md$/,
  /^DECISIONS\.md$/,
];

/** src/ code files, minus tests and stylesheets. */
export function isSourceFile(path: string): boolean {
  if (!/^src\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return false;
  if (/\.test\.[^/]+$/.test(path)) return false;
  return true;
}

export function isDocFile(path: string): boolean {
  return DOC_PATTERNS.some((re) => re.test(path));
}

/** The reason from a `Docs-exempt: <reason>` line, or null. */
export function exemptionReason(body: string): string | null {
  const m = body.match(/^\s*Docs-exempt:[ \t]*(\S[^\r\n]*)$/im);
  return m ? m[1].trim() : null;
}

export type Decision =
  | { ok: true; reason: "no-source" | "docs-updated" | "exempt"; detail: string }
  | { ok: false; reason: "docs-missing"; detail: string; sourceFiles: string[] };

export const WHERE_IT_BELONGS = [
  "What the app does (routes, rules, data model, permissions): PRODUCT_SPEC.md, the section for that area.",
  "A judgment call or a default someone may want to change: DECISIONS.md.",
  "How to work in this repo (commands, rules, process): CLAUDE.md or README.md.",
  "An incident and the check it produced: docs/failure-modes.md.",
  "Steps a member takes on screen: help content, regenerated through the help pipeline (npm run help:extract, then help:check-stale), not written by hand. Help covers what he does, never how it works underneath.",
];

export function decide({ files, body }: { files: string[]; body: string }): Decision {
  const changed = files.map((f) => f.trim()).filter(Boolean);
  const source = changed.filter(isSourceFile);
  if (source.length === 0) return { ok: true, reason: "no-source", detail: "No source files changed." };
  const docs = changed.filter(isDocFile);
  if (docs.length > 0) return { ok: true, reason: "docs-updated", detail: `Docs updated: ${docs.join(", ")}` };
  const exempt = exemptionReason(body);
  if (exempt) return { ok: true, reason: "exempt", detail: `Docs-exempt: ${exempt}` };
  return {
    ok: false,
    reason: "docs-missing",
    sourceFiles: source,
    detail:
      `This PR changes ${source.length} source file(s) and no docs:\n` +
      source.map((f) => `  ${f}`).join("\n") +
      "\n\nUpdate the doc each change belongs in:\n" +
      WHERE_IT_BELONGS.map((w) => `  - ${w}`).join("\n") +
      "\n\nIf nothing a reader of the docs would notice changed (a refactor, a test fix), add a line to the PR description:\n  Docs-exempt: <the reason>",
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const filesPath = arg("files");
  const bodyPath = arg("body");
  if (!filesPath || !bodyPath) {
    console.error("Usage: check-docs-touched --files <changed.txt> --body <pr-body.md>");
    process.exit(2);
  }
  const files = readFileSync(filesPath, "utf8").split("\n");
  const body = readFileSync(bodyPath, "utf8");
  const d = decide({ files, body });
  if (d.ok) {
    console.log(`[docs gate] pass: ${d.detail}`);
    return;
  }
  console.error(`[docs gate] fail\n${d.detail}`);
  process.exit(1);
}

if (isEntryPoint(import.meta.url)) {
  main();
}
