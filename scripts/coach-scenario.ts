/**
 * Coach scenario runner. Runs a real coach turn against a versioned
 * fixture and prints the transcript. No DB reads, no DB writes; the
 * fixture defines everything the coach sees (user profile summary +
 * provider blocks + optional history).
 *
 * The DB-to-context pipeline is separately unit-tested in
 * tests/coach/context.test.ts. This script is for coaching-quality
 * review: given known context, does the coach produce a reasonable
 * reply that fits the voice + method spine?
 *
 * Usage:
 *   npm run coach:scenario -- list
 *   npm run coach:scenario -- <slug>
 *
 * Example:
 *   npm run coach:scenario -- mission-steve-dinner
 *   npm run coach:scenario -- general-dave-two-fires
 *
 * Requires .env.local with:
 *   ANTHROPIC_API_KEY
 *   ANTHROPIC_MODEL           (Sonnet-tier)
 *   ANTHROPIC_UTILITY_MODEL   (Haiku-tier)
 */
import dotenv from "dotenv";
// Load .env.local explicitly — dotenv/config only auto-loads .env.
dotenv.config({ path: ".env.local" });

import { z } from "zod";
import { generateObject, type ModelMessage } from "ai";
import { mainModel } from "../src/lib/model-config";
import { systemBase, PROMPT_VERSION } from "../src/lib/coach/prompts";
import { classifyMessage, CRISIS_RESOURCES } from "../src/lib/coach/safety";
import { scrubCoachReply } from "../src/lib/coach/scrub-reply";
import type { ContextBlock } from "../src/lib/coach/context";
import { SCENARIOS, scenarioBySlug, type Scenario } from "../tests/coach/fixtures";

const PillarEnum = z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]);

const CoachReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  mission_suggestion: z
    .object({
      description: z.string().min(1).max(280),
      pillar_code: PillarEnum,
      target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .nullable(),
});

async function main() {
  const [, , arg] = process.argv;
  if (!arg || arg === "list" || arg === "--list") {
    console.log("Available scenarios:");
    for (const s of SCENARIOS) {
      console.log(`  ${s.slug.padEnd(28)}  ${s.headline}`);
    }
    console.log(
      "\nUsage: npm run coach:scenario -- <slug>",
    );
    process.exit(0);
  }

  const scenario = scenarioBySlug(arg);
  if (!scenario) {
    console.error(`No fixture with slug=${arg}. Try: npm run coach:scenario -- list`);
    process.exit(1);
  }

  console.log("\n============================================================");
  console.log(`SCENARIO · ${scenario.slug}`);
  console.log(`  ${scenario.headline}`);
  console.log("============================================================\n");

  // 1. Preview the assembled context — same shape send-message.ts
  //    would produce, but from fixture blocks instead of DB queries.
  const cacheablePrefix = renderBlocks(
    "# Live user context (stable)",
    scenario.cacheable,
  );
  const volatileBody = renderBlocks(
    "# Live user context (this turn)",
    scenario.volatile,
  );
  const totalTokenEstimate = [
    ...scenario.cacheable,
    ...scenario.volatile,
  ].reduce((sum, b) => sum + b.tokenEstimate, 0);
  const providerLabels = [...scenario.cacheable, ...scenario.volatile]
    .map((b) => b.label)
    .join(" · ");

  console.log(`Context blocks: ${providerLabels}`);
  console.log(`Total context tokens (est.): ${totalTokenEstimate}\n`);
  console.log("─── Assembled system context ──────────────────────────────");
  console.log([cacheablePrefix, volatileBody].filter(Boolean).join("\n\n"));
  console.log("───────────────────────────────────────────────────────────\n");

  if ((scenario.history?.length ?? 0) > 0) {
    console.log("─── Prior conversation ────────────────────────────────────");
    for (const t of scenario.history!) {
      console.log(`  ${t.role.toUpperCase()}: ${t.content}`);
    }
    console.log("───────────────────────────────────────────────────────────\n");
  }

  console.log(`> USER: ${scenario.userMessage}\n`);

  // 2. Safety classification pass.
  const classification = await classifyMessage(scenario.userMessage);
  const crisis =
    classification.severity === "high" || classification.severity === "critical";
  const flagsQueue =
    classification.severity === "medium" ||
    classification.severity === "high" ||
    classification.severity === "critical";

  // 3. Assemble system prompt (matches send-message.ts:buildSystemPrompt).
  const systemPromptParts: string[] = [
    `${systemBase(scenario.mode)}\n\n(prompt version: ${PROMPT_VERSION})`,
  ];
  if (cacheablePrefix) systemPromptParts.push(cacheablePrefix);
  if (volatileBody) systemPromptParts.push(volatileBody);
  if (crisis) {
    systemPromptParts.push(
      `# Crisis signal detected on this turn\nThe safety classifier flagged this message. A resource block will be automatically appended to your reply — do NOT include phone numbers or hotline text yourself. Acknowledge what he said, tell him someone from his community will reach out, and keep it short. Do not propose a mission this turn — set mission_suggestion to null.`,
    );
  }
  const systemPrompt = systemPromptParts.join("\n\n");

  const historyMessages: ModelMessage[] = (scenario.history ?? []).map((t) => ({
    role: t.role,
    content: t.content,
  }));
  const messages: ModelMessage[] = [
    ...historyMessages,
    { role: "user", content: scenario.userMessage },
  ];

  // 4. Call the coach.
  const started = Date.now();
  let reply: z.infer<typeof CoachReplySchema>;
  try {
    const result = await generateObject({
      model: mainModel(),
      schema: CoachReplySchema,
      system: systemPrompt,
      messages,
      maxOutputTokens: 1600,
    });
    reply = result.object;
    const ms = Date.now() - started;

    const scrubbed = scrubCoachReply(reply.reply);
    const finalReply = crisis
      ? `${scrubbed}\n\n${CRISIS_RESOURCES}`
      : scrubbed;

    console.log("─── Coach reply ───────────────────────────────────────────");
    console.log(finalReply);
    console.log("───────────────────────────────────────────────────────────\n");

    if (reply.mission_suggestion) {
      console.log("─── Mission suggestion ────────────────────────────────────");
      console.log(`  Pillar: ${reply.mission_suggestion.pillar_code}`);
      console.log(`  Target: ${reply.mission_suggestion.target_date}`);
      console.log(`  Text:   ${reply.mission_suggestion.description}`);
      console.log("───────────────────────────────────────────────────────────\n");
    } else {
      console.log("(no mission suggested this turn)\n");
    }

    console.log("─── Bookkeeping ───────────────────────────────────────────");
    console.log(`  Elapsed:        ${(ms / 1000).toFixed(1)}s`);
    console.log(`  Mode:           ${scenario.mode}`);
    console.log(`  Safety verdict: ${classification.severity} — ${classification.reason}`);
    console.log(`  Would enqueue?  ${flagsQueue ? "YES (medium+)" : "no"}`);
    console.log(`  Crisis append?  ${crisis ? "YES (high/critical)" : "no"}`);
    console.log(
      `  Tokens in/out:  ${result.usage?.inputTokens ?? "?"} / ${result.usage?.outputTokens ?? "?"}`,
    );
    console.log("───────────────────────────────────────────────────────────\n");
  } catch (err) {
    console.error(
      `Coach model call failed: ${err instanceof Error ? err.message : err}`,
    );
    process.exit(1);
  }
}

function renderBlocks(header: string, blocks: ContextBlock[]): string {
  if (blocks.length === 0) return "";
  return `${header}\n\n${blocks
    .map((b) => `## ${b.label}\n${b.text}`)
    .join("\n\n")}`;
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
