/**
 * BACKWARDS-COMPAT SHIM.
 *
 * Renderer moved into `./criteria/render.ts` — one entry point that
 * powers both the hone audit and end-of-column construction reviews.
 * This file re-exports the old `renderAudit(findings, {goalText,
 * pillarLabel})` signature so audit-render.test.ts and coach.ts keep
 * working while task 4 rewires the caller. Task 6 deletes this file.
 */

import type { AuditFinding } from "./audit-rules";
import { renderFindings } from "./criteria/render";

export function renderAudit(
  findings: AuditFinding[],
  context: { goalText: string; pillarLabel: string },
): string {
  return renderFindings(findings, {
    goalText: context.goalText,
    pillarLabel: context.pillarLabel,
    mode: "hone",
  });
}
