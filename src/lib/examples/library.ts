import type { DomainCode } from "@/lib/pillars";

/**
 * Prewritten goals and missions a man can start from (DECISIONS.md
 * "Start from an example"). Picking one fills the box; every word stays
 * his to edit. A [blank] is a spot only he can fill (a name, a number);
 * the form selects the first one so he types straight over it, and
 * nothing saves while one is left (`blanksIn`, checked on the server
 * too).
 *
 * How they're written:
 *  - Missions: one behavior with its specifics, done or not done, and
 *    no day names. He picks the days on the row, and a count in the
 *    wording matches the days he picks. Each scores 10/10 as written.
 *  - Goals: what's true at the end of the quarter, with a count or a
 *    number, so there's a finish line.
 *  - Five of each per domain (Jason, 2026-11-12).
 *
 * Ids are stable: analytics records which example a mission or goal
 * started from (mission_created / goal_created `example_id`), so the
 * ones men pick and finish can be told from the ones they skip. Change
 * the wording freely; give a new example a new id.
 */
export type Example = { id: string; text: string };

export const MISSION_EXAMPLES: Record<DomainCode, Example[]> = {
  B: [
    { id: "b-m-dinner", text: "Take [her name] to dinner with phones in the car, and ask her three questions about her that aren't about the kids or the calendar." },
    { id: "b-m-note", text: "Write [her name] a handwritten note about one thing I saw her do this week, and leave it where she'll find it in the morning." },
    { id: "b-m-house", text: "Take the kids out for three hours so [her name] has the house to herself." },
    { id: "b-m-plan-date", text: "Plan our next date from start to finish: book it, line up the sitter, and tell her the time." },
    { id: "b-m-15min", text: "Sit with [her name] for 15 minutes after the kids are in bed, phones in another room, and ask about her week." },
  ],
  R: [
    { id: "r-m-breakfast", text: "Take [kid's name] to breakfast, just the two of us, phone in the car." },
    { id: "r-m-bedtime", text: "Put [kid's name] to bed with a story and one question about the best part of their day." },
    { id: "r-m-play", text: "Play 30 minutes of whatever [kid's name] picks, with no phone in the room." },
    { id: "r-m-note", text: "Write [kid's name] a note about one thing I saw them do well, and put it in their lunch or on their pillow." },
    { id: "r-m-drive", text: "Drive [kid's name] to school with the radio off so we talk." },
  ],
  A: [
    { id: "a-m-plan", text: "Do a 90-minute planning block before opening email, and pick the three things that matter most this week, in order." },
    { id: "a-m-followup", text: "Send 10 follow-up messages to past clients or warm leads." },
    { id: "a-m-laptop", text: "Shut the laptop at 5:30 pm and leave it shut until morning." },
    { id: "a-m-conversation", text: "Have the conversation with [name] about [topic] that I've been putting off." },
    { id: "a-m-deep-work", text: "Spend two hours with my phone off on [project], and finish one piece of it." },
  ],
  V: [
    { id: "v-m-lift", text: "Lift weights for 45 minutes." },
    { id: "v-m-walk", text: "Walk 30 minutes outside after dinner." },
    { id: "v-m-sleep", text: "Lights off by 10:30 pm, with the phone charging outside the bedroom." },
    { id: "v-m-cook", text: "Cook dinner at home, nothing from a drive-through." },
    { id: "v-m-water", text: "Drink three liters of water and log it." },
  ],
  E: [
    { id: "e-m-hobby", text: "Spend two hours on [hobby] with my phone in another room." },
    { id: "e-m-friends", text: "Book a night out with two friends for next month and put it on the family calendar." },
    { id: "e-m-outside", text: "Spend an hour outside doing something I enjoy that has nothing to do with work." },
    { id: "e-m-play", text: "Play [sport or game] with [friend's name]." },
    { id: "e-m-read", text: "Read 30 pages of a book I picked for fun." },
  ],
};

export const GOAL_EXAMPLES: Record<DomainCode, Example[]> = {
  B: [
    { id: "b-g-dates", text: "By the end of the quarter, [her name] and I have had 10 date nights out of the house, with phones in the car and no talk about kids, money or schedules for the first hour." },
    { id: "b-g-checkin", text: "By the end of the quarter, [her name] and I have had our 20-minute Sunday night check-in 12 weeks in a row: what went well, what's coming, and one thing she needs from me." },
    { id: "b-g-survey", text: "By the end of the quarter, my Partner Connection Survey score is higher than it is today." },
    { id: "b-g-plate", text: "By the end of the quarter, I've taken one job off [her name]'s plate every week without being asked, 12 in total." },
    { id: "b-g-overnight", text: "By the end of the quarter, [her name] and I have had one night away, just the two of us, planned and booked by me." },
  ],
  R: [
    { id: "r-g-outings", text: "By the end of the quarter, I've had 12 one-on-one outings, rotating through each of my kids, with my phone in the car and the kid choosing what we do." },
    { id: "r-g-bedtime", text: "By the end of the quarter, I've put [kid's name] to bed four nights a week, with a story and one question about their day." },
    { id: "r-g-repair", text: "By the end of the quarter, every time I've lost my temper with one of my kids, I've gone back and apologized the same day, and I've kept count." },
    { id: "r-g-games", text: "By the end of the quarter, I've been at [kid's name]'s [games or practices] every week, 12 weeks in a row, with my phone in my pocket." },
    { id: "r-g-dinner", text: "By the end of the quarter, we eat dinner at the table with no screens five nights a week." },
  ],
  A: [
    { id: "a-g-revenue", text: "By the end of the quarter, revenue is [$X] a month, up from [$Y] today." },
    { id: "a-g-planning", text: "By the end of the quarter, I've held a 90-minute planning block every Monday morning, 12 weeks in a row, before opening email." },
    { id: "a-g-stop", text: "By the end of the quarter, I've stopped work by [time] four nights a week, and I've kept count." },
    { id: "a-g-handoff", text: "By the end of the quarter, [name] runs [task] without me, from a written checklist." },
    { id: "a-g-sales", text: "By the end of the quarter, I've had [number] sales conversations with new prospects." },
  ],
  V: [
    { id: "v-g-weight", text: "By the end of the quarter, I weigh [target] lbs, down from [today] lbs." },
    { id: "v-g-train", text: "By the end of the quarter, I've trained three times a week, 36 sessions in total." },
    { id: "v-g-alcohol", text: "No alcohol Sunday through Thursday for the whole quarter." },
    { id: "v-g-sleep", text: "By the end of the quarter, I've slept seven hours or more five nights a week, tracked on my phone or watch." },
    { id: "v-g-strength", text: "By the end of the quarter, I can [lift or run target], up from [today's number]." },
  ],
  E: [
    { id: "e-g-hobby", text: "By the end of the quarter, I've spent three hours a week on [hobby], 36 hours in total." },
    { id: "e-g-friends", text: "By the end of the quarter, I've had three nights out with friends, each booked a month ahead." },
    { id: "e-g-together", text: "By the end of the quarter, I've done [activity] with [friend's name] once a month, three times in total." },
    { id: "e-g-project", text: "By the end of the quarter, I've finished [project I've been putting off]." },
    { id: "e-g-family-day", text: "By the end of the quarter, our family has had one full day out every month, three in total, planned by me." },
  ],
};

/** A spot only he can fill: "[kid's name]", "[$X]". */
const BLANK_RE = /\[[^[\]\n]{1,40}\]/g;

/** The blanks left in his text, in order. */
export function blanksIn(text: string): string[] {
  return text.match(BLANK_RE) ?? [];
}

/** "Fill in [kid's name] first." / "Fill in [name] and [topic] first." */
export function blanksMessage(blanks: string[]): string {
  const list = blanks.length <= 1 ? blanks.join("") : `${blanks.slice(0, -1).join(", ")} and ${blanks[blanks.length - 1]}`;
  return `Fill in ${list} first.`;
}

/** Where the first blank sits, to select it so he types over it. */
export function firstBlankRange(text: string): [number, number] | null {
  const m = new RegExp(BLANK_RE.source).exec(text);
  return m ? [m.index, m.index + m[0].length] : null;
}
