/**
 * Server-side concreteness gate for missions.
 * §6 mission mode contract: "behavior + specific day".
 * Rejects vague output like "be more present" before a mission can be saved.
 *
 * Rules:
 *  1. target_date is required and must be a real date (schema enforces).
 *  2. description must not match blocked vague-only patterns.
 *  3. description length ≥ 8 characters (DB backstop mirrors this).
 */

const VAGUE_PATTERNS = [
  /^be\s+(more|less)\b/i,
  /^focus\s+on\b/i,
  /^work\s+on\b/i,
  /^try\s+to\b/i,
  /^get\s+better\b/i,
  /^improve(\s+my)?$/i,
  /^be\s+present$/i,
  /^show\s+up$/i,
  /^intentional\b/i,
  /^mindful\b/i,
];

export type MissionValidationInput = {
  description: string;
  target_date: string; // YYYY-MM-DD
  /** Bypass the vague-pattern check for missions authored by the ITC
   *  coach (created_by='itc'). ITC test behaviors like "stay in the
   *  room during the next argument" are already validated by SMART on
   *  the ITC side. The min-length + real-date checks still apply. */
  bypassConcreteness?: boolean;
};

export type MissionValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateMissionConcreteness({
  description,
  target_date,
  bypassConcreteness = false,
}: MissionValidationInput): MissionValidationResult {
  const desc = description.trim();
  if (desc.length < 8) {
    return { ok: false, reason: "Too short. Say what you'll do." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
    return { ok: false, reason: "Pick a specific day." };
  }
  const parsedDate = new Date(`${target_date}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return { ok: false, reason: "That date isn't real." };
  }

  if (bypassConcreteness) {
    return { ok: true };
  }

  for (const pat of VAGUE_PATTERNS) {
    if (pat.test(desc)) {
      return { ok: false, reason: "Too vague. Behavior plus day." };
    }
  }

  return { ok: true };
}
