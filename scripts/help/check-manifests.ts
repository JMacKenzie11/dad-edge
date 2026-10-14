/**
 * CI check: the committed help manifests match the UI in this commit.
 *
 * Help content is generated from these manifests (the buttons, links and
 * fields each page really has). If a PR changes a page's controls and
 * doesn't re-extract, the manifests go stale silently and nobody learns the
 * help is out of date until a man follows a step that no longer exists.
 * This re-runs the extractor and fails if anything under
 * scripts/help/manifests/ changed or appeared. Offline: no database, no
 * model calls. See docs/failure-modes.md FM-9.
 *
 *   npm run help:check-manifests
 *
 * To fix a failure: run `npm run help:extract`, commit the manifests, and
 * after the PR ships run `npm run help:check-stale` so the affected help
 * rows get regenerated into the review queue.
 */
import { spawnSync } from "node:child_process";
import { isEntryPoint } from "../lib/entry";

const MANIFESTS = "scripts/help/manifests";

export function changedManifests(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, ""));
}

function main(): void {
  const extract = spawnSync("npx", ["tsx", "scripts/help/extract-routes.ts"], { stdio: ["ignore", "ignore", "inherit"] });
  if (extract.status !== 0) {
    console.error("[help:check-manifests] the extractor failed.");
    process.exit(1);
  }
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all", "--", MANIFESTS], { encoding: "utf8" });
  const changed = changedManifests(status.stdout ?? "");
  if (changed.length === 0) {
    console.log("[help:check-manifests] manifests match the UI.");
    return;
  }
  console.error(
    `[help:check-manifests] ${changed.length} help manifest(s) don't match the UI in this commit:\n` +
      changed.map((c) => `  ${c}`).join("\n") +
      "\n\nRun `npm run help:extract`, commit the changes under scripts/help/manifests/, and after this ships run `npm run help:check-stale` to send the affected help rows back through review.",
  );
  process.exit(1);
}

if (isEntryPoint(import.meta.url)) {
  main();
}
