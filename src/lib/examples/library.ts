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
 *  - Fifteen of each per domain; the form shows five at a time and
 *    "Show other examples" brings up the next five (Jason, 2026-11-13).
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
    { id: "b-m-15min", text: "Spend 15 minutes with [her name] after the kids are in bed, phones in another room, and ask about her week." },
    { id: "b-m-chore", text: "Take one job off [her name]'s list without being asked, and finish it." },
    { id: "b-m-walk", text: "Walk with [her name] for 30 minutes after dinner, phones left at home." },
    { id: "b-m-text", text: "Text [her name] in the middle of the day with one specific thing I love about her." },
    { id: "b-m-easier", text: "Ask [her name] what one thing would make her week easier, and get it done by the weekend." },
    { id: "b-m-coffee", text: "Get up 20 minutes before [her name], make her coffee, and have the kitchen clean when she comes down." },
    { id: "b-m-book", text: "Book the [restaurant or activity] [her name] mentioned wanting to try, and tell her the date." },
    { id: "b-m-thanks", text: "Thank [her name] in front of the kids for one specific thing she did this week." },
    { id: "b-m-bedtime", text: "Run the kids' whole bedtime on my own so [her name] has the evening off." },
    { id: "b-m-dream", text: "Ask [her name] what she'd do with a free year, and listen for 20 minutes without fixing anything." },
    { id: "b-m-hug", text: "Greet [her name] with a 20-second hug before I say anything about my day." },
  ],
  R: [
    { id: "r-m-breakfast", text: "Take [kid's name] to breakfast, just the two of us, phone in the car." },
    { id: "r-m-bedtime", text: "Put [kid's name] to bed with a story and one question about the best part of their day." },
    { id: "r-m-play", text: "Play 30 minutes of whatever [kid's name] picks, with no phone in the room." },
    { id: "r-m-note", text: "Write [kid's name] a note about one thing I saw them do well, and put it in their lunch or on their pillow." },
    { id: "r-m-drive", text: "Drive [kid's name] to school with the radio off so we talk." },
    { id: "r-m-teach", text: "Teach [kid's name] how to [skill] for 30 minutes." },
    { id: "r-m-cook", text: "Cook dinner with [kid's name], and let them pick the recipe." },
    { id: "r-m-hardest", text: "Ask each of my kids at dinner about the hardest part of their day, and listen without giving advice." },
    { id: "r-m-proud", text: "Tell [kid's name] one specific thing I'm proud of them for, face to face, with no \"but\" after it." },
    { id: "r-m-yes", text: "Say yes to the first game [kid's name] asks me to play when I get home, and play it for 20 minutes." },
    { id: "r-m-outside", text: "Take [kid's name] outside for an hour: a bike ride, a hike or a ball in the yard." },
    { id: "r-m-their-plan", text: "Let [kid's name] plan a family outing, and do it the way they planned it." },
    { id: "r-m-story", text: "Tell [kid's name] a story from when I was their age, including one time I failed." },
    { id: "r-m-apologize", text: "Apologize to [kid's name] for the last time I lost my temper, and ask how it felt for them." },
    { id: "r-m-homework", text: "Do homework time with [kid's name] for 30 minutes, phone in another room." },
  ],
  A: [
    { id: "a-m-plan", text: "Do a 90-minute planning block before opening email, and pick the three things that matter most this week, in order." },
    { id: "a-m-followup", text: "Send 10 follow-up messages to past clients or warm leads." },
    { id: "a-m-laptop", text: "Shut the laptop at 5:30 pm and leave it shut until morning." },
    { id: "a-m-conversation", text: "Have the conversation with [name] about [topic] that I've been putting off." },
    { id: "a-m-deep-work", text: "Spend two hours with my phone off on [project], and finish one piece of it." },
    { id: "a-m-hardest", text: "Finish the hardest task on my list before 10 am, before email or messages." },
    { id: "a-m-review", text: "Do a 30-minute end-of-week review: what got done, what slipped, and the three priorities for next week." },
    { id: "a-m-feedback", text: "Ask [name] for honest feedback on [project], and write down what they say." },
    { id: "a-m-delegate", text: "Hand [task] to [name] with a written checklist, and don't take it back." },
    { id: "a-m-outreach", text: "Ask three people I'd like to learn from for a 20-minute call each." },
    { id: "a-m-inbox", text: "Get my inbox to zero, and turn off email notifications on my phone." },
    { id: "a-m-learn", text: "Spend 45 minutes learning [skill] for my work." },
    { id: "a-m-numbers", text: "Go through the numbers for [business or team] for 30 minutes, and write down one decision they point to." },
    { id: "a-m-meeting", text: "Cancel or shorten one recurring meeting that doesn't need me." },
    { id: "a-m-tomorrow", text: "Write the next day's top three tasks before I close the laptop." },
  ],
  V: [
    { id: "v-m-lift", text: "Lift weights for 45 minutes." },
    { id: "v-m-walk", text: "Walk 30 minutes outside after dinner." },
    { id: "v-m-sleep", text: "Lights off by 10:30 pm, with the phone charging outside the bedroom." },
    { id: "v-m-cook", text: "Cook dinner at home, nothing from a drive-through." },
    { id: "v-m-water", text: "Drink three liters of water and log it." },
    { id: "v-m-run", text: "Run [distance or minutes] at an easy pace." },
    { id: "v-m-stretch", text: "Do 15 minutes of stretching or mobility work before bed." },
    { id: "v-m-no-alcohol", text: "No alcohol, all day." },
    { id: "v-m-no-sweets", text: "No sweets or soda, all day." },
    { id: "v-m-steps", text: "Hit 10,000 steps, checked on my phone or watch." },
    { id: "v-m-protein", text: "Eat a breakfast with at least 30 grams of protein before 9 am." },
    { id: "v-m-screens", text: "No screens for the last 30 minutes before bed." },
    { id: "v-m-sunlight", text: "Get 10 minutes of sunlight outside within an hour of waking up." },
    { id: "v-m-appointment", text: "Book the [checkup or appointment] I've been putting off." },
    { id: "v-m-quiet", text: "Take 10 minutes of quiet, prayer or slow breathing before I look at my phone in the morning." },
  ],
  E: [
    { id: "e-m-hobby", text: "Spend two hours on [hobby] with my phone in another room." },
    { id: "e-m-friends", text: "Book a night out with two friends for next month and put it on the family calendar." },
    { id: "e-m-outside", text: "Spend an hour outside doing something I enjoy that has nothing to do with work." },
    { id: "e-m-play", text: "Play [sport or game] with [friend's name]." },
    { id: "e-m-read", text: "Read 30 pages of a book I picked for fun." },
    { id: "e-m-album", text: "Listen to a full album start to finish with nothing else going on, phone face down." },
    { id: "e-m-call", text: "Call [friend's name] for 20 minutes just to catch up." },
    { id: "e-m-new", text: "Try one thing I've never done: [food, class or place]." },
    { id: "e-m-trip", text: "Spend 30 minutes planning [trip] and put the dates on the calendar." },
    { id: "e-m-hands", text: "Spend an hour making something with my hands: [project]." },
    { id: "e-m-game-night", text: "Host a game night with [friend's name] and their family." },
    { id: "e-m-movie", text: "Watch a movie I've wanted to see from start to finish, phone in another room." },
    { id: "e-m-solo", text: "Take two hours on my own for something I enjoy, and tell [her name] ahead of time." },
    { id: "e-m-sign-up", text: "Sign up for the [league, race or class] I've been thinking about." },
    { id: "e-m-half-day", text: "Spend half a day [fishing, hiking or hunting]." },
  ],
};

export const GOAL_EXAMPLES: Record<DomainCode, Example[]> = {
  B: [
    { id: "b-g-dates", text: "By the end of the quarter, [her name] and I have had 10 date nights out of the house, with phones in the car and no talk about kids, money or schedules for the first hour." },
    { id: "b-g-checkin", text: "By the end of the quarter, [her name] and I have had our 20-minute Sunday night check-in 12 weeks in a row: what went well, what's coming, and one thing she needs from me." },
    { id: "b-g-survey", text: "By the end of the quarter, my Partner Connection Survey score is higher than it is today." },
    { id: "b-g-plate", text: "By the end of the quarter, I've taken one job off [her name]'s plate every week without being asked, 12 in total." },
    { id: "b-g-overnight", text: "By the end of the quarter, [her name] and I have had one night away, just the two of us, planned and booked by me." },
    { id: "b-g-notes", text: "By the end of the quarter, I've written [her name] 12 handwritten notes, one a week, each about something specific I saw her do." },
    { id: "b-g-walks", text: "By the end of the quarter, [her name] and I have walked together after dinner twice a week, 24 walks in total." },
    { id: "b-g-phones", text: "By the end of the quarter, our phones have stayed out of the bedroom every night, and I've kept count of any night we slipped." },
    { id: "b-g-repair", text: "By the end of the quarter, every argument with [her name] has ended with me going back within a day to make it right, and I've kept count." },
    { id: "b-g-easier", text: "By the end of the quarter, I've asked [her name] every week what would make her week easier and done it, 12 weeks in a row." },
    { id: "b-g-mornings", text: "By the end of the quarter, I've handled the kids' mornings three days a week, so [her name] has those mornings to herself." },
    { id: "b-g-trip", text: "By the end of the quarter, I've planned and booked a weekend away for [her name] and me." },
    { id: "b-g-thanks", text: "By the end of the quarter, I've thanked [her name] for something specific every day, and I've kept count." },
    { id: "b-g-her-time", text: "By the end of the quarter, [her name] has had four hours a week to herself, 12 weeks in a row, with me covering the kids." },
    { id: "b-g-together", text: "By the end of the quarter, [her name] and I have done [class or activity] together six times." },
  ],
  R: [
    { id: "r-g-outings", text: "By the end of the quarter, I've had 12 one-on-one outings, rotating through each of my kids, with my phone in the car and the kid choosing what we do." },
    { id: "r-g-bedtime", text: "By the end of the quarter, I've put [kid's name] to bed four nights a week, with a story and one question about their day." },
    { id: "r-g-repair", text: "By the end of the quarter, every time I've lost my temper with one of my kids, I've gone back and apologized the same day, and I've kept count." },
    { id: "r-g-games", text: "By the end of the quarter, I've been at [kid's name]'s [games or practices] every week, 12 weeks in a row, with my phone in my pocket." },
    { id: "r-g-dinner", text: "By the end of the quarter, we eat dinner at the table with no screens five nights a week." },
    { id: "r-g-teach", text: "By the end of the quarter, I've taught [kid's name] to [skill], and they can do it without me." },
    { id: "r-g-breakfast", text: "By the end of the quarter, I've taken each of my kids to breakfast one-on-one once a month, three times each." },
    { id: "r-g-books", text: "By the end of the quarter, [kid's name] and I have read [number] books together." },
    { id: "r-g-yelling", text: "By the end of the quarter, I've gone 30 days in a row without yelling at my kids, and I've kept count." },
    { id: "r-g-chore", text: "By the end of the quarter, [kid's name] does [chore] on their own every week, after I've taught it side by side." },
    { id: "r-g-tradition", text: "By the end of the quarter, we've kept [family tradition] every week, 12 weeks in a row." },
    { id: "r-g-practice", text: "By the end of the quarter, [kid's name] and I have practiced [sport] together twice a week, 24 sessions in total." },
    { id: "r-g-letters", text: "By the end of the quarter, I've written each of my kids a letter about who I see them becoming." },
    { id: "r-g-home", text: "By the end of the quarter, I'm home by [time] four nights a week, with my phone away for the first hour." },
    { id: "r-g-overnight", text: "By the end of the quarter, I've taken [kid's name] on an overnight trip, just the two of us." },
  ],
  A: [
    { id: "a-g-revenue", text: "By the end of the quarter, revenue is [$X] a month, up from [$Y] today." },
    { id: "a-g-planning", text: "By the end of the quarter, I've held a 90-minute planning block every Monday morning, 12 weeks in a row, before opening email." },
    { id: "a-g-stop", text: "By the end of the quarter, I've stopped work by [time] four nights a week, and I've kept count." },
    { id: "a-g-handoff", text: "By the end of the quarter, [name] runs [task] without me, from a written checklist." },
    { id: "a-g-sales", text: "By the end of the quarter, I've had [number] sales conversations with new prospects." },
    { id: "a-g-clients", text: "By the end of the quarter, I've signed [number] new clients." },
    { id: "a-g-hire", text: "By the end of the quarter, I've hired a [role], and they run [task] on their own." },
    { id: "a-g-hours", text: "By the end of the quarter, I work [number] hours a week or fewer, tracked every week." },
    { id: "a-g-launch", text: "By the end of the quarter, [product or project] has launched." },
    { id: "a-g-focus", text: "By the end of the quarter, I've done two 2-hour blocks of focused work a week, phone off, 24 blocks in total." },
    { id: "a-g-cash", text: "By the end of the quarter, we have [number] months of expenses in the bank." },
    { id: "a-g-review", text: "By the end of the quarter, I've done my 30-minute end-of-week review 12 weeks in a row." },
    { id: "a-g-course", text: "By the end of the quarter, I've finished [course or certification]." },
    { id: "a-g-email", text: "By the end of the quarter, I check email at three set times a day, and I've kept count of any day I slipped." },
    { id: "a-g-raise", text: "By the end of the quarter, I've had the conversation with [boss's name] about [raise or promotion], with my case written down first." },
  ],
  V: [
    { id: "v-g-weight", text: "By the end of the quarter, I weigh [target] lbs, down from [today] lbs." },
    { id: "v-g-train", text: "By the end of the quarter, I've trained three times a week, 36 sessions in total." },
    { id: "v-g-alcohol", text: "No alcohol Sunday through Thursday for the whole quarter." },
    { id: "v-g-sleep", text: "By the end of the quarter, I've slept seven hours or more five nights a week, tracked on my phone or watch." },
    { id: "v-g-strength", text: "By the end of the quarter, I can [lift or run target], up from [today's number]." },
    { id: "v-g-steps", text: "By the end of the quarter, I've averaged 10,000 steps a day, tracked on my phone or watch." },
    { id: "v-g-race", text: "By the end of the quarter, I've run [race or distance] without stopping." },
    { id: "v-g-checkup", text: "By the end of the quarter, I've had a full checkup with bloodwork, and booked a follow-up for anything it flagged." },
    { id: "v-g-sweets", text: "By the end of the quarter, I've had no soda or sweets on weekdays, and I've kept count." },
    { id: "v-g-cook", text: "By the end of the quarter, I've cooked dinner at home five nights a week, 60 dinners in total." },
    { id: "v-g-waist", text: "By the end of the quarter, my waist measures [target] inches, down from [today] inches." },
    { id: "v-g-mobility", text: "By the end of the quarter, I've done 15 minutes of stretching or mobility five days a week." },
    { id: "v-g-phone", text: "By the end of the quarter, my phone has charged outside the bedroom every night, and I've kept count." },
    { id: "v-g-quiet", text: "By the end of the quarter, I've started 60 mornings with 10 minutes of quiet, prayer or slow breathing before my phone." },
    { id: "v-g-water", text: "By the end of the quarter, I've drunk three liters of water a day, logged every day." },
  ],
  E: [
    { id: "e-g-hobby", text: "By the end of the quarter, I've spent three hours a week on [hobby], 36 hours in total." },
    { id: "e-g-friends", text: "By the end of the quarter, I've had three nights out with friends, each booked a month ahead." },
    { id: "e-g-together", text: "By the end of the quarter, I've done [activity] with [friend's name] once a month, three times in total." },
    { id: "e-g-project", text: "By the end of the quarter, I've finished [project I've been putting off]." },
    { id: "e-g-family-day", text: "By the end of the quarter, our family has had one full day out every month, three in total, planned by me." },
    { id: "e-g-trip", text: "By the end of the quarter, I've taken the trip I've wanted to take for years: [trip]." },
    { id: "e-g-skill", text: "By the end of the quarter, I can [new skill], after [number] hours of practice." },
    { id: "e-g-league", text: "By the end of the quarter, I've played in [league or club] every week it met." },
    { id: "e-g-calls", text: "By the end of the quarter, I've called a friend every week just to catch up, 12 calls in total." },
    { id: "e-g-books", text: "By the end of the quarter, I've read [number] books for fun." },
    { id: "e-g-build", text: "By the end of the quarter, I've built [thing I want to make] with my own hands." },
    { id: "e-g-outdoors", text: "By the end of the quarter, I've spent a half day [fishing, hiking or hunting] twice a month, six in total." },
    { id: "e-g-host", text: "By the end of the quarter, we've had friends over to our house once a month, three times in total." },
    { id: "e-g-event", text: "By the end of the quarter, I've been to the [concert, game or event] I've wanted to see." },
    { id: "e-g-me-time", text: "By the end of the quarter, I've had two hours to myself every week for something I enjoy, 12 weeks in a row." },
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
