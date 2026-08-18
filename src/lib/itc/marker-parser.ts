import { CoachActionSchema, type CoachAction } from "./coach";

/**
 * Coach-emitted inline markers → structured actions.
 *
 * The coach LLM writes natural prose to the coachee. Any state change
 * it wants to land on the map is wrapped in an explicit marker tag.
 * Server parses the tags with regex, strips them from the visible
 * reply text, and either:
 *   - creates an ItcActionProposal row (for content-locking actions
 *     that need coachee confirmation via a UI card), or
 *   - applies immediately (for stage transitions and walkthrough flags
 *     that don't need a card).
 *
 * Marker syntax:
 *   Content actions (become proposals):
 *     <<propose_goal>>text<</propose_goal>>
 *     <<propose_behavior>>text<</propose_behavior>>
 *     <<propose_worry behavior=N>>text<</propose_worry>>
 *     <<propose_commitments_batch>>1. text\n2. text\n...<</propose_commitments_batch>>
 *       (server pairs items to uncovered worries in order)
 *     <<propose_assumption commits=1,4>>text<</propose_assumption>>
 *     <<save_test_design type=self_observation target=2026-08-24>>
 *       my_big_assumption_says: ...
 *       so_i_will: ...
 *       and_collect_the_following_data: ...
 *       in_order_to_find_out: ...
 *     <</save_test_design>>
 *     <<record_test_results verdict=partially_challenged next=new_test>>
 *       what_i_did: ...
 *       what_i_observed: ...
 *       what_it_tells_me: ...
 *     <</record_test_results>>
 *     <<recommend_assumption index=1 reason="...">>
 *     <<replace_behavior index=2>>new text<</replace_behavior>>
 *     <<remove_behavior index=3>>
 *
 *   Transition actions (apply immediately, no card):
 *     <<advance stage=behaviors>>
 *     <<mark_walkthrough_delivered>>
 *     <<mark_reveal_delivered>>
 *
 *   Selection (applies immediately since it's a small pick, not a lock):
 *     <<select_assumption index=2>>
 *
 * Parser is strict-ish: unknown tag names are dropped from the
 * visible text but not applied. Malformed tags (unclosed, wrong
 * attribute syntax) are also dropped from visible text. If the coach
 * never emits any markers, this returns strippedText = input.
 */

/** Actions that show up as a UI card the coachee must accept/edit/reject. */
const CONTENT_ACTION_TYPES = new Set<string>([
  "propose_goal",
  "propose_behavior",
  "propose_worry",
  "propose_commitments_batch",
  "propose_assumption",
  "save_test_design",
  "record_test_results",
  "recommend_assumption_for_testing",
  "replace_behavior",
  "remove_behavior",
]);

/** Actions that apply immediately from the marker (no card). */
const IMMEDIATE_ACTION_TYPES = new Set<string>([
  "advance_stage",
  "mark_walkthrough_delivered",
  "mark_reveal_delivered",
  "select_assumption_for_testing",
]);

export type ParsedMarkerResult = {
  /** Message text with all markers stripped. What the coachee sees. */
  strippedText: string;
  /** Content actions that should become UI cards (ItcActionProposal rows). */
  proposals: CoachAction[];
  /** Transition/selection actions that should apply immediately. */
  immediateActions: CoachAction[];
  /** Malformed markers we detected and dropped. Diagnostic. */
  errors: string[];
};

/**
 * The tag matcher. Captures name, attribute string, body, closing tag
 * (empty for self-closing forms). Non-greedy on body so back-to-back
 * markers parse independently.
 */
const TAG_RE = /<<(\w+)(?:\s+([^>]*))?>>(?:([\s\S]*?)<<\/\1>>)?/g;

/**
 * Also match self-closing tags without a body (e.g. <<advance stage=behaviors>>
 * or <<mark_walkthrough_delivered>>). The main TAG_RE above matches these too
 * because the body-and-closing-tag half is optional; we treat missing body
 * as "self-closing."
 */

/** Parse `key=value` or `key="value with spaces"` pairs. */
function parseAttrs(attrStr: string | undefined): Record<string, string> {
  if (!attrStr) return {};
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? "";
  }
  return out;
}

/** Parse a comma-separated list of positive integers. Returns [] on bad input. */
function parseIntList(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 20);
}

/**
 * Parse a numbered list ("1. text\n2. text\n...") into an array of
 * strings, one per line. Used by propose_commitments_batch body.
 */
function parseNumberedList(body: string): string[] {
  const out: string[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const m = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) out.push(m[1].trim());
    else out.push(line);
  }
  return out;
}

/**
 * Parse a labeled-field body ("field_name: value\n...") into a map.
 * Used by save_test_design and record_test_results bodies.
 */
function parseFieldBlock(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split("\n");
  let currentKey: string | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const m = line.match(/^\s*([a-z_][a-z0-9_]*)\s*:\s*(.*)$/i);
    if (m) {
      currentKey = m[1].toLowerCase();
      out[currentKey] = m[2];
    } else if (currentKey && line.trim().length > 0) {
      // Continuation of the previous field's value on a new line.
      out[currentKey] = (out[currentKey] + " " + line.trim()).trim();
    }
  }
  return out;
}

/**
 * Materialize a CoachAction from a matched marker. Returns null if the
 * marker's arguments don't validate. The caller decides whether the
 * action is a proposal (content) or immediate (transition).
 */
function buildAction(
  name: string,
  attrs: Record<string, string>,
  body: string,
  errors: string[],
): CoachAction | null {
  const trimmedBody = body.trim();

  const attempt = (draft: unknown): CoachAction | null => {
    const parsed = CoachActionSchema.safeParse(draft);
    if (!parsed.success) {
      errors.push(
        `marker <<${name}>> failed schema validation: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
      );
      return null;
    }
    return parsed.data;
  };

  switch (name) {
    case "propose_goal":
      if (!trimmedBody) {
        errors.push("propose_goal: empty body");
        return null;
      }
      return attempt({ type: "propose_goal", text: trimmedBody });

    case "propose_behavior":
      if (!trimmedBody) {
        errors.push("propose_behavior: empty body");
        return null;
      }
      return attempt({ type: "propose_behavior", text: trimmedBody });

    case "propose_worry": {
      const behavior = Number(attrs.behavior ?? attrs.behavior_index ?? "");
      if (!Number.isFinite(behavior) || behavior < 1) {
        errors.push("propose_worry: missing/invalid behavior attribute");
        return null;
      }
      if (!trimmedBody) {
        errors.push("propose_worry: empty body");
        return null;
      }
      return attempt({
        type: "propose_worry",
        behavior_index: behavior,
        text: trimmedBody,
      });
    }

    case "propose_commitment": {
      const worry = Number(attrs.worry ?? attrs.worry_index ?? "");
      if (!Number.isFinite(worry) || worry < 1) {
        errors.push("propose_commitment: missing/invalid worry attribute");
        return null;
      }
      if (!trimmedBody) return null;
      return attempt({
        type: "propose_commitment",
        worry_index: worry,
        text: trimmedBody,
      });
    }

    case "propose_commitments_batch": {
      const items = parseNumberedList(trimmedBody);
      if (items.length === 0) {
        errors.push("propose_commitments_batch: no items in body");
        return null;
      }
      // Pair items with worries in order (1-based). The apply layer
      // skips items pointing at already-covered worries, so this is
      // idempotent even if the coach guesses wrong.
      return attempt({
        type: "propose_commitments_batch",
        items: items.map((text, idx) => ({
          worry_index: idx + 1,
          text,
        })),
      });
    }

    case "propose_assumption": {
      const indices = parseIntList(
        attrs.commits ?? attrs.commitments ?? attrs.commitment_indices,
      );
      if (indices.length === 0) {
        errors.push(
          "propose_assumption: missing commits attribute (expected 'commits=1,4')",
        );
        return null;
      }
      if (!trimmedBody) return null;
      return attempt({
        type: "propose_assumption",
        text: trimmedBody,
        commitment_indices: indices,
      });
    }

    case "save_test_design": {
      const fields = parseFieldBlock(trimmedBody);
      const testType = attrs.type;
      const target = attrs.target ?? attrs.target_date;
      if (!testType || !target) {
        errors.push("save_test_design: missing type or target attribute");
        return null;
      }
      return attempt({
        type: "save_test_design",
        test_type: testType,
        assumption_says:
          fields.my_big_assumption_says ?? fields.assumption_says ?? "",
        behavior_change:
          fields.so_i_will ?? fields.behavior_change ?? "",
        data_to_collect:
          fields.and_collect_the_following_data ??
          fields.data_to_collect ??
          "",
        in_order_to_find_out:
          fields.in_order_to_find_out ?? "",
        target_date: target,
      });
    }

    case "record_test_results": {
      const fields = parseFieldBlock(trimmedBody);
      const verdict = attrs.verdict;
      const next = attrs.next ?? attrs.next_step;
      const ranOn = attrs.ran_on ?? new Date().toISOString().slice(0, 10);
      if (!verdict || !next) {
        errors.push("record_test_results: missing verdict or next attribute");
        return null;
      }
      return attempt({
        type: "record_test_results",
        ran_on: ranOn,
        what_i_did: fields.what_i_did ?? fields.so_in_order_to_test_it_i_changed_my_behavior_this_way ?? "",
        data_collected: fields.what_i_observed ?? fields.data_collected ?? fields.this_is_what_i_observed_happening ?? "",
        what_it_says_about_assumption:
          fields.what_it_tells_me ??
          fields.what_it_says_about_assumption ??
          fields.and_this_is_what_it_tells_me_about_my_big_assumption ??
          "",
        assumption_verdict: verdict,
        next_step: next,
      });
    }

    case "recommend_assumption":
    case "recommend_assumption_for_testing": {
      const index = Number(attrs.index ?? attrs.assumption_index ?? "");
      if (!Number.isFinite(index) || index < 1) {
        errors.push("recommend_assumption: missing/invalid index attribute");
        return null;
      }
      const reason = attrs.reason ?? trimmedBody;
      if (!reason) {
        errors.push("recommend_assumption: missing reason");
        return null;
      }
      return attempt({
        type: "recommend_assumption_for_testing",
        assumption_index: index,
        reason,
      });
    }

    case "select_assumption":
    case "select_assumption_for_testing": {
      const index = Number(attrs.index ?? attrs.assumption_index ?? "");
      if (!Number.isFinite(index) || index < 1) {
        errors.push("select_assumption: missing/invalid index attribute");
        return null;
      }
      return attempt({
        type: "select_assumption_for_testing",
        assumption_index: index,
      });
    }

    case "replace_behavior": {
      const index = Number(attrs.index ?? "");
      if (!Number.isFinite(index) || index < 1) {
        errors.push("replace_behavior: missing/invalid index");
        return null;
      }
      if (!trimmedBody) return null;
      return attempt({
        type: "replace_behavior",
        index,
        text: trimmedBody,
      });
    }

    case "remove_behavior": {
      const index = Number(attrs.index ?? "");
      if (!Number.isFinite(index) || index < 1) {
        errors.push("remove_behavior: missing/invalid index");
        return null;
      }
      return attempt({ type: "remove_behavior", index });
    }

    case "advance":
    case "advance_stage": {
      const stage = attrs.stage ?? attrs.to;
      if (!stage) {
        errors.push("advance: missing stage attribute");
        return null;
      }
      return attempt({ type: "advance_stage", to: stage });
    }

    case "mark_walkthrough_delivered":
      return attempt({ type: "mark_walkthrough_delivered" });

    case "mark_reveal_delivered":
      return attempt({ type: "mark_reveal_delivered" });

    default:
      // Unknown tag — silently drop it from the visible text and note
      // in errors for diagnostics. Nothing applied.
      errors.push(`unknown marker: <<${name}>>`);
      return null;
  }
}

export function parseCoachMarkers(text: string): ParsedMarkerResult {
  const proposals: CoachAction[] = [];
  const immediateActions: CoachAction[] = [];
  const errors: string[] = [];

  // Iterate matches, build actions, then strip in a second pass so we
  // don't invalidate the regex's stateful lastIndex during iteration.
  const matches: Array<{
    start: number;
    end: number;
    name: string;
    attrs: Record<string, string>;
    body: string;
  }> = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      name: m[1],
      attrs: parseAttrs(m[2]),
      body: m[3] ?? "",
    });
  }

  for (const match of matches) {
    const action = buildAction(match.name, match.attrs, match.body, errors);
    if (!action) continue;
    if (CONTENT_ACTION_TYPES.has(action.type)) {
      proposals.push(action);
    } else if (IMMEDIATE_ACTION_TYPES.has(action.type)) {
      immediateActions.push(action);
    } else {
      // Shouldn't happen — action.type is always in one of the two sets.
      errors.push(`marker matched but not routed: ${action.type}`);
    }
  }

  // Strip matched markers from the visible text. Also defense-in-depth
  // strip any leftover <<...>> or <</...>> shapes even if they didn't
  // match the strict grammar — prevents leaking raw tags to the coachee.
  let stripped = text;
  // Walk in reverse so indices stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    const { start, end } = matches[i];
    stripped = stripped.slice(0, start) + stripped.slice(end);
  }
  // Defense-in-depth: any remaining <<...>> or <</...>> patterns get
  // dropped. Catches malformed tags the coach might have emitted.
  stripped = stripped.replace(/<<\/?[^>]*>>/g, "");
  // Collapse the whitespace holes left behind.
  stripped = stripped.replace(/\n{3,}/g, "\n\n").trim();

  return { strippedText: stripped, proposals, immediateActions, errors };
}
