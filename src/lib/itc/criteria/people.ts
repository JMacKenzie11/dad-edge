/**
 * People come from the map. Deterministic verifier for every drafter,
 * reviser and suggester.
 *
 * docs/coach-voice-and-tone.md: "every pronoun and every relational
 * noun in your reply must be traceable to something the coachee
 * actually wrote." That rule lived only in prompts; the worry
 * drafter's shape instructions said "she'd see…" and a map about
 * "the other person" got a wife. This check is the server-side bar:
 * a gendered pronoun or relational noun in a draft has to appear in
 * the map's own text, or the draft is refused with feedback naming
 * who IS on the map.
 *
 * Only the system's drafts are held to this. The coachee can put
 * anyone he likes on his own map.
 *
 * What counts as "a person the draft added":
 *   - a feminine pronoun (she / her / hers / herself). The coachee is
 *     a man, so masculine pronouns are usually him ("the husband who
 *     dodges HIS own mistakes") and can't be held to the map.
 *   - a relational noun with a possessive: "my wife", "my kids", "our
 *     team". A bare role noun is his own role ("the husband who…",
 *     "the coach who…") and is the drafter's job, not a person.
 */

const FEMININE_PRONOUNS = ["she", "her", "hers", "herself"] as const;
const MASCULINE_PRONOUNS = ["he", "him", "his", "himself"] as const;

/** Relational nouns the drafters reach for, with the forms that count
 *  as the same person on the map. Lowercase. */
const RELATIONAL_NOUNS: ReadonlyArray<readonly string[]> = [
  ["wife"],
  ["husband"],
  ["girlfriend"],
  ["boyfriend"],
  ["partner", "partners"],
  ["kid", "kids", "child", "children"],
  ["son", "sons"],
  ["daughter", "daughters"],
  ["family"],
  ["team", "teams"],
  ["boss"],
  ["client", "clients"],
  ["customer", "customers"],
  ["employee", "employees"],
  ["colleague", "colleagues", "coworker", "coworkers"],
  ["mom", "mother"],
  ["dad", "father"],
  ["brother", "brothers"],
  ["sister", "sisters"],
  ["friend", "friends", "buddy"],
];

const FEMININE_NOUNS = new Set(["wife", "girlfriend", "daughter", "daughters", "mom", "mother", "sister", "sisters"]);
const MASCULINE_NOUNS = new Set(["husband", "boyfriend", "son", "sons", "dad", "father", "brother", "brothers"]);

/** Nouns that follow a possessive in the draft: "my wife", "our team",
 *  "my two kids". Those are people the draft is putting in the room. */
function possessedNouns(text: string): Set<string> {
  const out = new Set<string>();
  // The noun right after the possessive, and the one after that
  // ("my two kids", "our sales team"). Non-nouns that get swept in
  // ("would") never match a relational form, so they're harmless.
  const re = /\b(?:my|our)\s+([a-z]+)(?:\s+([a-z]+))?/gi;
  for (const m of text.matchAll(re)) {
    out.add(m[1].toLowerCase());
    if (m[2]) out.add(m[2].toLowerCase());
  }
  return out;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .split(/[^a-z']+/)
      .map((w) => w.replace(/^'+|'+$/g, ""))
      .filter(Boolean),
  );
}

export type PeopleVerdict = {
  ok: boolean;
  /** Words in the draft that no map text supports. */
  offenders: string[];
  /** People the map does name (for the retry feedback). */
  onMap: string[];
  reason: string;
};

/**
 * @param draftText   the sentence the system is about to offer
 * @param mapTexts    everything the coachee has written on this map
 *                    (goal, behaviors, worries, commitments,
 *                    assumptions, chat), plus any paired context the
 *                    drafter was given
 */
export function checkPeopleFromMap(input: {
  draftText: string;
  mapTexts: string[];
}): PeopleVerdict {
  const map = words(input.mapTexts.join(" "));
  const draft = words(input.draftText);
  // Fail open when the map has no text at all (nothing to trace to).
  if (map.size === 0) {
    return { ok: true, offenders: [], onMap: [], reason: "no map text" };
  }

  const mapHasFeminine =
    FEMININE_PRONOUNS.some((p) => map.has(p)) || [...FEMININE_NOUNS].some((n) => map.has(n));
  const mapHasMasculine =
    MASCULINE_PRONOUNS.some((p) => map.has(p)) || [...MASCULINE_NOUNS].some((n) => map.has(n));

  const offenders: string[] = [];
  for (const p of FEMININE_PRONOUNS) {
    if (draft.has(p) && !mapHasFeminine) offenders.push(p);
  }
  const possessed = possessedNouns(input.draftText);
  for (const forms of RELATIONAL_NOUNS) {
    const inDraft = forms.filter((f) => possessed.has(f));
    if (inDraft.length === 0) continue;
    const onMap = forms.some((f) => map.has(f));
    if (!onMap) offenders.push(...inDraft);
  }

  const onMap: string[] = [];
  if (mapHasFeminine) onMap.push("she/her");
  if (mapHasMasculine) onMap.push("he/him");
  for (const forms of RELATIONAL_NOUNS) {
    const hit = forms.find((f) => map.has(f));
    if (hit) onMap.push(hit);
  }

  if (offenders.length === 0) {
    return { ok: true, offenders, onMap, reason: "every person traces to the map" };
  }
  const who =
    onMap.length > 0
      ? `The people on this map: ${onMap.join(", ")}.`
      : `This map names no one in particular; say "they", "the other person", or "people".`;
  return {
    ok: false,
    offenders,
    onMap,
    reason: `The map never mentions ${offenders.map((o) => `"${o}"`).join(", ")}. Don't put people on it he didn't. ${who}`,
  };
}

/**
 * The witness the drafters should reach for when a shape needs one:
 * "she" only when the map has her, "he" only when it has him,
 * otherwise "they". Server fills this into the shape instructions so
 * the model never has to guess.
 */
export function witnessFromMap(mapTexts: string[]): {
  subject: string;
  would: string;
  object: string;
} {
  const map = words(mapTexts.join(" "));
  const feminine =
    FEMININE_PRONOUNS.some((p) => map.has(p)) || [...FEMININE_NOUNS].some((n) => map.has(n));
  const masculine =
    MASCULINE_PRONOUNS.some((p) => map.has(p)) || [...MASCULINE_NOUNS].some((n) => map.has(n));
  if (feminine && !masculine) return { subject: "she", would: "she'd", object: "her" };
  if (masculine && !feminine) return { subject: "he", would: "he'd", object: "him" };
  return { subject: "they", would: "they'd", object: "them" };
}
