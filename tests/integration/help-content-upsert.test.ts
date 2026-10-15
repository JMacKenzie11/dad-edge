import { afterAll, describe, expect, it } from "vitest";
import { assertDevTarget } from "../../scripts/lib/target";
import { upsertHelpContent } from "../../scripts/help/generate-content";
import { service } from "./helpers/supabase";

/**
 * Regenerating a page's help replaces its row; it never adds a second one.
 *
 * Most pages have view_key null. With a plain UNIQUE constraint two nulls
 * don't conflict, so every `help:generate` run inserted another copy and
 * the help widget picked one of them at random (docs/failure-modes.md
 * FM-13). Uses the generator's own write against the dev database.
 */

const ROUTE = `/zz-help-upsert-${Date.now()}`;

describe("help:generate write", () => {
  afterAll(async () => {
    await service().from("help_content").delete().eq("route_pattern", ROUTE);
  });

  it("keeps one row per page when view_key is null, and the newest content wins", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    assertDevTarget(url);
    const target = { restUrl: `${url}/rest/v1`, key: process.env.SUPABASE_SERVICE_ROLE_KEY! };
    const row = (title: string, hash: string) => ({
      route_pattern: ROUTE,
      view_key: null,
      role: "admin",
      title,
      sections: [{ what_its_for: "A test capability for the upsert check.", steps: ["Tap **Test**."] }],
      source_hash: hash,
      voice_lint_passed: true,
    });

    await upsertHelpContent(row("First version", "aaaa"), target);
    await upsertHelpContent(row("Second version", "bbbb"), target);

    const { data, error } = await service()
      .from("help_content")
      .select("title, source_hash, reviewed")
      .eq("route_pattern", ROUTE);
    expect(error).toBeNull();
    expect(data).toEqual([{ title: "Second version", source_hash: "bbbb", reviewed: false }]);
  });
});
