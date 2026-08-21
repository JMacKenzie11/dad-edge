import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { format } from "date-fns";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { avg, estimateTokens } from "../util";

/** Delta threshold on a per-question basis. Anything ≥ this (in either
 *  direction) counts as significant enough to surface the question's
 *  note in the coach context. Below this, the note is skipped to keep
 *  the context lean — full detail is a follow-up question away. */
const SIGNIFICANT_DELTA = 1;

/**
 * Survey provider — most recent Partner Connection Survey composite
 * score + delta vs the prior survey, plus per-question notes only for
 * the questions where the delta was significant. Skips the noise of
 * dumping all 15 questions every turn.
 *
 * Cacheable: surveys land infrequently (weekly at most). The composite
 * + notable-questions view changes only when a new survey is taken.
 */
export const surveyProvider: ContextProvider = {
  key: "survey",
  priority: 40,
  cacheable: true,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const { data: surveys } = await svc
      .from("partner_surveys")
      .select("id, taken_at")
      .eq("user_id", user.id)
      .order("taken_at", { ascending: false })
      .limit(2);

    const rows = (surveys ?? []) as Array<{ id: string; taken_at: string }>;
    if (rows.length === 0) return null;

    const surveyIds = rows.map((s) => s.id);
    const { data: responses } = await svc
      .from("partner_survey_responses")
      .select(
        "survey_id, score, note, question:question_id(sort_order, text)",
      )
      .in("survey_id", surveyIds);

    type ResponseRow = {
      survey_id: string;
      score: number;
      note: string | null;
      question:
        | { sort_order: number; text: string }
        | Array<{ sort_order: number; text: string }>
        | null;
    };
    const bySurvey = new Map<
      string,
      Array<{ order: number; text: string; score: number; note: string | null }>
    >();
    for (const r of (responses ?? []) as ResponseRow[]) {
      const q = Array.isArray(r.question) ? r.question[0] : r.question;
      if (!q) continue;
      let arr = bySurvey.get(r.survey_id);
      if (!arr) {
        arr = [];
        bySurvey.set(r.survey_id, arr);
      }
      arr.push({ order: q.sort_order, text: q.text, score: r.score, note: r.note });
    }

    const latest = (bySurvey.get(rows[0].id) ?? []).sort(
      (a, b) => a.order - b.order,
    );
    if (latest.length === 0) return null;

    const prior = rows[1]
      ? (bySurvey.get(rows[1].id) ?? []).sort((a, b) => a.order - b.order)
      : [];
    const priorByOrder = new Map(prior.map((r) => [r.order, r.score] as const));

    const latestAvg = avg(latest.map((r) => r.score));
    const priorAvg = prior.length ? avg(prior.map((r) => r.score)) : null;
    const headerLine =
      priorAvg !== null
        ? `Composite ${latestAvg.toFixed(1)}/5 (prior ${priorAvg.toFixed(1)}, Δ ${latestAvg - priorAvg >= 0 ? "+" : ""}${(latestAvg - priorAvg).toFixed(1)})`
        : `Composite ${latestAvg.toFixed(1)}/5 (baseline, no prior survey)`;

    // Only surface questions with a significant delta. If there's no
    // prior survey, surface every question with a low score (≤ 2) or
    // a substantive note — the man just took his first survey and
    // the coach needs the specifics without dumping all 15.
    const notable = latest.filter((r) => {
      const p = priorByOrder.get(r.order);
      if (p === undefined) {
        return r.score <= 2 || (r.note && r.note.trim().length > 0);
      }
      return Math.abs(r.score - p) >= SIGNIFICANT_DELTA;
    });

    const perQuestionLines = notable.map((r) => {
      const p = priorByOrder.get(r.order);
      const delta = p !== undefined ? r.score - p : null;
      const arrow = delta === null ? "" : delta > 0 ? " ↑" : delta < 0 ? " ↓" : "";
      const noteFragment =
        r.note && r.note.trim() ? ` — "${r.note.trim().slice(0, 140)}"` : "";
      return `  Q${r.order}: ${r.text} → ${r.score}/5${arrow}${noteFragment}`;
    });

    const takenLine = `Last taken ${format(new Date(rows[0].taken_at), "yyyy-MM-dd")} · ${headerLine}`;
    const notableBlock =
      perQuestionLines.length > 0
        ? `\nNotable questions this time:\n${perQuestionLines.join("\n")}`
        : `\n(No question deltas ≥ ${SIGNIFICANT_DELTA} this survey. Ask if you want the full breakdown.)`;

    const text = `${takenLine}${notableBlock}`;
    return {
      label: "Partner Connection Survey",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
