/**
 * The onboarding wizard, in order. `users.onboarding_step` holds the index
 * of the first step he hasn't finished; ONBOARDING_STEPS_TOTAL means done.
 *
 * History:
 *   - 7 steps originally (identity, why, partner, kids, goal, mission,
 *     first check-in); 8 with the profile step added at step 1.
 *   - 6 from 2026-08-24, when goal and mission were hidden (their pages
 *     still exist under /onboarding/goal and /onboarding/mission).
 *   - 8 from 2026-11-10: the welcome video first and the app tour video
 *     last, both from the "welcome" Resource Library course. Migration
 *     20261110000003 moved everyone to the new numbering.
 *
 * Pure module (no Next imports) so tests and scripts can use it.
 */
export const STEP = {
  welcomeVideo: 0,
  identity: 1,
  profile: 2,
  why: 3,
  partner: 4,
  kids: 5,
  firstCheckin: 6,
  tourVideo: 7,
} as const;

export const ONBOARDING_ROUTES = [
  "/onboarding/welcome",
  "/onboarding",
  "/onboarding/profile",
  "/onboarding/why",
  "/onboarding/partner",
  "/onboarding/kids",
  "/onboarding/first-checkin",
  "/onboarding/tour",
] as const;

/** Resource Library course whose first and second lessons are the two videos. */
export const ONBOARDING_COURSE_SLUG = "welcome";

export const ONBOARDING_STEPS_TOTAL = ONBOARDING_ROUTES.length;

export function onboardingRouteFor(step: number): string {
  return ONBOARDING_ROUTES[step] ?? "/today";
}

/** "STEP n OF 8" for the page at this step index. */
export function stepNumber(step: number): number {
  return step + 1;
}
