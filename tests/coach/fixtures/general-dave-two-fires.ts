import type { Scenario } from "./types";

/**
 * General-mode fixture. Dave K (returning profile) — was engaged
 * two quarters ago, dropped off, back this month. Marriage is
 * strained and his top salesperson just gave notice on the same day.
 * Two dimensions in one message (marriage + business) per the spec's
 * ask for the general-mode transcript.
 *
 * Exercises the family layer + partner survey delta (last survey
 * shows a drop) + goals + missions + reflections. No ITC map. The
 * coach's job here is NOT to close on a mission — spec is explicit
 * that general mode diagnoses before prescribing, and the OTFW
 * method spine says ask ONE question when the man is still
 * processing. Watching whether the coach holds that line under
 * mission-mode-adjacent surface pressure ("what do I do first") is
 * the whole test.
 */
export const generalDaveTwoFires: Scenario = {
  slug: "general-dave-two-fires",
  headline:
    "Dave K (returning member) · general mode · marriage strain + top rep quitting same day",
  mode: "general",

  cacheable: [
    {
      label: "The man",
      text: [
        "Name: Dave K",
        "Timezone: America/New_York",
        "Community: The Basecamp",
        "Work: Owner, Kellerman Roofing (12 employees) · Business owner",
        "Why he showed up: My wife told me I'm not the man she married. Came back this month after ghosting for two months.",
      ].join("\n"),
      tokenEstimate: 70,
    },
    {
      label: "Family layer",
      text: [
        "  Partner: Jen (wife)",
        "  What he loves about her:",
        "    - She's the one who kept the family together when Dad died",
        "    - She still laughs at my dumb jokes when she wants to",
        "  Kids:",
        "    - Mason (b. 2012-06-08) — loves: hockey; video games; his uncle",
        "    - Sadie (b. 2016-11-30) — loves: her ballet class; hiding notes for me in my truck",
      ].join("\n"),
      tokenEstimate: 90,
    },
    {
      label: "Partner Connection Survey",
      text: [
        "Last taken 2026-08-10 · Composite 2.6/5 (prior 3.4, Δ -0.8)",
        "Notable questions this time:",
        '  Q3: I feel like a priority in his life → 2/5 ↓ — "There\'s always something more important than me."',
        '  Q7: We talk about things that matter → 2/5 ↓ — "It\'s all logistics anymore."',
        "  Q12: I trust him to handle it when things get hard → 3/5 ↓",
      ].join("\n"),
      tokenEstimate: 100,
    },
  ],

  volatile: [
    {
      label: "Daily Living — this week vs last week",
      text: [
        "Engagement streak: 4 days",
        "  Bond       this wk 1/7  ↑  (last wk 0/7)",
        "  Raise      this wk 2/7  ↑  (last wk 1/7)",
        "  Amplify    this wk 5/7  →  (last wk 5/7)",
        "  Vitality   this wk 1/7  →  (last wk 1/7)",
        "  Enjoyment  this wk 0/7  →  (last wk 0/7)",
        "  Movement   this wk 0/7  →  (last wk 0/7)",
        "  Action     this wk 3/7  ↑  (last wk 2/7)",
        "  Network    this wk 1/7  →  (last wk 1/7)",
      ].join("\n"),
      tokenEstimate: 110,
    },
    {
      label: "Quarterly goals",
      text: [
        "Days left in the quarter: 34",
        "  - Bond [needs review]",
        "    Finish line: One real conversation with Jen a week, no screens, no logistics.",
        "    Start line: We haven't had one since Sadie's birthday party.",
        "    Midpoint check-in: Missed three weeks in a row. Feel like I'm losing her.",
        "  - Amplify",
        "    Finish line: Hire a second crew lead so I'm not the bottleneck on estimates.",
        "    Start line: I'm still doing every estimate personally, 40+ hours a week.",
      ].join("\n"),
      tokenEstimate: 110,
    },
    {
      label: "Missions",
      text: [
        "Last 4 weeks: 3/9 completed (2 on time, 1 late, 6 missed)",
        "",
        "Upcoming:",
        "  - 2026-08-30 · Bond · Take Jen out Saturday, no phone, no shop talk",
        "  - 2026-09-02 · Amplify · Post the crew lead job Wednesday",
        "Recently completed:",
        "  - 2026-08-25 · Amplify · Send July invoices",
        "  - 2026-08-24 · Amplify · Payroll",
        "Recently missed (candidates for rollover):",
        "  - 2026-08-18 · Bond · Walk with Jen Tuesday",
        "  - 2026-08-15 · Bond · Family dinner Friday, phone in the drawer",
        "  - 2026-08-13 · Raise · Take Mason to hockey practice",
      ].join("\n"),
      tokenEstimate: 180,
    },
    {
      label: "Daily reflections (wins / learnings — last 7 days, most recent first)",
      text: [
        "  2026-08-26",
        "    Learn: Marcus quit today. My top rep. Said he wants to build his own book. I've got no cushion.",
        "  2026-08-25",
        "    Wins: Actually asked Sadie about her day and she talked for 20 minutes.",
        "    Learn: Went to bed at midnight after payroll. Jen was already asleep, again.",
        "  2026-08-23",
        "    Learn: Jen asked if I even want to be here. Didn't answer. Should have.",
      ].join("\n"),
      tokenEstimate: 130,
    },
  ],

  history: [],

  userMessage:
    "My wife barely talks to me anymore and my top salesperson just gave notice on the same day. I don't know what fire to put out first and I feel like I'm failing at both.",
};
