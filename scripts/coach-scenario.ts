/**
 * Coach scenario runner. Runs a real end-to-end coach turn against
 * a seeded member and prints the transcript — context providers,
 * token estimate, safety verdict, reply, mission suggestion,
 * allowance state. Used for the transcript deliverables in
 * Coach Context Pipeline Checkpoints B (mission mode) and
 * C (general mode).
 *
 * Usage:
 *   npm run coach:scenario -- <email> <mode> "<message>"
 *
 * Examples:
 *   npm run coach:scenario -- steve.w@example.com mission \
 *     "I want to start finally being present with my kids at dinner."
 *   npm run coach:scenario -- dave.k@example.com general \
 *     "My wife barely talks to me anymore. I don't know if it's me or her."
 *
 * Requires .env.local with:
 *   ANTHROPIC_API_KEY
 *   ANTHROPIC_MODEL           (Sonnet-tier)
 *   ANTHROPIC_UTILITY_MODEL   (Haiku-tier)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { sendCoachMessage } from "../src/lib/coach/send-message";
import { buildCoachContext } from "../src/lib/coach/context";
import type { SessionUser } from "../src/lib/session";

async function main() {
  const [, , email, modeArg, ...messageParts] = process.argv;
  const message = messageParts.join(" ");
  if (!email || !modeArg || !message) {
    console.error(
      "Usage: npm run coach:scenario -- <email> <general|mission> \"<message>\"",
    );
    process.exit(1);
  }
  if (modeArg !== "general" && modeArg !== "mission") {
    console.error(`Bad mode: ${modeArg}. Must be 'general' or 'mission'.`);
    process.exit(1);
  }
  const mode = modeArg as "general" | "mission";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // 1. Load the seeded user by email. `canceled_at` maps to
  //    SessionUser.deactivated_at (the entitlement layer renamed it).
  const { data: userRow, error: userErr } = await sb
    .from("users")
    .select(
      "id, email, first_name, last_name, timezone, is_platform_admin, subscription_status, canceled_at, onboarding_step, occupation, employment_type",
    )
    .eq("email", email)
    .maybeSingle();
  if (userErr || !userRow) {
    console.error(
      `No user with email=${email}. Have you run \`npm run seed\`?`,
    );
    process.exit(1);
  }
  const row = userRow as {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    timezone: string;
    is_platform_admin: boolean;
    subscription_status: SessionUser["subscription_status"];
    canceled_at: string | null;
    onboarding_step: number;
    occupation: string | null;
    employment_type: SessionUser["employment_type"];
  };
  const user: SessionUser = {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    timezone: row.timezone,
    is_platform_admin: row.is_platform_admin,
    subscription_status: row.subscription_status,
    deactivated_at: row.canceled_at,
    onboarding_step: row.onboarding_step,
    occupation: row.occupation,
    employment_type: row.employment_type,
  };

  // 2. Print the assembled context first — this is the "what the coach
  //    knew" transparency the spec asks for. Preview only; sendCoachMessage
  //    will re-run the pipeline internally.
  console.log("\n============================================================");
  console.log(
    `SCENARIO · ${email} · ${mode.toUpperCase()} MODE`,
  );
  console.log("============================================================\n");
  const assembled = await buildCoachContext(user);
  console.log(`Providers that contributed: ${assembled.providerKeys.join(", ")}`);
  console.log(`Total context tokens (est.): ${assembled.tokenEstimate}\n`);
  console.log("─── System-prompt context ─────────────────────────────────");
  console.log(assembled.systemContextText);
  console.log("───────────────────────────────────────────────────────────\n");

  // 3. Ensure a fresh conversation for this run.
  const { data: convo, error: convoErr } = await sb
    .from("coach_conversations")
    .insert({ user_id: user.id, mode })
    .select("id")
    .single();
  if (convoErr || !convo) {
    console.error(`Could not create conversation: ${convoErr?.message}`);
    process.exit(1);
  }
  const conversationId = (convo as { id: string }).id;

  // 4. Run the coach turn end to end.
  console.log(`> USER (${mode}): ${message}\n`);
  const started = Date.now();
  let result;
  try {
    result = await sendCoachMessage({
      user,
      conversationId,
      userText: message,
    });
  } catch (err) {
    console.error(
      `sendCoachMessage threw: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
  const ms = Date.now() - started;

  // 5. Print the results.
  console.log("─── Coach reply ───────────────────────────────────────────");
  console.log(result.reply);
  console.log("───────────────────────────────────────────────────────────\n");
  if (result.missionSuggestion) {
    console.log("─── Mission suggestion ────────────────────────────────────");
    console.log(`  Pillar: ${result.missionSuggestion.pillar_code}`);
    console.log(`  Target: ${result.missionSuggestion.target_date}`);
    console.log(`  Text:   ${result.missionSuggestion.description}`);
    console.log("───────────────────────────────────────────────────────────\n");
  } else {
    console.log("(no mission suggested this turn)\n");
  }

  // 6. Pull the assistant message row to read the metadata we just wrote.
  const { data: asst } = await sb
    .from("coach_messages")
    .select("metadata")
    .eq("id", result.assistantMessageId)
    .maybeSingle();
  const metadata = (asst as { metadata: unknown } | null)?.metadata;

  console.log("─── Bookkeeping ───────────────────────────────────────────");
  console.log(`  Elapsed:      ${(ms / 1000).toFixed(1)}s`);
  console.log(
    `  Crisis flag:  ${result.crisis ? "YES — flagged for admin review" : "no"}`,
  );
  console.log(
    `  Allowance:    ${result.allowance.used}/${result.allowance.softCap} used (bucket: ${result.allowance.bucket})`,
  );
  console.log(`  Assistant message id: ${result.assistantMessageId}`);
  console.log(`  Conversation id:      ${conversationId}`);
  if (metadata) {
    console.log(`  Metadata written:`);
    console.log(JSON.stringify(metadata, null, 2).split("\n").map((l) => `    ${l}`).join("\n"));
  }
  console.log("───────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
