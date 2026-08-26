import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { manifestFilenameFor } from "@/lib/help/regenerate";

/**
 * Drift-guard: the regen job's filename convention must match the
 * extractor's, or every nightly run fails with "manifest not found"
 * for every stale row. Silent because the job STILL completes (with
 * all-failed results) and just bell-notifies admins with a dispiriting
 * "0 regenerated, N failed" — easy to write off as "the extractor is
 * broken" when actually it's a naming mismatch.
 *
 * Test approach: iterate every manifest on disk, ask
 * regenerate.ts's manifestFilenameFor to name it from its own
 * (route_pattern, view_key, role), and expect the answer to be the
 * actual filename it lives under. If the extractor's rules drift and
 * a manifest lands under a name regenerate doesn't produce, the
 * corresponding manifest is unreachable and this test catches it
 * before the cron does.
 */

const MANIFEST_DIR = path.join(process.cwd(), "scripts", "help", "manifests");

type Manifest = {
  route_pattern: string;
  view_key: string | null;
  role: string;
};

function loadAllManifests(): Array<{ filename: string; manifest: Manifest }> {
  const files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith(".json"));
  return files.map((filename) => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(MANIFEST_DIR, filename), "utf-8"),
    ) as Manifest;
    return { filename, manifest };
  });
}

describe("manifestFilenameFor — extractor / regen naming drift guard", () => {
  const cases = loadAllManifests();

  it("finds at least one manifest to check (sanity)", () => {
    // If this fails, either the manifest directory moved or nobody has
    // run `npm run help:extract`. Either way, everything below is
    // vacuous — surface it explicitly.
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "regen can name $filename from its own manifest fields",
    ({ filename, manifest }) => {
      const expected = manifestFilenameFor(
        manifest.route_pattern,
        manifest.view_key,
        manifest.role,
      );
      expect(
        expected,
        `regen produced "${expected}" but manifest is on disk as "${filename}" — ` +
          `extractor + regen filename conventions have drifted`,
      ).toBe(filename);
    },
  );
});
