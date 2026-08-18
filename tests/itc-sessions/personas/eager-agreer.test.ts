/**
 * Persona: the eager agreer.
 *
 * Says "yes," "that works," "perfect" constantly but taps nothing
 * until pushed. This persona exists to prove the load-bearing
 * invariant of the ITC State Rebuild: language alone never changes
 * state. Only a card tap or a direct panel entry mutates the map.
 *
 * Assertions:
 *   - Zero proposals reach status `locked` or `edited_locked` during
 *     the run (nothing was tapped).
 *   - Any proposals the coach fires exist as `pending`.
 *   - The map's improvement_goal, behaviors, worries, commitments,
 *     assumptions, and current_stage are unchanged from the seed
 *     (no language-inferred locks slipped through).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanupPersonaMap,
  coacheeSendsChat,
  installPersonaLLM,
  readFinalMapState,
  seedPersonaMap,
  type PersonaContext,
} from "../harness";

installPersonaLLM("eager-agreer.json");

describe("persona: eager agreer", () => {
  let ctx: PersonaContext;
  const affirmations = [
    "Yeah that works.",
    "Perfect.",
    "That's exactly it.",
    "Yes, lock it in.",
    "Sounds good, keep going.",
  ];

  beforeAll(async () => {
    ctx = await seedPersonaMap({
      pillar: "B",
      goalText:
        "I'm committed to getting better at being present and calm when my wife is upset with me rather than being defensive.",
      behaviors: ["I bring up things she did in the past instead of listening"],
      jumpToStage: "behaviors",
    });
  });

  afterAll(async () => {
    await cleanupPersonaMap(ctx);
  });

  it(
    "affirmations alone never lock any proposal or advance the map",
    async () => {
      // Send five turns of pure affirmation.
      for (const msg of affirmations) {
        await coacheeSendsChat(ctx, msg);
      }

      const state = await readFinalMapState(ctx);

      const locked = state.proposals.filter(
        (p) => p.status === "locked" || p.status === "edited_locked",
      );
      expect(
        locked.length,
        `Expected zero locked/edited_locked proposals from affirmations alone. Got ${locked.length}:\n${JSON.stringify(
          locked.map((p) => ({ action_type: p.action_type, status: p.status })),
          null,
          2,
        )}`,
      ).toBe(0);

      // Map must not have advanced past behaviors — no advance_stage
      // tool call is legitimate when the coach just heard "yes."
      expect(state.map?.current_stage).toBe("behaviors");

      // Goal + seeded behavior remain unchanged.
      expect(state.map?.improvement_goal).toContain("being present and calm");
      const selected = state.behaviors.filter((b) => b.selected);
      expect(selected.length).toBe(1);
      expect(selected[0].text).toBe(
        "I bring up things she did in the past instead of listening",
      );

      // No worries/commitments/assumptions should have appeared from
      // language alone.
      expect(state.worries.length).toBe(0);
      expect(state.commitments.length).toBe(0);
      expect(state.assumptions.length).toBe(0);
    },
    240_000,
  );
});
