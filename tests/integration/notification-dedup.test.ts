import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestUser,
  deleteUsers,
  service,
  type TestUser,
} from "./helpers/supabase";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Notification dedup guarantee.
 *
 * The bell system uses a unique constraint on
 * (user_id, kind, dedup_key) with ON CONFLICT DO NOTHING at the
 * writer (enqueueNotification). This keeps re-running crons idempotent:
 * running the daily-reminders job twice on the same day drops one
 * bell row per user, not two.
 *
 * If this guarantee breaks — because the constraint is dropped, the
 * writer stops using upsert, or a new kind forgets to pass a
 * dedupKey — users start getting stacked duplicate bell rows and
 * cron re-runs become unsafe. Silent failure; the notifications look
 * fine individually. This test is the guardrail.
 */

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser("notif");
});

afterAll(async () => {
  // Cascades to notifications via FK on delete cascade.
  await deleteUsers([user.id]);
});

async function countRows(kind?: string): Promise<number> {
  const svc = service();
  let query = svc
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (kind) query = query.eq("kind", kind);
  const { count } = await query;
  return count ?? 0;
}

describe("notification dedup", () => {
  it("collapses two enqueues with the same (user, kind, dedup_key) into one row", async () => {
    const before = await countRows("daily_reminder");

    const first = await enqueueNotification({
      userId: user.id,
      kind: "daily_reminder",
      dedupKey: "2026-08-26",
      title: "Daily reminder",
      deepLink: "/today",
    });
    const second = await enqueueNotification({
      userId: user.id,
      kind: "daily_reminder",
      dedupKey: "2026-08-26",
      title: "Daily reminder (retry — should NOT double)",
      deepLink: "/today",
    });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(await countRows("daily_reminder")).toBe(before + 1);
  });

  it("keeps the ORIGINAL row on conflict — a re-run cannot overwrite title/body", async () => {
    await enqueueNotification({
      userId: user.id,
      kind: "week_lock",
      dedupKey: "2026-W35",
      title: "Original title",
      body: "Original body",
      deepLink: "/today",
    });
    await enqueueNotification({
      userId: user.id,
      kind: "week_lock",
      dedupKey: "2026-W35",
      title: "Retry title (must not win)",
      body: "Retry body (must not win)",
      deepLink: "/somewhere-else",
    });

    const svc = service();
    const { data } = await svc
      .from("notifications")
      .select("title, body, deep_link")
      .eq("user_id", user.id)
      .eq("kind", "week_lock")
      .eq("dedup_key", "2026-W35");
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("Original title");
    expect(data![0].body).toBe("Original body");
    expect(data![0].deep_link).toBe("/today");
  });

  it("treats different dedup_keys as separate notifications", async () => {
    const before = await countRows("weekly_digest");

    await enqueueNotification({
      userId: user.id,
      kind: "weekly_digest",
      dedupKey: "2026-08-17",
      title: "Digest — week 33",
      deepLink: "/leader",
    });
    await enqueueNotification({
      userId: user.id,
      kind: "weekly_digest",
      dedupKey: "2026-08-24",
      title: "Digest — week 34",
      deepLink: "/leader",
    });

    expect(await countRows("weekly_digest")).toBe(before + 2);
  });

  it("treats different kinds as separate notifications even when dedup_key matches", async () => {
    const dedup = "2026-08-26";
    const before = await countRows();

    // daily_reminder for today already exists from the first test — a
    // second insert on the SAME kind with the SAME dedup_key would
    // collide. But a DIFFERENT kind with the same dedup_key must land.
    const other = await enqueueNotification({
      userId: user.id,
      kind: "help_content_stale",
      dedupKey: dedup,
      title: "Stale help",
      deepLink: "/admin/help-content",
    });
    expect(other.inserted).toBe(true);
    expect(await countRows()).toBe(before + 1);
  });
});
