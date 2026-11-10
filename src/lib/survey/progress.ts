/**
 * Partner Connection Survey progress rules, shared by the finish action and
 * the pages that show "n of 15 answered". Pure: no database.
 *
 * A question counts as answered when it has a score AND a note, because
 * finishing needs both (her words matter more than the number).
 */

export type DraftAnswer = { question_id: string; score: number | null; note: string | null };

export function isAnswered(a: Pick<DraftAnswer, "score" | "note"> | undefined): boolean {
  return !!a && a.score !== null && a.score >= 1 && a.score <= 5 && !!a.note?.trim();
}

export function answeredCount(questionIds: string[], answers: DraftAnswer[]): number {
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  return questionIds.filter((id) => isAnswered(byId.get(id))).length;
}

/** Why the survey can't be finished yet, or null when it can. */
export function finishBlocker(questionIds: string[], answers: DraftAnswer[]): string | null {
  if (questionIds.length === 0) return "This survey has no questions.";
  const byId = new Map(answers.map((a) => [a.question_id, a]));
  const noScore = questionIds.filter((id) => {
    const s = byId.get(id)?.score;
    return s === null || s === undefined;
  }).length;
  if (noScore > 0) return `Score every question. Missing ${noScore}.`;
  const noNote = questionIds.filter((id) => !byId.get(id)?.note?.trim()).length;
  if (noNote > 0) return `Notes required for every question. Missing ${noNote}. Her words matter.`;
  return null;
}
