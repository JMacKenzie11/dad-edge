import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";

/**
 * The whole challenge loop in the browser: the leader sets one, the
 * member joins from Today, marks today done on Missions (the day row
 * starts empty; days still to come can't be marked), sees his days on
 * Community > Challenges, and leaves. Cleans up the challenge and its missions at the end. Dev
 * database only (docs/e2e.md).
 *
 * E2E_SHOTS=<dir> also saves screenshots of each screen.
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

const chicagoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("a leader sets a challenge; a member joins, marks today done and leaves", async ({ asLeader, asMember }) => {
  test.setTimeout(180_000);
  const shots = process.env.E2E_SHOTS;
  const name = `E2E Challenge ${Date.now().toString(36)}`;
  const today = chicagoToday();
  const db = svc();
  const { data: member } = await db.from("users").select("id").ilike("email", credentialsFor("member").email).single();

  try {
    // Leader: set it, every day (M W F are picked by default), any 3
    // count, two weeks from today.
    await asLeader.goto("/leader/challenges");
    await asLeader.fill('input[name="name"]', name);
    await asLeader.fill('input[name="mission_description"]', "Phone in a drawer by 8pm");
    await asLeader.selectOption('select[name="pillar_code"]', "E");
    for (const day of ["Tuesday", "Thursday", "Saturday", "Sunday"]) await asLeader.getByLabel(day, { exact: true }).check({ force: true });
    await asLeader.selectOption('select[name="target"]', "3");
    await asLeader.fill('input[name="starts_on"]', today);
    await asLeader.fill('input[name="ends_on"]', plusDays(today, 13));
    if (shots) await asLeader.screenshot({ path: `${shots}/1-leader-new-challenge.png`, fullPage: true });
    await asLeader.getByRole("button", { name: "CREATE CHALLENGE" }).click();
    await expect(asLeader.getByText("Saved.")).toBeVisible();
    await expect(asLeader.locator("li", { hasText: name })).toContainText("0 in");

    // Member: the card on Today.
    await asMember.goto("/today");
    const card = asMember.getByRole("region", { name: `Challenge: ${name}` });
    await expect(card).toContainText("Phone in a drawer by 8pm · Any 3 days each week");
    await expect(card.getByRole("button", { name: "NOT FOR ME" })).toBeVisible();
    if (shots) await card.screenshot({ path: `${shots}/2-member-join-card.png` });
    await card.getByRole("button", { name: "I'M IN" }).click();
    await expect(card).toContainText(/You.re in\./);

    // Missions: a challenge mission in the Enjoyment row, no coach score,
    // no carry, delete or COMPLETE.
    await asMember.goto("/missions");
    const row = asMember.locator("li", { hasText: `⚑ CHALLENGE · ${name.toUpperCase()}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Phone in a drawer by 8pm");
    await expect(row.getByRole("button", { name: /\/10/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: /NEXT WEEK/ })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Delete mission" })).toHaveCount(0);
    await expect(row.locator("textarea")).toHaveCount(0);
    await expect(row.getByRole("button", { name: "COMPLETE" })).toHaveCount(0);
    // The same M T W T F S S row as other missions, nothing marked yet.
    // Days before he joined are greyed; today can be marked, later days
    // can't yet.
    const days = row.getByRole("group", { name: "Challenge days done" });
    const isoDow = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const daysLeft = 8 - isoDow;
    const weekTarget = Math.min(3, daysLeft);
    await expect(days.locator('[data-challenge-day="off"]')).toHaveCount(isoDow - 1);
    await expect(days.getByRole("checkbox")).toHaveCount(daysLeft);
    await expect(days.locator('[aria-checked="true"]')).toHaveCount(0);
    await expect(days.locator('[data-challenge-day="later"]')).toHaveCount(daysLeft - 1);
    if (daysLeft > 1) await expect(days.getByRole("checkbox").nth(1)).toBeDisabled();
    await expect(row.locator("[data-challenge-progress]")).toContainText("Tap a day once you\u2019ve done it.");
    if (shots) await asMember.locator("section", { hasText: "ENJOYMENT" }).last().screenshot({ path: `${shots}/3-member-mission-row.png` });

    // Mark today, take it back, mark it again.
    const todayBox = days.getByRole("checkbox").first();
    await todayBox.click();
    await expect(todayBox).toHaveAttribute("aria-checked", "true");
    await expect(row.locator("[data-challenge-progress]")).toContainText(weekTarget === 1 ? "Done: 1 of 1 days." : `1 of ${weekTarget} done.`);
    await todayBox.click();
    await expect(todayBox).toHaveAttribute("aria-checked", "false");
    await todayBox.click();
    await expect(todayBox).toHaveAttribute("aria-checked", "true");
    if (shots) await asMember.locator("section", { hasText: "ENJOYMENT" }).last().screenshot({ path: `${shots}/3b-member-today-marked.png` });
    // It saved: still marked after a reload.
    await asMember.reload();
    await expect(asMember.locator("li", { hasText: `⚑ CHALLENGE · ${name.toUpperCase()}` }).getByRole("group", { name: "Challenge days done" }).locator('[aria-checked="true"]')).toHaveCount(1);

    // Community > Challenges: his row counts today's day.
    await asMember.goto("/community?tab=challenges");
    const board = asMember.getByRole("region", { name: `Challenge: ${name}` });
    const mine = board.locator("li", { hasText: "(YOU)" });
    // He joined today and ticked today: one day of one so far.
    await expect(mine.locator("[data-days-done]")).toHaveText("1 OF 1 DAYS");
    await expect(mine.locator('[data-week-ticks="1"]')).toHaveCount(1);
    await expect(mine.locator(`[data-week-state="${weekTarget === 1 ? "done" : "open"}"]`)).toHaveCount(1);
    if (shots) await board.screenshot({ path: `${shots}/4-member-board.png` });

    // Leaving, removing what's left: the board offers I'M IN again.
    await board.getByRole("button", { name: "LEAVE CHALLENGE" }).click();
    await board.getByRole("button", { name: "REMOVE MY UPCOMING CHALLENGE MISSIONS" }).click();
    await expect(board.getByRole("button", { name: "I'M IN" })).toBeVisible();
    await expect(board.locator("li", { hasText: "(YOU)" })).toHaveCount(0);
  } finally {
    const { data: ch } = await db.from("challenges").select("id").eq("name", name).maybeSingle();
    if (ch) {
      await db.from("missions").delete().eq("user_id", member!.id).eq("challenge_id", ch.id);
      await db.from("challenges").delete().eq("id", ch.id);
    }
    await db.from("missions").delete().eq("user_id", member!.id).eq("description", "Phone in a drawer by 8pm");
  }
});

test("an admin sets a challenge from Admin > Challenges and can join it", async ({ asAdmin }) => {
  test.setTimeout(120_000);
  const name = `E2E Admin Challenge ${Date.now().toString(36)}`;
  const today = chicagoToday();
  const db = svc();
  try {
    await asAdmin.goto("/admin");
    await asAdmin.getByRole("link", { name: "CHALLENGES", exact: true }).click();
    await asAdmin.waitForURL("**/admin/challenges");
    await asAdmin.selectOption('select[name="community_id"]', { label: "E2E Basecamp" });
    await asAdmin.fill('input[name="name"]', name);
    await asAdmin.fill('input[name="mission_description"]', "Lights out by 10pm");
    await asAdmin.selectOption('select[name="pillar_code"]', "V");
    await asAdmin.fill('input[name="starts_on"]', today);
    await asAdmin.fill('input[name="ends_on"]', plusDays(today, 13));
    await asAdmin.getByRole("button", { name: "CREATE CHALLENGE" }).click();
    await asAdmin.waitForURL("**/admin/challenges?saved=1");
    await expect(asAdmin.locator("li", { hasText: name })).toContainText("E2E Basecamp");

    await asAdmin.goto("/today");
    const card = asAdmin.getByRole("region", { name: `Challenge: ${name}` });
    await card.getByRole("button", { name: "I'M IN" }).click();
    await expect(card).toContainText(/You.re in\./);
    await asAdmin.goto("/community?tab=challenges");
    await expect(asAdmin.getByRole("region", { name: `Challenge: ${name}` }).locator("li", { hasText: "(YOU)" })).toBeVisible();
  } finally {
    const { data: ch } = await db.from("challenges").select("id").eq("name", name).maybeSingle();
    if (ch) {
      await db.from("missions").delete().eq("challenge_id", ch.id);
      await db.from("challenges").delete().eq("id", ch.id);
    }
  }
});
