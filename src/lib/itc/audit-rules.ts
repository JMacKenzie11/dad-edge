/**
 * Deterministic audit rules for the "HONE THIS MAP" flow.
 *
 * The prose-only whole-map audit was hallucinating quotes, applying
 * critiques to entries that didn't have the issue, and pushing bad
 * recommendations. This file rebuilds it as twelve typed checks. Each
 * check is a pure function of the map slice it needs and returns
 * `AuditFinding[]`. A downstream synthesis LLM call converts the
 * finding list into coach prose (see `synthesizeAuditProse` in
 * `coach.ts`), but the LLM is only allowed to narrate findings that
 * these checks produced. It cannot invent new ones.
 *
 * Two flavors of check:
 *   - Deterministic (regex / heuristic / stored-score) — return
 *     synchronously (wrapped in async for uniform composition).
 *   - LLM-backed (utilityModel + generateObject) — narrow structured
 *     judgment calls where a regex would misfire.
 *
 * Fail-open: if a per-check LLM call throws, log a warning and return
 * an empty array from that check. One flaky per-check LLM call must
 * not break the whole audit.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type {
  ItcAssumption,
  ItcAssumptionCommitment,
  ItcBehavior,
  ItcCommitment,
  ItcTest,
  ItcTestResult,
  ItcWorry,
} from "./maps";
import { COMMITMENT_STEM, ensureCommitmentStem } from "./stage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditIssueType =
  | "bundled_goal"
  | "interior_witness_worry"
  | "interior_witness_commitment"
  | "missing_commitment_stem"
  | "vague_assumption_then_clause"
  | "depth_shortfall_worry"
  | "depth_shortfall_commitment"
  | "depth_shortfall_assumption"
  | "assumption_commitment_drift"
  | "assumption_overload"
  | "assumption_uncovered_commitment"
  | "test_coverage_gap"
  | "test_grip_through_data"
  | "worry_commitment_redundancy";

export type AuditEntryRef =
  | { table: "goal"; id: string }
  | { table: "worries"; id: string }
  | { table: "commitments"; id: string }
  | { table: "assumptions"; id: string }
  | { table: "tests"; id: string }
  | { table: "map"; id: string };

export type AuditSeverity = "critical" | "moderate" | "observation";

export type AuditFinding = {
  entryRef: AuditEntryRef;
  issueType: AuditIssueType;
  severity: AuditSeverity;
  /** Verbatim quote of the source entry text (or a specific field).
   *  Never paraphrased. The synthesis LLM uses this to quote entries
   *  accurately, so any drift here corrupts the audit. */
  actualText: string;
  /** Machine-readable description of what's wrong. The synthesis LLM
   *  translates this into coach voice. */
  detail: string;
  /** Optional concrete rewrite suggestion. When present the synthesis
   *  LLM should surface it. */
  suggestedFix?: string;
  /** Optional cross-entry context (e.g. the paired commitment for a
   *  drifted assumption). */
  relatedEntryRef?: AuditEntryRef;
  relatedText?: string;
};

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  critical: 0,
  moderate: 1,
  observation: 2,
};

// ---------------------------------------------------------------------------
// 1. Bundled goal (heuristic + LLM verify)
// ---------------------------------------------------------------------------

const BundledGoalSchema = z.object({
  bundled: z.boolean(),
  first_half: z.string().optional(),
  second_half: z.string().optional(),
});

const BUNDLED_GOAL_SYSTEM = `
You are a strict classifier for Column 1 improvement goals in an Immunity to Change map. A "bundled" goal packs two distinct improvements into one sentence, pointed at different objects or audiences, joined by "and". Bundled goals produce muddy behaviors and untestable tests because each half implies a different behavior set.

Not bundled: one improvement, even if it uses "and" for pacing. "getting better at listening and staying present with my wife" is one improvement (both verbs point at the same relationship). "getting better at coaching my team and building my business" is bundled (two audiences, two improvement areas).

Return bundled=true only when the two halves clearly point at DIFFERENT objects/audiences/domains. When in doubt, false.

If bundled=true, split the goal into first_half and second_half. Each half should stand on its own as a plausible Column 1 goal (may need a leading "getting better at" or similar to read naturally, but keep the coachee's own words).
`.trim();

/**
 * Heuristic: goal text mentions two distinct object nouns joined by
 * "and". Cheap tripwire that prevents an LLM verify call on every
 * single-improvement goal. False positives here are corrected by the
 * verify call; false negatives (a bundled goal that doesn't match the
 * heuristic) fall through to no-finding, which is the safe default.
 */
function goalLooksBundled(goalText: string): boolean {
  const trimmed = goalText.trim();
  if (trimmed.length === 0) return false;
  // "... and ..." with a verb phrase or noun on each side.
  if (!/\band\b/i.test(trimmed)) return false;
  // Two verbs (present or gerund) as a rough signal that both halves
  // carry their own action. "listening and speaking" = two verbs.
  const verbCount = (
    trimmed.match(/\b(?:ing|listening|speaking|coaching|building|running|leading|making)\b/gi) ??
    []
  ).length;
  if (verbCount >= 2) return true;
  // "at X and Y" pattern where X and Y are different noun phrases.
  const atAndMatch = trimmed.match(
    /\bat\s+[\w\s]{3,40}\s+and\s+[\w\s]{3,40}\b/i,
  );
  if (atAndMatch) return true;
  return false;
}

export async function checkBundledGoal(input: {
  mapId: string;
  goalText: string;
}): Promise<AuditFinding[]> {
  if (!input.goalText || input.goalText.trim().length === 0) return [];
  if (!goalLooksBundled(input.goalText)) return [];
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: BundledGoalSchema,
      system: BUNDLED_GOAL_SYSTEM,
      prompt: `Improvement goal: ${input.goalText}`,
      maxOutputTokens: 400,
      temperature: 0.1,
    });
    if (!object.bundled) return [];
    const fix =
      object.first_half && object.second_half
        ? `Pick one for this map. First half: "${object.first_half.trim()}". Second half: "${object.second_half.trim()}". Run the other in a later map.`
        : undefined;
    return [
      {
        entryRef: { table: "goal", id: input.mapId },
        issueType: "bundled_goal",
        severity: "critical",
        actualText: input.goalText,
        detail:
          "Goal packs two distinct improvements pointed at different objects. Each half implies a different behavior set, so the whole map ends up muddy.",
        suggestedFix: fix,
      },
    ];
  } catch (err) {
    console.warn(
      "[itc audit] checkBundledGoal failed: %s",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. Interior-witness in worries (regex)
// ---------------------------------------------------------------------------

/**
 * Interior-witness verbs applied to a self-truth: "I'd have to see I've
 * been running", "I'd know I chose myself". The identity landing lives
 * inside the coachee's head rather than in something the outside world
 * could witness. Sharper form flips to external witness ("she'd see...",
 * "she'd say...").
 *
 * Trip only when the interior verb is followed by a self-referential
 * object ("I", "my", "mine", "myself", or a bare present-tense self
 * claim). Cuts false positives like "I'd have to see her" where the
 * object is another person, not a self-truth.
 */
const INTERIOR_WITNESS_WORRY_RE =
  /\bI\s?['\u2019]?d\s+(?:have\s+to\s+)?(?:see|know|feel|face|admit|hear|realize|understand|accept)\s+(?:that\s+)?(?:I\b|my\b|mine\b|myself\b)/i;

function pickExternalPronounForWorries(
  otherWorries: ItcWorry[],
  behaviors: ItcBehavior[],
): string {
  // Prefer whatever pronoun the coachee has already used in another
  // worry or a behavior. Fall back to "they" when nothing usable is on
  // the map.
  const corpus = [
    ...otherWorries.map((w) => w.text),
    ...behaviors.map((b) => b.text),
  ].join(" ");
  if (/\b(she'?d|she'?ll|she\s+would|\bshe\s+says\b|\bshe\b|her\b)/i.test(corpus)) {
    return "she'd";
  }
  if (/\b(he'?d|he'?ll|he\s+would|\bhe\s+says\b|\bhe\b|him\b)/i.test(corpus)) {
    return "he'd";
  }
  if (/\bmy\s+team\b|\bthey\b|\bthem\b/i.test(corpus)) {
    return "they'd";
  }
  return "they'd";
}

export async function checkInteriorWitnessInWorries(input: {
  worries: ItcWorry[];
  behaviors?: ItcBehavior[];
}): Promise<AuditFinding[]> {
  const behaviors = input.behaviors ?? [];
  const findings: AuditFinding[] = [];
  for (const worry of input.worries) {
    if (!INTERIOR_WITNESS_WORRY_RE.test(worry.text)) continue;
    const others = input.worries.filter((w) => w.id !== worry.id);
    const pronoun = pickExternalPronounForWorries(others, behaviors);
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "interior_witness_worry",
      severity: "moderate",
      actualText: worry.text,
      detail:
        "Worry uses an interior-witness verb applied to a self-truth. The identity landing lives inside the coachee's head rather than in something the outside world could witness.",
      suggestedFix: `Flip to an external witness. Instead of "I'd have to see/know/face...", try "${pronoun} see..." or "${pronoun} say it out loud...". Let the outside world be the one who registers it.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 3. Interior-witness in commitments (regex)
// ---------------------------------------------------------------------------

const INTERIOR_WITNESS_COMMITMENT_PATTERNS: RegExp[] = [
  /\bnever\s+(?:seeing|knowing|feeling|facing|admitting|hearing|realizing|accepting)\b/i,
  /\bavoiding\s+the\s+feeling\s+that\b/i,
  /\bhaving\s+to\s+(?:see|know|believe|face|feel|admit)\b/i,
  /\bso\s+I\s+never\s+have\s+to\s+(?:see|know|believe|face|feel|admit)\b/i,
  /\bprotecting\s+myself\s+from\s+having\s+to\b/i,
];

export async function checkInteriorWitnessInCommitments(input: {
  commitments: ItcCommitment[];
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const commitment of input.commitments) {
    const matched = INTERIOR_WITNESS_COMMITMENT_PATTERNS.some((re) =>
      re.test(commitment.text),
    );
    if (!matched) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "interior_witness_commitment",
      severity: "moderate",
      actualText: commitment.text,
      detail:
        "Commitment is framed around avoiding a feeling or an interior reckoning. The sharper form names the identity being protected AND what the outside world would see the coachee take the hit on.",
      suggestedFix:
        "Name the identity itself, not the feeling around it. Something like \"I'm also committed to never being the [role] who [observable action a friend on his shoulder would see]\".",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 4. Missing canonical commitment stem (regex)
// ---------------------------------------------------------------------------

const COMMITMENT_STEM_RE = /^\s*i\s?['\u2019]?m\s+also\s+committed\s+to\b/i;

export async function checkMissingCommitmentStem(input: {
  commitments: ItcCommitment[];
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const commitment of input.commitments) {
    if (COMMITMENT_STEM_RE.test(commitment.text)) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "missing_commitment_stem",
      severity: "moderate",
      actualText: commitment.text,
      detail: `Commitment does not start with the canonical stem "${COMMITMENT_STEM}...". The "also" is load-bearing because it names this as the SECOND commitment sitting next to the improvement goal.`,
      suggestedFix: ensureCommitmentStem(commitment.text),
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 5. Vague assumption then-clause (regex)
// ---------------------------------------------------------------------------

const VAGUE_THEN_CLAUSE_PATTERNS: RegExp[] = [
  /\bthe\s+(?:person|man|husband|father|coach|guy|dad)\s+(?:I\s?['\u2019]?m\s+terrified|I\s+fear|I\s+don['\u2019]?t\s+want\s+to|I\s?['\u2019]?d\s+hate\s+to)\b/i,
  /\bwhat\s+I(?:\s?['\u2019]?m\s+afraid|\s+fear)\b/i,
  /\bI\s?['\u2019]?d\s+become\s+(?:what|who)\s+I\b/i,
  /\bI\s?['\u2019]?d\s+be\s+the\s+(?:person|man|guy|dad|husband|father|coach)\s+I\b/i,
];

/**
 * Split the assumption text into if- and then- halves. Returns the
 * then-half only. Kegan format is "I assume that if I ..., then ...".
 * Some coachees drop the comma; handle both.
 */
function extractThenClause(text: string): string | null {
  const commaThen = text.match(/,\s*then\s+(.+)$/i);
  if (commaThen) return commaThen[1].trim();
  const bareThen = text.match(/\bthen\s+(.+)$/i);
  if (bareThen) return bareThen[1].trim();
  return null;
}

export async function checkVagueAssumptionThenClause(input: {
  assumptions: ItcAssumption[];
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  for (const assumption of input.assumptions) {
    const thenClause = extractThenClause(assumption.text);
    if (!thenClause) continue;
    const matched = VAGUE_THEN_CLAUSE_PATTERNS.some((re) => re.test(thenClause));
    if (!matched) continue;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "vague_assumption_then_clause",
      severity: "moderate",
      actualText: assumption.text,
      detail:
        "Then-clause gestures at an identity ('the man I'm terrified of', 'what I fear I am') without naming it. Vague then-clauses do not test — there's no concrete identity claim to gather evidence against.",
      suggestedFix:
        "Name the identity itself. Instead of \"the guy I don't want to be\", write out what that guy actually is (\"the guy whose team stopped bringing him hard problems\", \"the dad whose kids don't call\").",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 6. Depth shortfall (stored score, three issue types)
// ---------------------------------------------------------------------------

const DEPTH_THRESHOLD = 3;

export async function checkDepthShortfall(input: {
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  for (const worry of input.worries) {
    if (worry.depth_score == null) continue;
    if (worry.depth_score >= DEPTH_THRESHOLD) continue;
    const detail = worry.rubric_reason
      ? `Worry hasn't reached identity depth yet. Rubric reason: ${worry.rubric_reason}`
      : "Worry hasn't reached identity depth yet. The fear needs to land on who he'd be, not on the immediate consequence.";
    findings.push({
      entryRef: { table: "worries", id: worry.id },
      issueType: "depth_shortfall_worry",
      severity: "critical",
      actualText: worry.text,
      detail,
    });
  }

  for (const commitment of input.commitments) {
    if (commitment.depth_score == null) continue;
    if (commitment.depth_score >= DEPTH_THRESHOLD) continue;
    const detail = commitment.rubric_reason
      ? `Commitment hasn't reached identity depth yet. Rubric reason: ${commitment.rubric_reason}`
      : "Commitment hasn't reached identity depth yet. The vow needs to name the identity being protected and what the outside world would see.";
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "depth_shortfall_commitment",
      severity: "critical",
      actualText: commitment.text,
      detail,
    });
  }

  for (const assumption of input.assumptions) {
    if (assumption.depth_score == null) continue;
    if (assumption.depth_score >= DEPTH_THRESHOLD) continue;
    const detail = assumption.rubric_reason
      ? `Big Assumption hasn't reached identity depth yet. Rubric reason: ${assumption.rubric_reason}`
      : "Big Assumption hasn't reached identity depth yet. The 'then' half needs to finish through to an identity landing or a Big Time Bad conclusion.";
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "depth_shortfall_assumption",
      severity: "critical",
      actualText: assumption.text,
      detail,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 7. Assumption coverage across commitments (deterministic)
// ---------------------------------------------------------------------------

export async function checkAssumptionCoverage(input: {
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  links: ItcAssumptionCommitment[];
}): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];
  const linkedCommitmentIds = new Set(input.links.map((l) => l.commitment_id));
  for (const commitment of input.commitments) {
    if (linkedCommitmentIds.has(commitment.id)) continue;
    findings.push({
      entryRef: { table: "commitments", id: commitment.id },
      issueType: "assumption_uncovered_commitment",
      severity: "critical",
      actualText: commitment.text,
      detail:
        "No Big Assumption is linked to this competing commitment. The commitment is protecting something the coachee hasn't yet named as a testable belief, so nothing about it can be challenged with evidence.",
      suggestedFix:
        "Draft a Big Assumption whose if-clause names the exact scenario this commitment is protecting against, and whose then-clause names the identity or Big Time Bad conclusion the commitment fears.",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 8. Test coverage per assumption (deterministic)
// ---------------------------------------------------------------------------

export async function checkTestCoverage(input: {
  assumptions: ItcAssumption[];
  tests: ItcTest[];
}): Promise<AuditFinding[]> {
  const activeTests = input.tests.filter((t) => t.status !== "abandoned");
  const testCountByAssumption = new Map<string, number>();
  for (const t of activeTests) {
    testCountByAssumption.set(
      t.assumption_id,
      (testCountByAssumption.get(t.assumption_id) ?? 0) + 1,
    );
  }
  const findings: AuditFinding[] = [];
  const totalAssumptions = input.assumptions.length;
  for (const assumption of input.assumptions) {
    const count = testCountByAssumption.get(assumption.id) ?? 0;
    if (count > 0) continue;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "test_coverage_gap",
      severity: "moderate",
      actualText: assumption.text,
      detail: `No active test on this assumption (map has ${totalAssumptions} assumption${totalAssumptions === 1 ? "" : "s"} total). Untested assumptions still shape the coachee's behavior but no evidence is being gathered.`,
      suggestedFix:
        "A data-mining test or a thought experiment can gather evidence cheaply without staging a new behavioral round. Either fits the untested assumption.",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// 9. Assumption-commitment drift (LLM-backed)
// ---------------------------------------------------------------------------

const DriftSchema = z.object({
  drifted: z.boolean(),
  reason: z.string().optional(),
});

const DRIFT_SYSTEM = `
You judge whether a Big Assumption's if-clause names the exact scenario the linked competing commitment is protecting against.

Return drifted=false when the if-clause and the commitment name the same identity concern (the commitment is trying to prevent the same scenario the assumption's "if" would trigger). Return drifted=true only when they clearly point at different concerns.

When in doubt, drifted=false. If drifted=true, give a short reason (under 40 words) naming what's different between the two.
`.trim();

export async function checkAssumptionCommitmentDrift(input: {
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
}): Promise<AuditFinding[]> {
  const commitmentById = new Map(input.commitments.map((c) => [c.id, c]));
  const assumptionById = new Map(input.assumptions.map((a) => [a.id, a]));
  const findings: AuditFinding[] = [];
  await Promise.all(
    input.links.map(async (link) => {
      const assumption = assumptionById.get(link.assumption_id);
      const commitment = commitmentById.get(link.commitment_id);
      if (!assumption || !commitment) return;
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: DriftSchema,
          system: DRIFT_SYSTEM,
          prompt: [
            `Competing commitment: ${commitment.text}`,
            `Big Assumption: ${assumption.text}`,
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (!object.drifted) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_commitment_drift",
          severity: "moderate",
          actualText: assumption.text,
          detail: object.reason
            ? `Assumption's if-clause and its linked commitment name different concerns. ${object.reason}`
            : "Assumption's if-clause and its linked commitment name different concerns.",
          suggestedFix:
            "Either sharpen the assumption so its if-clause names the exact scenario the commitment protects against, or the pair may be pointing at a missing commitment that hasn't been named yet.",
          relatedEntryRef: { table: "commitments", id: commitment.id },
          relatedText: commitment.text,
        });
      } catch (err) {
        console.warn(
          "[itc audit] checkAssumptionCommitmentDrift failed (assumption=%s commitment=%s): %s",
          assumption.id,
          commitment.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// 10. Assumption overload (LLM-backed, gated by 2+ links)
// ---------------------------------------------------------------------------

const OverloadSchema = z.object({
  same_concern: z.boolean(),
  reason: z.string().optional(),
});

const OVERLOAD_SYSTEM = `
You judge whether a set of competing commitments name the same underlying identity concern, or different concerns.

Return same_concern=true when every commitment in the set is protecting the same identity fear in different wording. Return same_concern=false when the commitments name distinct identity concerns that happen to be linked to the same Big Assumption.

When in doubt, same_concern=true (the safer default — don't flag overload unless it's clear the assumption is carrying more weight than one belief can). If same_concern=false, give a short reason (under 40 words) naming the distinct concerns.
`.trim();

export async function checkAssumptionOverload(input: {
  assumptions: ItcAssumption[];
  commitments: ItcCommitment[];
  links: ItcAssumptionCommitment[];
}): Promise<AuditFinding[]> {
  const commitmentById = new Map(input.commitments.map((c) => [c.id, c]));
  const linksByAssumption = new Map<string, string[]>();
  for (const link of input.links) {
    const prev = linksByAssumption.get(link.assumption_id) ?? [];
    prev.push(link.commitment_id);
    linksByAssumption.set(link.assumption_id, prev);
  }
  const findings: AuditFinding[] = [];
  await Promise.all(
    input.assumptions.map(async (assumption) => {
      const commitmentIds = linksByAssumption.get(assumption.id) ?? [];
      if (commitmentIds.length < 2) return;
      const commitments = commitmentIds
        .map((id) => commitmentById.get(id))
        .filter((c): c is ItcCommitment => Boolean(c));
      if (commitments.length < 2) return;
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: OverloadSchema,
          system: OVERLOAD_SYSTEM,
          prompt: [
            `Big Assumption: ${assumption.text}`,
            "Linked competing commitments:",
            ...commitments.map((c, i) => `  ${i + 1}. ${c.text}`),
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (object.same_concern) return;
        findings.push({
          entryRef: { table: "assumptions", id: assumption.id },
          issueType: "assumption_overload",
          severity: "moderate",
          actualText: assumption.text,
          detail: object.reason
            ? `Assumption is carrying multiple distinct identity concerns. ${object.reason}`
            : "Assumption is linked to commitments that name distinct identity concerns. One belief can't underwrite them all cleanly.",
          suggestedFix:
            "Additional Big Assumptions may need to be named so each commitment has an assumption pointed at its own specific concern.",
        });
      } catch (err) {
        console.warn(
          "[itc audit] checkAssumptionOverload failed (assumption=%s): %s",
          assumption.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// 11. Test grip-through-data (LLM-backed)
// ---------------------------------------------------------------------------

const GripSchema = z.object({
  grip_through_data: z.boolean(),
  reason: z.string().optional(),
});

const GRIP_SYSTEM = `
You judge whether a coachee's "what this says about the assumption" text reads as a conclusion drawn from the collected data, or as the original assumption still running the show (converting the data into a prescription to double down on the very behavior the assumption prescribes).

Return grip_through_data=true when the text is the assumption still gripping the coachee: it converts the data into "so I need to prepare more / try harder / not let it happen again" rather than treating the data as evidence about the belief itself.

Return grip_through_data=false when the text reads as a genuine conclusion from the data (the world didn't end AND the coachee is willing to update the belief).

When in doubt, grip_through_data=false. If grip_through_data=true, give a short reason (under 40 words).
`.trim();

export async function checkTestInterpretation(input: {
  tests: ItcTest[];
  testResults: ItcTestResult[];
  assumptions: ItcAssumption[];
}): Promise<AuditFinding[]> {
  const assumptionById = new Map(input.assumptions.map((a) => [a.id, a]));
  const testById = new Map(input.tests.map((t) => [t.id, t]));

  // Latest result per test (results share the created_at pattern used
  // in the actions layer).
  const latestByTest = new Map<string, ItcTestResult>();
  for (const r of input.testResults) {
    const prev = latestByTest.get(r.test_id);
    if (!prev || new Date(r.created_at) > new Date(prev.created_at)) {
      latestByTest.set(r.test_id, r);
    }
  }

  const findings: AuditFinding[] = [];
  await Promise.all(
    Array.from(latestByTest.values()).map(async (result) => {
      const says = result.what_it_says_about_assumption?.trim();
      if (!says || says.length === 0) return;
      const test = testById.get(result.test_id);
      if (!test) return;
      const assumption = assumptionById.get(test.assumption_id);
      if (!assumption) return;
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: GripSchema,
          system: GRIP_SYSTEM,
          prompt: [
            `Big Assumption being tested: ${assumption.text}`,
            `What the coachee wrote about what the data says: ${says}`,
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (!object.grip_through_data) return;
        findings.push({
          entryRef: { table: "tests", id: test.id },
          issueType: "test_grip_through_data",
          severity: "moderate",
          actualText: says,
          detail: object.reason
            ? `"Says about assumption" text reads as the belief still gripping the coachee, not a conclusion from the data. ${object.reason}`
            : "\"Says about assumption\" text converts the data back into a prescription to double down on the very behavior the assumption prescribes. Same fear, new wording.",
          suggestedFix:
            "Re-read the data as evidence about the belief itself. What did the world actually show, independent of the assumption's demand that it be prepared for?",
          relatedEntryRef: { table: "assumptions", id: assumption.id },
          relatedText: assumption.text,
        });
      } catch (err) {
        console.warn(
          "[itc audit] checkTestInterpretation failed (test=%s): %s",
          test.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// 12. Worry / commitment redundancy (LLM-backed on unpaired pairs)
// ---------------------------------------------------------------------------

const RedundancySchema = z.object({
  redundant: z.boolean(),
  reason: z.string().optional(),
});

const REDUNDANCY_SYSTEM = `
You judge whether a worry and a competing commitment name the same identity fear in different framing (worry-language vs commitment-language).

Return redundant=true only when both entries clearly point at the same identity concern (the map is bigger than it is — one is the shallow version of the other). Return redundant=false when they name distinct concerns, even if the framing overlaps.

When in doubt, redundant=false. If redundant=true, give a short reason (under 40 words).
`.trim();

export async function checkWorryCommitmentRedundancy(input: {
  worries: ItcWorry[];
  commitments: ItcCommitment[];
}): Promise<AuditFinding[]> {
  // Skip the natural pair (commitment.worry_id === worry.id) — those
  // are supposed to mirror; that's the map's construction. We're
  // checking pairs that AREN'T already linked.
  const findings: AuditFinding[] = [];
  const pairs: Array<{ worry: ItcWorry; commitment: ItcCommitment }> = [];
  for (const worry of input.worries) {
    for (const commitment of input.commitments) {
      if (commitment.worry_id === worry.id) continue;
      pairs.push({ worry, commitment });
    }
  }
  await Promise.all(
    pairs.map(async ({ worry, commitment }) => {
      try {
        const { object } = await generateObject({
          model: utilityModel(),
          schema: RedundancySchema,
          system: REDUNDANCY_SYSTEM,
          prompt: [
            `Worry: ${worry.text}`,
            `Competing commitment: ${commitment.text}`,
          ].join("\n"),
          maxOutputTokens: 300,
          temperature: 0.1,
        });
        if (!object.redundant) return;
        findings.push({
          entryRef: { table: "worries", id: worry.id },
          issueType: "worry_commitment_redundancy",
          severity: "observation",
          actualText: worry.text,
          detail: object.reason
            ? `Worry duplicates the identity concern in a commitment on the map. ${object.reason}`
            : "Worry duplicates a concern already carried by one of the competing commitments. The map reads as if it holds more distinct fears than it does.",
          suggestedFix:
            "Either push the worry deeper into a different identity concern, or drop it so the map isn't doubled up.",
          relatedEntryRef: { table: "commitments", id: commitment.id },
          relatedText: commitment.text,
        });
      } catch (err) {
        console.warn(
          "[itc audit] checkWorryCommitmentRedundancy failed (worry=%s commitment=%s): %s",
          worry.id,
          commitment.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export type FullAuditInput = {
  mapId: string;
  goalText: string;
  behaviors: ItcBehavior[];
  worries: ItcWorry[];
  commitments: ItcCommitment[];
  assumptions: ItcAssumption[];
  assumptionLinks: ItcAssumptionCommitment[];
  tests: ItcTest[];
  testResults: ItcTestResult[];
};

export async function runAllAuditChecks(
  input: FullAuditInput,
): Promise<AuditFinding[]> {
  const results = await Promise.all([
    checkBundledGoal({ mapId: input.mapId, goalText: input.goalText }),
    checkInteriorWitnessInWorries({
      worries: input.worries,
      behaviors: input.behaviors,
    }),
    checkInteriorWitnessInCommitments({ commitments: input.commitments }),
    checkMissingCommitmentStem({ commitments: input.commitments }),
    checkVagueAssumptionThenClause({ assumptions: input.assumptions }),
    checkDepthShortfall({
      worries: input.worries,
      commitments: input.commitments,
      assumptions: input.assumptions,
    }),
    checkAssumptionCoverage({
      commitments: input.commitments,
      assumptions: input.assumptions,
      links: input.assumptionLinks,
    }),
    checkTestCoverage({
      assumptions: input.assumptions,
      tests: input.tests,
    }),
    checkAssumptionCommitmentDrift({
      assumptions: input.assumptions,
      commitments: input.commitments,
      links: input.assumptionLinks,
    }),
    checkAssumptionOverload({
      assumptions: input.assumptions,
      commitments: input.commitments,
      links: input.assumptionLinks,
    }),
    checkTestInterpretation({
      tests: input.tests,
      testResults: input.testResults,
      assumptions: input.assumptions,
    }),
    checkWorryCommitmentRedundancy({
      worries: input.worries,
      commitments: input.commitments,
    }),
  ]);
  const flat = results.flat();
  flat.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  return flat;
}
