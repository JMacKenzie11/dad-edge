/**
 * Server-side concreteness gate for missions.
 * §6 mission mode contract: "behavior + specific day".
 * Rejects vague output like "be more present" before a mission can be saved.
 *
 * Rules:
 *  1. target_date is required and must be a real date (schema enforces).
 *  2. description must start with (or contain) an action verb.
 *  3. description must not match blocked vague-only patterns.
 *  4. description length ≥ 8 characters (DB backstop mirrors this).
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

// Compact allowlist of concrete action verbs. Not exhaustive — the vague-pattern
// blocklist does the primary work; the verb check catches nouny descriptions.
const CONCRETE_VERBS = new Set([
  "call","text","email","write","send","book","take","go","run","lift","train","cook","make",
  "read","study","learn","teach","meet","host","invite","ask","tell","confess","apologize",
  "walk","hike","swim","bike","ride","drive","visit","fix","clean","organize","plan","review",
  "record","log","journal","meditate","pray","stretch","stop","start","quit","cut","reduce",
  "date","sit","talk","hug","kiss","hold","listen","play","build","paint","garden","fast",
  "post","publish","record","present","pitch","close","ship","launch",
]);

export type MissionValidationInput = {
  description: string;
  target_date: string; // YYYY-MM-DD
};

export type MissionValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateMissionConcreteness({
  description,
  target_date,
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

  for (const pat of VAGUE_PATTERNS) {
    if (pat.test(desc)) {
      return { ok: false, reason: "Too vague. Behavior plus day." };
    }
  }

  // First word should look like an action verb (or contain one within the first 3 words).
  const firstWords = desc
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  const hasConcreteVerb = firstWords.some((w) => CONCRETE_VERBS.has(w));
  if (!hasConcreteVerb) {
    return {
      ok: false,
      reason: "Start with a verb. What are you doing?",
    };
  }

  return { ok: true };
}
