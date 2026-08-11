import type { PillarCode } from "@/lib/pillars";

/**
 * Curated seed exemplars per pillar. Shown in the "See examples" drawer.
 * Aim: 4 genuinely different behaviors per pillar — different verbs,
 * different days, different contexts. If two of these read as variations
 * of the same thing, cut one.
 *
 * Over time, real missions promoted via `missions.is_exemplar = true` are
 * mixed in (deduped near-identicals at the API layer).
 */
export const SEED_EXAMPLES: Record<Exclude<PillarCode, "A2">, string[]> = {
  B: [
    "Take my wife out to dinner Thursday, phone in the car, ask her three questions I've never asked.",
    "Write my wife a handwritten note Sunday morning before she wakes up.",
    "Plan and book a weekend away for our anniversary by Sunday night.",
    "Have the hard money conversation with my wife Wednesday, no defensiveness.",
  ],
  R: [
    "Read to the kids every night this week, no exceptions.",
    "Take my son to breakfast Saturday one-on-one, phone in the car.",
    "Coach my kid's practice Wednesday, present the whole time.",
    "Write each of my kids a letter by Sunday telling them what I see in them.",
  ],
  A: [
    "Send 10 sales outreach emails Monday before 10am.",
    "Ship the pricing page revision by Friday end of day.",
    "Close the books for last month by Sunday night.",
    "Have the compensation conversation with my business partner by Thursday.",
  ],
  V: [
    "Deadlift 3x5 at working weight Wednesday morning.",
    "Cold plunge four minutes every day this week.",
    "Cook dinner from scratch Sunday — zero takeout.",
    "Lights off, phone in another room, by 10:30pm every night this week.",
  ],
  E: [
    "Spend two hours Saturday morning on the garage project.",
    "Play guitar for 30 minutes Sunday afternoon.",
    "Solo hike Saturday, no headphones for the first hour.",
    "Finish the book I've been avoiding by Sunday night.",
  ],
  M: [
    "Run 5k Monday, Wednesday, Friday before 7am.",
    "Yoga for 20 minutes every morning this week.",
    "Walk 10,000 steps every day this week — track it.",
    "Bike commute Tuesday and Thursday.",
  ],
  N: [
    "Call one man I haven't spoken to in six months by Friday.",
    "Show up to the men's group Wednesday with the real story ready.",
    "Introduce two men in my network to each other via email Monday.",
    "Book coffee with a mentor for next week by Friday.",
  ],
};

export function getExamplesForPillar(code: PillarCode): string[] {
  if (code === "A2") return [];
  return SEED_EXAMPLES[code] ?? [];
}
