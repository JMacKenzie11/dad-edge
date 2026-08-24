/**
 * Voice-compliance lint for generated help content.
 *
 * Runs against the `sections` payload before a help_content row is
 * marked eligible for review. A failed row still lands in the queue
 * (so the reviewer sees what needs a rewrite), but with
 * voice_lint_passed=false so the admin knows to regenerate or edit
 * before approving.
 *
 * Rules mirror the banned lists in docs/coach-voice-and-tone.md +
 * docs/main-coach-ai-patterns.md. Deliberately conservative: word-
 * boundary matches only, no fuzzy stemming, so false positives are
 * rare and false negatives push the reviewer to do the semantic
 * pass. The scan is a safety net, not a substitute for reading.
 */

export type LintHit = {
  rule: string;
  pattern: string;
  match: string;
  section_index: number;
  step_index: number | null; // null when the hit is in what_its_for
};

export type LintResult = {
  passed: boolean;
  hits: LintHit[];
};

type Rule = {
  id: string;
  pattern: RegExp;
  reason: string;
};

/**
 * Categorized banned patterns. Each pattern is case-insensitive by
 * default and word-bounded where meaningful. Grouped so a reviewer
 * reading the hit list can tell "this is therapy-speak" vs "this is
 * an em-dash" at a glance.
 */
const RULES: Rule[] = [
  // Punctuation — hard bans (no em-dash / en-dash / double-hyphen).
  { id: "punct.em_dash", pattern: /—/, reason: "em-dash banned" },
  { id: "punct.en_dash", pattern: /–/, reason: "en-dash banned" },
  { id: "punct.double_hyphen", pattern: /--/, reason: "double-hyphen banned" },

  // Therapy-speak.
  { id: "therapy.sit_with", pattern: /\bsit(?:ting|s)? with\b/i, reason: "'sit with' banned" },
  { id: "therapy.lean_in", pattern: /\blean(?:ing|s)? in(?:to)?\b/i, reason: "'lean into' banned" },
  { id: "therapy.hold_space", pattern: /\bhold(?:ing|s)? space\b/i, reason: "'hold space' banned" },
  { id: "therapy.honor", pattern: /\bhonor(?:ing|s)? (?:your|his|the)\b/i, reason: "'honor your ___' banned" },
  { id: "therapy.gentle", pattern: /\bgentl(?:e|y|er)\b/i, reason: "'gentle' as tone descriptor banned" },
  { id: "therapy.journey", pattern: /\b\w+ journey\b/i, reason: "'___ journey' framing banned" },
  { id: "therapy.grace", pattern: /\bgive yourself grace\b/i, reason: "'give yourself grace' banned" },
  { id: "therapy.inner_critic", pattern: /\byour inner (?:critic|voice)\b/i, reason: "'your inner critic/voice' banned" },
  { id: "therapy.show_up_for_yourself", pattern: /\bshow up for yourself\b/i, reason: "'show up for yourself' banned" },
  { id: "therapy.do_the_work", pattern: /\bdo(?:ing)? the work\b/i, reason: "'do the work' banned" },
  { id: "therapy.process_emotions", pattern: /\bprocess (?:your|his|the) (?:emotions|feelings)\b/i, reason: "'process emotions' banned" },

  // The "name it" family.
  { id: "name_it.let_me_name", pattern: /\blet me name\b/i, reason: "announcing instead of doing" },
  { id: "name_it.want_to_name", pattern: /\bi want to name\b/i, reason: "announcing instead of doing" },
  { id: "name_it.lets_name", pattern: /\blet['\u2019]s name that\b/i, reason: "announcing instead of doing" },
  { id: "name_it.let_me_sharpen", pattern: /\blet me (?:sharpen|tighten|push|reframe|pull that apart|flag|point out)\b/i, reason: "announcing instead of doing" },
  { id: "name_it.call_this_out", pattern: /\bi['\u2019]m going to call this out\b/i, reason: "announcing instead of doing" },

  // The "it's worth" family.
  { id: "worth.noting", pattern: /\bit['\u2019]s worth (?:noting|naming|mentioning|pausing|remembering)\b/i, reason: "'it's worth ___' family banned" },
  { id: "worth.pointing", pattern: /\bworth (?:pointing out|flagging|mentioning|noting)\b/i, reason: "'worth ___' family banned" },

  // Filtering / hedging.
  { id: "hedge.important_to_note", pattern: /\bit['\u2019]s important to note\b/i, reason: "hedging preamble banned" },
  { id: "hedge.just_to_be_clear", pattern: /\bjust to be clear\b/i, reason: "hedging preamble banned" },
  { id: "hedge.to_be_honest", pattern: /\b(?:to be honest|if i['\u2019]m being honest)\b/i, reason: "'to be honest' banned" },
  { id: "hedge.what_im_hearing", pattern: /\bwhat i['\u2019]m hearing is\b/i, reason: "'what I'm hearing is' banned" },
  { id: "hedge.real_question", pattern: /\bthe real question is\b/i, reason: "'the real question is' banned" },
  { id: "hedge.does_that_resonate", pattern: /\b(?:does that resonate|does that land|how does that sit)\b/i, reason: "'does that resonate' family banned" },

  // Consultant filler.
  { id: "consultant.leverage", pattern: /\bleverag(?:e|es|ing|ed)\b/i, reason: "'leverage' banned" },
  { id: "consultant.operationalize", pattern: /\boperationaliz(?:e|es|ing|ed)\b/i, reason: "'operationalize' banned" },
  { id: "consultant.actionable", pattern: /\bactionable(?: insights?)?\b/i, reason: "'actionable' banned" },
  { id: "consultant.best_practices", pattern: /\bbest practices\b/i, reason: "'best practices' banned" },
  { id: "consultant.move_the_needle", pattern: /\bmove(?:s|d)? the needle\b/i, reason: "'move the needle' banned" },
  { id: "consultant.end_of_day", pattern: /\bat the end of the day\b/i, reason: "'at the end of the day' banned" },
  { id: "consultant.circle_back", pattern: /\b(?:circle back|level[- ]set|touch base|sync up)\b/i, reason: "consultant filler banned" },
  { id: "consultant.deep_dive", pattern: /\b(?:deep dive|div(?:e|ing) deep|div(?:e|ing) into)\b/i, reason: "'deep dive' banned" },
  { id: "consultant.delve", pattern: /\bdelv(?:e|es|ing|ed)(?: into)?\b/i, reason: "'delve' banned" },
  { id: "consultant.unpack", pattern: /\bunpack(?:ing|ed)?\b/i, reason: "'unpack' banned" },
  { id: "consultant.tease", pattern: /\btease (?:apart|out)\b/i, reason: "'tease apart/out' banned" },
  { id: "consultant.robust", pattern: /\brobust\b/i, reason: "'robust' banned (AI-signature)" },
  { id: "consultant.harness", pattern: /\bharness(?:es|ing|ed)?\b/i, reason: "'harness' banned" },
  { id: "consultant.seamless", pattern: /\bseamless(?:ly)?\b/i, reason: "'seamless' banned" },
  { id: "consultant.synergy", pattern: /\bsynerg(?:y|ies|ize)\b/i, reason: "'synergy' banned" },
  { id: "consultant.game_changer", pattern: /\bgame[- ]chang(?:er|ing)\b/i, reason: "'game-changer' banned" },
  { id: "consultant.transformation", pattern: /\btransformation\b/i, reason: "'transformation' as standalone promise banned" },
  { id: "consultant.ecosystem", pattern: /\becosystem\b/i, reason: "'ecosystem' banned when used loosely" },

  // Metaphors dressed as substance.
  { id: "metaphor.unlock", pattern: /\bunlock(?:s|ing|ed)?\b/i, reason: "'unlock' metaphor banned" },
  { id: "metaphor.door", pattern: /\b(?:opens? a door|closes? a door|slams? a door)\b/i, reason: "door metaphor banned" },
  { id: "metaphor.build_bridge", pattern: /\bbuild(?:s|ing)? a bridge\b/i, reason: "'build a bridge' banned" },
  { id: "metaphor.plant_flag", pattern: /\bplant(?:s|ing|ed)? a flag\b/i, reason: "'plant a flag' banned" },
  { id: "metaphor.navigate", pattern: /\bnavigat(?:e|es|ing|ed)\b/i, reason: "'navigate' metaphor banned" },
  { id: "metaphor.quietly", pattern: /\bquietly\b/i, reason: "'quietly' as intensifier/metaphor banned" },

  // AI-signature vocabulary.
  { id: "ai_sig.tapestry", pattern: /\btapestry\b/i, reason: "'tapestry' banned (AI-signature)" },
  { id: "ai_sig.resonate", pattern: /\bresonat(?:e|es|ing|ed)\b/i, reason: "'resonate' banned (AI-signature)" },
  { id: "ai_sig.elevate", pattern: /\belevat(?:e|es|ing|ed)\b/i, reason: "'elevate' banned (AI-signature)" },
  { id: "ai_sig.profound", pattern: /\bprofound(?:ly)?\b/i, reason: "'profound' banned (AI-signature)" },
  { id: "ai_sig.deeply", pattern: /\b(?:deeply|genuinely|truly) (?:care|matter|appreciate|understand|value|resonate)\b/i, reason: "'deeply/genuinely/truly' as intensifier banned" },
  { id: "ai_sig.nuanced", pattern: /\bnuanced?\b/i, reason: "'nuanced' banned" },

  // "Read" as a noun (per user memory).
  { id: "read.noun", pattern: /\b(?:the |my |his |coach['\u2019]s )read\b(?! it| my| his| the| into| about)/i, reason: "'read' as noun banned" },

  // Praise language.
  { id: "praise.brave", pattern: /\b(?:brave|raw|powerful|beautifully)\b/i, reason: "praise language banned" },

  // Crutch intensifiers.
  { id: "crutch.very", pattern: /\bvery\b/i, reason: "'very' banned" },
  { id: "crutch.really", pattern: /\breally\b/i, reason: "'really' as intensifier banned" },
];

export function lintSections(
  sections: Array<{ what_its_for: string; steps: string[] }>,
): LintResult {
  const hits: LintHit[] = [];
  sections.forEach((section, si) => {
    scanText(section.what_its_for, si, null, hits);
    section.steps.forEach((step, stepI) => {
      scanText(step, si, stepI, hits);
    });
  });
  return { passed: hits.length === 0, hits };
}

function scanText(
  text: string,
  sectionIndex: number,
  stepIndex: number | null,
  out: LintHit[],
): void {
  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    out.push({
      rule: rule.id,
      pattern: rule.pattern.source,
      match: match[0],
      section_index: sectionIndex,
      step_index: stepIndex,
    });
  }
}
