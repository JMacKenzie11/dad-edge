/**
 * Thin wrapper around runItcCoachTurn for tests. Calls the real coach
 * (real Anthropic API, real prompts) — no LLM mocking here. State-machine
 * tests that don't need the real coach live elsewhere and mock the whole
 * turn.
 */

import { runItcCoachTurn, type CoachReply } from "@/lib/itc/coach";
import type { CoachTurnInput } from "./fake-map";

export async function callCoach(input: CoachTurnInput): Promise<CoachReply> {
  return await runItcCoachTurn(input);
}

/**
 * Run the same fixture N times and return every reply. Useful for
 * probing LLM non-determinism when a scenario is flaky. Serial (not
 * parallel) so we don't rate-limit ourselves on the API.
 */
export async function callCoachN(
  input: CoachTurnInput,
  n: number,
): Promise<CoachReply[]> {
  const results: CoachReply[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await runItcCoachTurn(input));
  }
  return results;
}
