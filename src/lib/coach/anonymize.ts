import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel } from "@/lib/model-config";

/**
 * Strip proper nouns from a mission description so it's shareable as an
 * exemplar to other men. Small Haiku call — cheap, batched-friendly.
 *
 * Rewrites:
 *   "Take Sarah on a date night Thursday, phone in the car."
 *     → "Take my wife on a date night Thursday, phone in the car."
 *   "Call Mike about the Q3 numbers Monday."
 *     → "Call my business partner about the Q3 numbers Monday."
 *
 * Leaves generic wording alone. If the result is empty or fails, we return
 * the original description so the pipeline never blocks on this step.
 */
const OutSchema = z.object({
  anonymized: z.string().min(1).max(280),
  changed: z.boolean(),
});

const SYSTEM = `You anonymize mission descriptions so they can be shown as examples to other men in a coaching app.

Rules:
- Replace personal names (spouses, kids, coworkers, friends) with role tokens: "my wife", "my son", "my daughter", "my business partner", "a friend", etc.
- Replace company names / brands with generic terms ("my company", "a client").
- Preserve numbers, days, times, verbs, and the concrete-behavior structure verbatim.
- Do not add or remove any commitment; do not soften language.
- If the description contains no proper nouns, return it unchanged and set changed=false.
- Keep it under 280 characters.

Return JSON only.`;

export async function anonymizeMissionText(
  description: string,
): Promise<string> {
  const trimmed = description.trim();
  if (trimmed.length === 0) return trimmed;
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: OutSchema,
      system: SYSTEM,
      prompt: trimmed,
      maxOutputTokens: 300,
    });
    const out = object.anonymized.trim();
    return out.length > 0 ? out : trimmed;
  } catch (err) {
    console.error("anonymize failed", err);
    return trimmed;
  }
}
