import type { ContextBlock } from "@/lib/coach/context";
import type { Scenario } from "./types";

/**
 * Coach Larry comparison set (scripts/coach-larry-compare.ts). Each
 * opening line is a situation from the "Larry Coaching Style Analysis"
 * (§9.4 example exchanges, paraphrased and anonymised; no client names),
 * plus a few that test the shape of a conversation: a plain hello, a
 * win, a vague opener that should get questions before any advice, and
 * a follow-up on last week's step.
 *
 * One made-up member for all of them. His family's names don't overlap
 * Larry's (Jess, Mason, Ethan, Lawson, Colton), so a reply that mentions
 * those is Larry talking about his own life.
 */

const RYAN: ContextBlock[] = [
  {
    label: "The man",
    text: [
      "Name: Ryan Doyle",
      "Timezone: America/Chicago",
      "Community: The Basecamp",
      "Work: Regional sales manager, medical supplies · W2",
      "Why he showed up: We feel like roommates. I want my wife back and I want my kids to actually like being around me.",
    ].join("\n"),
    tokenEstimate: 60,
  },
  {
    label: "Family layer",
    text: [
      "  Partner: Kate (wife)",
      "  What he loves about her:",
      "    - She makes everyone feel welcome",
      "    - Her laugh when she's not tired",
      "  Kids:",
      "    - Jake (b. 2012-03-14) — loves: baseball; video games; tacos",
      "    - Lily (b. 2017-09-02) — loves: drawing; horses",
    ].join("\n"),
    tokenEstimate: 70,
  },
];

const RYAN_WEEK: ContextBlock[] = [
  {
    label: "Missions",
    text: [
      "Last 4 weeks: 5/8 completed (4 on time, 1 late, 3 missed)",
      "",
      "Upcoming:",
      "  - 2026-10-30 · Bond · Ask Kate one question from the conversation starters at dinner Thursday",
      "Recently completed:",
      "  - 2026-10-24 · Raise · Batting cage with Jake Saturday morning",
      "Recently missed (candidates for rollover):",
      "  - 2026-10-21 · Bond · Walk with Kate after the kids are down Tuesday",
    ].join("\n"),
    tokenEstimate: 90,
  },
];

function scenario(slug: string, headline: string, userMessage: string, history: Scenario["history"] = []): Scenario {
  return { slug, headline, mode: "general", cacheable: RYAN, volatile: RYAN_WEEK, history, userMessage };
}

export const LARRY_SCENARIOS: Scenario[] = [
  scenario("hello", "A plain hello", "Hey Larry."),
  scenario("vague", "Vague opener: questions before advice", "Things are just off at home lately."),
  scenario(
    "never-enough",
    "Never enough (§9.4 ex. 1)",
    "It's been a bad week. Whatever I do, it's like I'm doing nothing. Kate wants to talk during the day and I'm back-to-back with customers.",
  ),
  scenario(
    "logistics-only",
    "We only talk logistics (ex. 2)",
    "We used to be tight. Now it's all work and kids and schedules. We're not even friends anymore, honestly.",
  ),
  scenario(
    "fix-mode",
    "She vents, he fixes (ex. 3)",
    "When Kate vents my first reaction is to give her a solution. She keeps saying 'I just want you to listen.'",
  ),
  scenario(
    "teen-wont-hang",
    "Teen won't hang out (ex. 4)",
    "Jake's a teenager now. It's not cool hanging out with Dad. When I ask what he's watching he gets annoyed.",
  ),
  scenario(
    "forgot-defensive",
    "Forgot something, got defensive (ex. 5)",
    "Kate came at me because I forgot to pick up the one thing she asked for, and I started explaining everything that was going on that day. It turned into a fight.",
  ),
  scenario(
    "relapse",
    "Slipped back (ex. 6)",
    "Yesterday I reverted. Got triggered and it spiraled, I raised my voice. How do I claw my way back?",
  ),
  scenario(
    "hard-feedback",
    "Wife gives hard feedback (ex. 7)",
    "Kate told me last night, 'I feel like you don't love me. I'm at the bottom of your list.'",
  ),
  scenario(
    "does-she-choose-me",
    "Does she even choose me? (ex. 8)",
    "I'm not worried about coming off insecure. I am insecure. I don't know if Kate chooses me or if I'm just convenient.",
  ),
  scenario(
    "serious-boundary",
    "Serious boundary (ex. 9)",
    "Kate's planning an overnight work trip with the guy she had an emotional affair with last year. Should I be okay with that?",
  ),
  scenario(
    "dad-lecture",
    "Dad wants to teach every moment (ex. 10)",
    "What runs through my head with Jake is teach, teach, teach. I want every moment to be a life lesson.",
  ),
  scenario(
    "teen-why",
    "Why do you treat me like this (ex. 11)",
    "I want to tell Jake, 'I do all these things for you. Why do you treat me like your target?'",
  ),
  scenario(
    "initiate-needy",
    "Initiating without neediness (ex. 12)",
    "When I want to be intimate I usually say something like, 'Hey, it's been a while, I was kind of hoping we could...' and it never goes anywhere.",
  ),
  scenario(
    "fix-mode-facts",
    "Second turn: the facts are in, time to teach and script",
    "Mostly work stuff, her boss piles on her. Last night she was telling me about it and I said she should just go to HR, and she shut down and went to bed.",
    [
      { role: "user", content: "When Kate vents my first reaction is to give her a solution. She keeps saying 'I just want you to listen.'" },
      { role: "assistant", content: "That's one of the most common spots a man gets stuck, brother. When she's venting, what's it usually about? Work, the kids, her family?" },
    ],
  ),
  scenario(
    "forgot-facts",
    "Second turn: he owns it, time for the owning script",
    "Milk for Lily's lunch. She said, 'I asked you one thing.' I said I had back-to-back calls and the store was out of my way and she should've texted me a reminder.",
    [
      { role: "user", content: "Kate came at me because I forgot to pick up the one thing she asked for, and I started explaining everything that was going on that day. It turned into a fight." },
      { role: "assistant", content: "I know that spot. What did you forget, and what did she say to you, word for word?" },
    ],
  ),
  scenario(
    "teen-facts",
    "Second turn: find his levers",
    "Usually when he's on his phone after dinner. I'll ask what he's watching and he says 'nothing' and goes to his room.",
    [
      { role: "user", content: "Jake's a teenager now. It's not cool hanging out with Dad. When I ask what he's watching he gets annoyed." },
      { role: "assistant", content: "That's pretty standard at his age. Walk me through it. When do you usually ask him, and what does he do?" },
    ],
  ),
  scenario(
    "win-follow-up",
    "A win, and last week's step",
    "Good week. I did the walk with Kate on Tuesday after all, and Saturday at the batting cage Jake actually talked to me the whole drive.",
    [
      { role: "user", content: "I keep skipping the walk with Kate. Something always comes up." },
      {
        role: "assistant",
        content:
          "Here's one thing I want you to do this week. Put the walk on the calendar for Tuesday after the kids are down, twenty minutes, phones stay home. Tell me how it went.",
      },
    ],
  ),
];
