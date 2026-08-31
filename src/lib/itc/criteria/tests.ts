/**
 * Test-related criteria.
 *
 * Neither of these is currently wired into the hone waterfall — map
 * honing is about the shape of the four columns, not test execution
 * health. Kept exported for a possible future "test-health audit".
 *
 *  - test_coverage_gap: an assumption has no active test on it.
 *  - test_grip_through_data: a test result's "what this says about
 *    the assumption" text reads as the original belief still gripping
 *    the coachee rather than a conclusion drawn from the data.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "@/lib/model-config";
import type { ItcAssumption, ItcTest, ItcTestResult } from "../maps";
import type { Finding } from "./types";

// ---------------------------------------------------------------------------
// test_coverage_gap
// ---------------------------------------------------------------------------

export async function checkTestCoverage(input: {
  assumptions: ItcAssumption[];
  tests: ItcTest[];
}): Promise<Finding[]> {
  const activeTests = input.tests.filter((t) => t.status !== "abandoned");
  const testCountByAssumption = new Map<string, number>();
  for (const t of activeTests) {
    testCountByAssumption.set(
      t.assumption_id,
      (testCountByAssumption.get(t.assumption_id) ?? 0) + 1,
    );
  }
  const findings: Finding[] = [];
  for (const assumption of input.assumptions) {
    const count = testCountByAssumption.get(assumption.id) ?? 0;
    if (count > 0) continue;
    findings.push({
      entryRef: { table: "assumptions", id: assumption.id },
      issueType: "test_coverage_gap",
      severity: "moderate",
      actualText: assumption.text,
      detail: `This assumption has no active test on it. Untested assumptions still shape the coachee's behavior but no evidence is being gathered against them.`,
      suggestedFix:
        "A data-mining test or a thought experiment can gather evidence cheaply without staging a new behavioral round. Either fits the untested assumption.",
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// test_grip_through_data
// ---------------------------------------------------------------------------

const GripSchema = z.object({
  grip_through_data: z.boolean(),
  reason: z.string().max(400).optional(),
});

const GRIP_SYSTEM = `
You judge whether a coachee's "what this says about the assumption" text reads as a conclusion drawn from the collected data, or as the original assumption still running the show (converting the data into a prescription to double down on the very behavior the assumption prescribes).

Return grip_through_data=true when the text is the assumption still gripping the coachee: it converts the data into "so I need to prepare more / try harder / not let it happen again" rather than treating the data as evidence about the belief itself.

Return grip_through_data=false when the text reads as a genuine conclusion from the data (the world didn't end AND the coachee is willing to update the belief).

When in doubt, grip_through_data=false. If grip_through_data=true, give a short reason MAX 25 WORDS. Terseness matters — this reason renders inline in an audit and long reasons overwhelm the reader.
`.trim();

export async function checkTestInterpretation(input: {
  tests: ItcTest[];
  testResults: ItcTestResult[];
  assumptions: ItcAssumption[];
}): Promise<Finding[]> {
  const assumptionById = new Map(input.assumptions.map((a) => [a.id, a]));
  const testById = new Map(input.tests.map((t) => [t.id, t]));

  const latestByTest = new Map<string, ItcTestResult>();
  for (const r of input.testResults) {
    const prev = latestByTest.get(r.test_id);
    if (!prev || new Date(r.created_at) > new Date(prev.created_at)) {
      latestByTest.set(r.test_id, r);
    }
  }

  const findings: Finding[] = [];
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
          "[itc criteria] checkTestInterpretation failed (test=%s): %s",
          test.id,
          err instanceof Error ? err.message : String(err),
        );
      }
    }),
  );
  return findings;
}
