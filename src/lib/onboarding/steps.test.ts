import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS_TOTAL, onboardingRouteFor } from "@/lib/session";

describe("onboarding steps", () => {
  it("opens with the welcome video and ends with the app tour", () => {
    expect(onboardingRouteFor(0)).toBe("/onboarding/welcome");
    expect(onboardingRouteFor(1)).toBe("/onboarding");
    expect(onboardingRouteFor(ONBOARDING_STEPS_TOTAL - 1)).toBe("/onboarding/tour");
    expect(onboardingRouteFor(ONBOARDING_STEPS_TOTAL)).toBe("/today");
  });

  it("keeps the form steps between the two videos", () => {
    expect(ONBOARDING_STEPS_TOTAL).toBe(8);
    expect(onboardingRouteFor(2)).toBe("/onboarding/profile");
    expect(onboardingRouteFor(6)).toBe("/onboarding/first-checkin");
  });
});
