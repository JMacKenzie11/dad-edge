import type { Scenario } from "./types";

/**
 * Mission-mode fixture. Steve W (grinder profile from the seed script)
 * — a business owner running hard who's noticed he's been on his phone
 * at dinner three weeks running. High mission-completion rate this
 * quarter but the pattern he's naming isn't one his mission list has
 * caught yet.
 *
 * Exercises: goals + missions + streaks + family + reflections
 * providers. No ITC map (null). No survey (null). Cacheable prefix
 * has identity + family only. The coach should propose a mission
 * grounded in the family layer (kids' names / dinner) and the
 * observation he's already made (phone at dinner), not a generic
 * "be more present."
 */
export const missionSteveDinner: Scenario = {
  slug: "mission-steve-dinner",
  headline:
    "Steve W (grinder / business owner) · mission mode · dinner presence with kids",
  mode: "mission",

  cacheable: [
    {
      label: "The man",
      text: [
        "Name: Steve W",
        "Timezone: America/Chicago",
        "Community: The Basecamp",
        "Work: Owner, Whitmore Contracting · Business owner",
        "Why he showed up: Wife told me the kids don't tell me stuff anymore because I'm on my phone.",
      ].join("\n"),
      tokenEstimate: 60,
    },
    {
      label: "Family layer",
      text: [
        "  Partner: Kate (wife)",
        "  What he loves about her:",
        "    - She calls me out when I need it",
        "    - She still puts a coffee on my desk without asking",
        "  Kids:",
        "    - Owen (b. 2015-09-14) — loves: soccer; dinosaurs; the trampoline",
        "    - Ella (b. 2018-03-22) — loves: reading with him; drawing",
        "  Coming up in the next 30 days:",
        "    - 2026-09-14 · Owen's birthday · in 18 days",
      ].join("\n"),
      tokenEstimate: 90,
    },
  ],

  volatile: [
    {
      label: "Daily Living — this week vs last week",
      text: [
        "Engagement streak: 21 days",
        "  Bond       this wk 3/7  →  (last wk 3/7)",
        "  Raise      this wk 2/7  ↓  (last wk 4/7)",
        "  Amplify    this wk 6/7  →  (last wk 6/7)",
        "  Vitality   this wk 5/7  ↑  (last wk 4/7)",
        "  Enjoyment  this wk 1/7  ↓  (last wk 3/7)",
        "  Movement   this wk 5/7  →  (last wk 5/7)",
        "  Action     this wk 4/7  ↑  (last wk 3/7)",
        "  Network    this wk 2/7  →  (last wk 2/7)",
      ].join("\n"),
      tokenEstimate: 110,
    },
    {
      label: "Quarterly goals",
      text: [
        "Days left in the quarter: 34",
        "  - Amplify",
        "    Finish line: Hit $80K monthly recurring by end of quarter.",
        "    Start line: Been stuck at $55-60K for two quarters running.",
        "  - Raise",
        "    Finish line: Owen and Ella tell me one real thing about their day, four dinners a week.",
        "    Start line: Right now I couldn't tell you what either of them did at school Tuesday.",
      ].join("\n"),
      tokenEstimate: 100,
    },
    {
      label: "Missions",
      text: [
        "Last 4 weeks: 14/17 completed (11 on time, 3 late, 3 missed)",
        "",
        "Upcoming:",
        "  - 2026-08-28 · Amplify · Cold-call 5 prospects from the July list",
        "  - 2026-08-29 · Movement · Deadlift session (350 x1 attempt)",
        "  - 2026-08-30 · Bond · Take Kate for coffee, no phones",
        "  - 2026-09-01 · Raise · Family park trip Sunday afternoon",
        "Recently completed:",
        "  - 2026-08-24 · Amplify · Close the Miller contract by Friday",
        "  - 2026-08-22 · Movement · Deadlift 5x5 @ 315",
        "  - 2026-08-20 · Raise · Read to Ella at bedtime, three nights",
        "Recently missed (candidates for rollover):",
        "  - 2026-08-19 · Bond · Kate + walk after dinner Tuesday",
      ].join("\n"),
      tokenEstimate: 180,
    },
    {
      label: "Daily reflections (wins / learnings — last 7 days, most recent first)",
      text: [
        "  2026-08-25",
        "    Wins: Closed Miller. Owen scored two goals.",
        "    Learn: I was on my phone half of Owen's game and he called it out on the ride home. Rough one.",
        "  2026-08-23",
        "    Learn: Kate said dinner felt like eating alone with the kids. She's not wrong.",
        "  2026-08-21",
        "    Wins: Deadlift PR at 340.",
      ].join("\n"),
      tokenEstimate: 120,
    },
  ],

  history: [],

  userMessage:
    "I keep saying I'll be more present with my kids at dinner but three weeks in a row I've been on my phone. What do I actually do this week?",
};
