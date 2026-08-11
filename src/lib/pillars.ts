/**
 * Pillar framework v1 — mirrors seed row in pillar_framework_versions.
 * Codes are stable; labels/colors are how the UI renders them.
 * A2 = Action (second A in BRAVEMAN).
 */
export type PillarCode = "B" | "R" | "A" | "V" | "E" | "M" | "A2" | "N";

export const PILLARS: {
  code: PillarCode;
  label: string;
  short: string;
  colorVar: string;
}[] = [
  { code: "B", label: "Bond", short: "Bond", colorVar: "var(--color-pillar-b)" },
  { code: "R", label: "Raise", short: "Raise", colorVar: "var(--color-pillar-r)" },
  { code: "A", label: "Amplify", short: "Amplify", colorVar: "var(--color-pillar-a)" },
  { code: "V", label: "Vitality", short: "Vitality", colorVar: "var(--color-pillar-v)" },
  { code: "E", label: "Enjoyment", short: "Enjoy", colorVar: "var(--color-pillar-e)" },
  { code: "M", label: "Movement", short: "Movement", colorVar: "var(--color-pillar-m)" },
  { code: "A2", label: "Action", short: "Action", colorVar: "var(--color-pillar-a2)" },
  { code: "N", label: "Network", short: "Network", colorVar: "var(--color-pillar-n)" },
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
