import { createClient } from "@supabase/supabase-js";
import { test, expect, credentialsFor } from "./fixtures";
import { getCurrentQuarter } from "../src/lib/scoring/quarters";

/**
 * People cards (DECISIONS.md "People cards show goals and quarter
 * missions"): another man in his community sees his goal wording on the
 * card, cut to one line until tapped, and the quarter's MISSIONS and ON
 * GOALS numbers. Dev database only (docs/e2e.md).
 */
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

test("his community sees his goal and the quarter's mission numbers", async ({ asLeader: page }) => {
  const db = svc();
  const { data: u } = await db.from("users").select("id, first_name, last_name").ilike("email", credentialsFor("member").email).single();
  const q = getCurrentQuarter();
  const { data: existing } = await db.from("quarterly_goals").select("id, desired_end_state").eq("user_id", u!.id).eq("quarter_start", q.startIso).eq("status", "active").limit(1);
  let made: string | null = null;
  let text = existing?.[0]?.desired_end_state as string | undefined;
  if (!text) {
    text = "By the end of the quarter, I've had 12 one-on-one outings with my kids, phone in the car.";
    const ins = await db.from("quarterly_goals").insert({ user_id: u!.id, quarter_start: q.startIso, focus_area: "R", desired_end_state: text, status: "active" }).select("id").single();
    made = ins.data!.id;
  }
  try {
    await page.goto("/community?tab=people");
    const name = [u!.first_name, u!.last_name].filter(Boolean).join(" ");
    const card = page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
    const goal = card.getByRole("button", { name: new RegExp(text.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(goal).toBeVisible();
    await expect(goal).toHaveAttribute("aria-expanded", "false");
    await goal.click();
    await expect(goal).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByText("ON GOALS")).toBeVisible();
    await expect(page.getByText(`MISSIONS and ON GOALS count ${q.label} so far.`, { exact: false })).toBeVisible();
  } finally {
    if (made) await db.from("quarterly_goals").delete().eq("id", made);
  }
});
