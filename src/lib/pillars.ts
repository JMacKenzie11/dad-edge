/**
 * Pillar framework v1 — mirrors seed row in pillar_framework_versions.
 * Codes are stable; labels/colors are how the UI renders them.
 * A2 = Action (second A in BRAVEMAN).
 */
export type PillarCode = "B" | "R" | "A" | "V" | "E" | "M" | "A2" | "N";

/**
 * `domain` is the canonical short description of what each pillar
 * actually covers. Used verbatim in coach prompts so the model
 * doesn't guess (e.g. approve a fitness goal on Bond). Confirmed by
 * Jason 2026-08-18.
 */
export const PILLARS: {
  code: PillarCode;
  label: string;
  short: string;
  colorVar: string;
  domain: string;
}[] = [
  { code: "B", label: "Bond", short: "Bond", colorVar: "var(--color-pillar-b)", domain: "marriage / partner" },
  { code: "R", label: "Raise", short: "Raise", colorVar: "var(--color-pillar-r)", domain: "kids" },
  { code: "A", label: "Amplify", short: "Amplify", colorVar: "var(--color-pillar-a)", domain: "business / wealth" },
  { code: "V", label: "Vitality", short: "Vitality", colorVar: "var(--color-pillar-v)", domain: "how we fuel our mind and body" },
  { code: "E", label: "Enjoyment", short: "Enjoy", colorVar: "var(--color-pillar-e)", domain: "how we incorporate fun" },
  { code: "M", label: "Movement", short: "Movement", colorVar: "var(--color-pillar-m)", domain: "how we move our body" },
  { code: "A2", label: "Action", short: "Action", colorVar: "var(--color-pillar-a2)", domain: "derived — mission-execution consistency (not user-choose-able)" },
  { code: "N", label: "Network", short: "Network", colorVar: "var(--color-pillar-n)", domain: "how we connect and build relationships with people (especially the Boardroom group)" },
];

/**
 * A2 (Action) is derived — it measures mission completion, it isn't a
 * choice-able pillar for goals or missions. Use CHOOSABLE_PILLARS wherever
 * the user is picking a pillar.
 */
export const CHOOSABLE_PILLARS = PILLARS.filter((p) => p.code !== "A2");

export const PILLAR_BY_CODE: Record<PillarCode, (typeof PILLARS)[number]> = PILLARS.reduce(
  (acc, p) => ({ ...acc, [p.code]: p }),
  {} as Record<PillarCode, (typeof PILLARS)[number]>,
);
