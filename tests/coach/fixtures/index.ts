import { generalDaveTwoFires } from "./general-dave-two-fires";
import { missionSteveDinner } from "./mission-steve-dinner";
import type { Scenario } from "./types";

/**
 * Registered scenario fixtures. Adding a new scenario is: write the
 * .ts file next to this one, import + append to SCENARIOS.
 */
export const SCENARIOS: Scenario[] = [
  missionSteveDinner,
  generalDaveTwoFires,
];

export function scenarioBySlug(slug: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.slug === slug);
}

export type { Scenario } from "./types";
