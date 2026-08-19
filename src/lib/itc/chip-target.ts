import type { ItcStage } from "./stage";

/**
 * Which entry-input a chip tap should fill. The `itc-chip-fill`
 * custom event carries this as a discriminator so multiple listeners
 * (goal input, add-behavior form, etc.) can co-exist without
 * cross-firing.
 */
export type ChipTarget =
  | "goal"
  | "behavior"
  | "worry"
  | "commitment"
  | "assumption";

/**
 * Map a stage to the entry kind whose input a chip tap should fill.
 * Returns undefined for stages that don't have an entry-taking input
 * (review, immune_system, prioritize, test_design, test_running,
 * results, done). Chips on those stages should not exist; if they
 * do, listeners won't match and the tap is inert.
 */
export function chipTargetForStage(stage: ItcStage): ChipTarget | undefined {
  switch (stage) {
    case "goal":
      return "goal";
    case "behaviors":
      return "behavior";
    case "worries":
      return "worry";
    case "commitments":
      return "commitment";
    case "assumptions":
      return "assumption";
    default:
      return undefined;
  }
}
