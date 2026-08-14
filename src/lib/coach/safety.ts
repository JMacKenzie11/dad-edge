import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel, utilityModelIdOrUnset } from "@/lib/model-config";

export type Severity = "none" | "low" | "medium" | "high" | "critical";

const ClassificationSchema = z.object({
  severity: z.enum(["none", "low", "medium", "high", "critical"]),
  categories: z.array(
    z.enum(["self_harm", "harm_other", "medical_crisis", "dv", "substance_crisis"]),
  ),
  reason: z.string().max(240),
});

export type Classification = z.infer<typeof ClassificationSchema>;

const SYSTEM = `You are a lightweight safety classifier for a men's coaching app. Read the user message and classify it for crisis signals.

Return severity + categories + a one-line reason. Never coach, never console — you are a filter, not the coach.

Severity ladder:
- none:      ordinary content (fitness, family, work, feelings, frustration)
- low:       distress but no crisis language ("I'm stressed", "I hate my job")
- medium:    passive ideation, hopelessness, escalating conflict at home
- high:      active ideation or planning, imminent danger to self/other, active DV, medical emergency
- critical:  explicit intent + means + timeline

Categories (0 or more):
- self_harm: user is at risk to themselves
- harm_other: user is at risk of harming someone else
- medical_crisis: medical event needing immediate care
- dv: domestic violence — user is either victim or aggressor
- substance_crisis: acute intoxication/overdose/withdrawal risk

Be conservative. False negatives are worse than false positives. If in doubt, escalate one level.`;

/**
 * Screen a user message for crisis signals. Returns a classification we can
 * store on coach_messages.flag_reason and, when severity >= high, enqueue
 * in coach_flags_queue for admin review. Fails open — a dead classifier must
 * never brick coaching.
 */
export async function classifyMessage(text: string): Promise<Classification> {
  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: ClassificationSchema,
      system: SYSTEM,
      prompt: text,
      maxOutputTokens: 400,
    });
    return object;
  } catch (err) {
    console.error("safety classifier failed", err, {
      model: utilityModelIdOrUnset(),
    });
    return { severity: "none", categories: [], reason: "classifier error" };
  }
}

export const CRISIS_RESOURCES = `If you're in danger right now, call 911. If you're thinking about hurting yourself or someone else, call or text 988 (Suicide & Crisis Lifeline). Text HOME to 741741 for the Crisis Text Line. Your community leader has been notified so a real person can check on you.`;
