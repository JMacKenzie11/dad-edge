# ITC Map Builder UX Audit

_Independent code-inspection audit conducted 2026-08-19. No live-browser session was possible; every finding cites `file:line` so it's actionable without a screenshot._

---

## 1. Overall impression

The Form-First rebuild has delivered on its structural promise. The map itself now feels durable: every mutation goes through a typed server action, coach output cannot corrupt state, and the single-column canvas gives the coachee an unambiguous sense of where they are and what they're working on. Stage intros are alive (interpolated at render), the single "Run the Test" flow is a small piece of thoughtful choreography, and the ContinueBar reads honestly about what's blocking advance. The seams that still show are mostly voice-and-tone drift in surfaces that predate the recent voice pass (residual "Column N", the word "belief" instead of "assumption", em dashes in the stage intros and select options), and a handful of stale-quote / label-vs-behavior mismatches (the walkthrough tells the coachee to "hit Continue to Prioritize" while the button reads whatever `STAGE_LABELS[to]` produces, and `test.assumption_says` snapshots the assumption at draft time and never re-syncs when the coachee edits Column 5 later). Nothing that would make a man lose trust in the map. A handful of things that would leave a careful reader — the exact kind of man this is built for — with a faint sense that the coach isn't paying attention to what he's changed.

---

## 2. Top-10 priority list

Ordered by severity, then by effort. First seven ("ship before anything else") are all quick wins with high leverage.

| # | Finding | Severity | Summary | Effort | Ship first? |
|---|---------|----------|---------|--------|-------------|
| 1 | Column-number references in every stage intro | Friction | Voice-and-tone bans "Column N"; every intro opens with one | S | Yes |
| 2 | "belief" instead of "assumption" in three stage intros | Friction | Vocabulary was standardized on "assumption"; residual "belief" in test_design/test_running/results intros | S | Yes |
| 3 | startMap greeting still narrates the UI | Blocking | "Type it into the goal input above" is exactly the UI narration the voice doc bans; also carries "Column 1" | S | Yes |
| 4 | Walkthrough hardcodes button label "Continue to Prioritize" | Friction | Prompt tells coachee to "hit Continue to Prioritize" — brittle if the label logic ever moves, and UI narration in coach prose | S | Yes |
| 5 | `test.assumption_says` never re-syncs when Column 5 assumption text is edited | Blocking | Coachee edits an assumption after test was drafted, "Testing this assumption" panel shows new text, form field "My Big Assumption Says" shows the old snapshot — silent divergence | M | Yes |
| 6 | ContinueBar "Ready when you are. Hit {label}…" | Friction | "Hit" is a banned UI verb; ready-state copy could just be removed | S | Yes |
| 7 | Em dashes in every user-facing string in stage-intros.ts, results-form.tsx select options, results hint copy, and SMART review card | Friction | Voice lint would fail every one of these on ship | S | Yes |
| 8 | Verdict `<select>` options in results-form use em dashes AND UI-implicit language | Friction | "Held — the evidence supported the assumption" reads as documentation, not a value picker | S | No |
| 9 | Native `confirm()` dialogs on Remove and abandon test | Polish | Inconsistent with dark theme; can't be styled; accessibility varies by browser | M | No |
| 10 | Facilitator view is a raw state dump with no filtering, no goal-name column, no way to search | Friction | Admin can't answer "what's Steve stuck on?" without opening each map individually | M | No |

---

## 3. Method + gaps

**Method.** This audit is a code-inspection pass. I read `PRODUCT_SPEC.md` §§3.7, 15, 16, 17; the three voice docs; the ITC route entry page; the map canvas + all row / form components; the coach dock; the reset button; the stage progress; every server action in `src/app/itc/actions.ts`; the coach helper module; the stage intros; the stage machine; every prompt file under `src/lib/itc/prompts/stages/`; the two admin pages; and the login page. I traced the render path for each stage section from `MapCanvas` down through the row components to the persisted stage-notes and entry threads. Where a finding depends on the LLM prompt output rather than the code, I read the relevant prompt file to check what the coach is instructed to produce.

**What a live browser session would tell me that this audit cannot.** Perceived latency on the LLM-triggered flows (coach reactions, draft generations, walkthrough, revise loop) — the code inspects fine, but "Saving…" reads differently at 200 ms vs 8 s. Actual color-contrast measurements against `#0b0f14` for the muted / secondary token, the amber `needs_work` border, and the primary blue on the fresh-row highlight. Keyboard focus order in practice — the sections are Section-tag divs with no `tabindex` management, so I can reason about the DOM but can't watch a screen-reader traversal. Whether the ContinueBar's disabled-state reason (`gate.reason`) is announced when the button toggles from disabled to enabled — the `title` attribute helps sighted mouse users but screen-reader behavior varies. Mobile viewport behavior: `max-w-4xl` reads fine on desktop but the interleaved-thread layout under `<400px` may collapse in ways the code can't predict. Race conditions where a fast typist adds a behavior, blurs to save, and starts typing another before the first coach reaction lands — the code awaits the reaction before returning from the server action, but a real test would tell us how it feels.

---

## 4. Findings by category

### 4.1 Affordance honesty

#### [Blocking] `startMap` greeting narrates the UI and references Column 1

- **Where:** `src/app/itc/actions.ts:374`
- **What you saw:** The first coach message a coachee ever sees is:
  > "You've picked {pillar}. Column 1 is one goal that starts \"{stem}...\". Type it into the goal input above, or ask the coach anything about what you want to work on."
- **Why it matters:** This is the man's first impression of the coach's voice. It opens with a filler acknowledgment ("You've picked..."), uses "Column 1" (banned per voice-and-tone), and gives explicit UI direction ("Type it into the goal input above") which is exactly what the "Never reference the interface" rule bans. It's also the wrong lesson to teach — the coach shouldn't be describing where inputs live; the UI should explain itself.
- **Recommended fix:** Rewrite along the lines the copy-audit already proposed (§2.1): "Your goal for {pillar} starts \"{stem} ...\". If you know how you'd finish it, write it. If you want to work it out first, tell me what's on your mind." Strip the UI direction; keep the substance.

#### [Friction] "Give me ideas" button lives above the input on goal but under the input on other columns

- **Where:** `src/app/itc/[mapId]/goal-row.tsx:143-150` vs `src/app/itc/[mapId]/behaviors-row.tsx:224-232`
- **What you saw:** On the goal row, "Give me ideas" is `ml-auto` in the same flex row as the "Saving…" / "Enter to save" affordances, so it visually anchors to the right edge under the input. On the behaviors AddForm, it's also `ml-auto` in the row with the Add / Cancel buttons, so it ends up sitting AFTER the save button — which reads as "I've already added ideas above." A coachee scanning the button row sees `Add | Cancel | Give me ideas` and their eye moves to `Add` first, past the "Give me ideas" they might have wanted.
- **Why it matters:** Small but real. The "Give me ideas" affordance is the only path for a coachee who doesn't know what to write. Burying it after the primary action on some sections and not others reads as inconsistent.
- **Recommended fix:** Pin "Give me ideas" to a consistent slot across sections — either always the last thing in the row (with a divider) or promoted to a full-width dashed button above the input on empty-state renders.

#### [Polish] Draft cards on assumptions row read as "already added"

- **Where:** `src/app/itc/[mapId]/assumptions-row.tsx:307-325`
- **What you saw:** The `DraftCard` renders in a bordered pill labeled "Coach's drafts" with prose in italic, plus "underwrites #N" chips styled almost identically to the real assumption items below. Two "Use this draft" and "Dismiss" buttons underneath. The user could reasonably think this is already a map entry that they can hide or accept.
- **Why it matters:** The "Use this draft" button is a save action, but the visual treatment doesn't distinguish drafts from real entries strongly enough. If the coachee saves and then wants to see whether it landed, both the draft and the promoted entry can appear side-by-side for a beat before revalidation completes.
- **Recommended fix:** Add a subtle "not on the map yet" indicator (e.g. a dashed border rather than solid, or a small "draft" pill in the corner) and consider a `Coach drafted for you — Use to add or dismiss` sub-header. The commitments-row draft card (`commitments-row.tsx:211-228`) does this slightly better by labeling "Coach's draft" (singular) inline with the input.

#### [Polish] `Remove` button on behaviors is a small text link that shares vertical space with the input's border

- **Where:** `src/app/itc/[mapId]/behaviors-row.tsx:377-385`
- **What you saw:** The Remove button sits `mt-1 shrink-0` next to the AutoTextarea, styled as `text-xs text-[muted] hover:text-[danger]`. Focus target is small on mobile touch (well under 44 pt). Also uses a native `confirm()` dialog — inconsistent with the dark theme.
- **Why it matters:** A destructive action shouldn't be a tiny text link. Coachees may misclick, especially on mobile.
- **Recommended fix:** Move Remove into an overflow / kebab menu, or bump the padding + underline on hover to make the affordance louder. Replace `confirm()` with a styled dialog for consistency (also applies to assumptions-row Remove and reset-map-button and the abandon-test path in test-design-form).

---

### 4.2 Coaching clarity

#### [Friction] ContinueBar ready-state copy uses banned UI verbs and rehearses what the button already says

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:733-737`
- **What you saw:** When `gate.enabled === true`, the bar renders "Ready when you are. Hit {gate.label} to lock this in and move on." above the button.
- **Why it matters:** "Hit" is on the banned UI-verb list in `coach-voice-and-tone.md`. "lock this in and move on" duplicates what the button label already implies. And the button label itself already carries the destination ("Continue to Behaviors", "Show Me What's Going On"), so the ready-state prose is redundant.
- **Recommended fix:** Delete the ready-state paragraph entirely. The button + its label are self-explanatory. Keep the disabled-state `gate.reason` copy — that's genuinely useful.

#### [Friction] Disabled-state `gate.reason` copy reads as system diagnostics in a few cases

- **Where:** `src/app/itc/actions.ts:3352-3562` (see `computeAdvanceGate`)
- **What you saw:** Most reasons are plain-language coaching ("Add at least one Big Assumption first.", "1 commitment still needs an assumption."). But a few read as internal machinery: `"Deliver the walkthrough first."` (line 3512 — user has no lever to deliver a walkthrough; that's a server-side hook), and `"Save the goal first."` (line 3360 — if the user is on goal and hasn't hit save, they can just save; the copy is technically correct but robotic).
- **Why it matters:** When the coach appears to be blocking on something the user can't act on, the interaction feels broken. "Deliver the walkthrough first" would only ever surface if the walkthrough LLM call failed AND the page-load recovery in `page.tsx:53-55` didn't run — an edge case, but the copy would leave the coachee stuck.
- **Recommended fix:** For the walkthrough case, either regenerate the walkthrough automatically on Continue-tap and swallow the failure, or replace the reason with something that names the action to take ("The walkthrough hasn't landed yet — refresh the page and it'll be ready."). For "Save the goal first," rewrite to "Write your goal first."

#### [Friction] Refinement chip label bakes the value into the button text ("Use: \"...\"") but suggestion chips don't

- **Where:** `src/app/itc/[mapId]/entry-thread.tsx:94-108`
- **What you saw:** Refinement chip renders as `Use: "{value}"`; suggestion chips render as just `{value}`. Both fill the input on tap.
- **Why it matters:** Inconsistent. A user tapping a suggestion chip has to trust that the button label IS the value; a user tapping a refinement gets the `Use: ` prefix and might wonder whether the prefix will end up in the input.
- **Recommended fix:** Either strip the `Use: ` prefix (the whole chip is the affordance; the value speaks for itself) or add a matching prefix on the suggestions ("Use this: ...").

#### [Polish] "Give me ideas" produces a `stage_note` anchored to `itc_maps` and appears above the input, but the intro-blurb also anchors to the map and appears above the input — they can stack

- **Where:** `src/app/itc/actions.ts:1263-1276` (`persistReaction(..., "stage_note", { table: "itc_maps", id })`) + `map-canvas.tsx:631-641`
- **What you saw:** On an active section, the flow above the input is: live intro (from `STAGE_INTROS`), then any stored `stage_notes` (including the "Give me ideas" output), then the input. Multiple "Give me ideas" taps stack multiple `stage_note` messages in that region.
- **Why it matters:** After 2–3 ideas taps, the region above the input becomes a growing archive of every set of suggestions the coach has offered. Screen real estate for the actual work compresses; the coachee has to scroll past yesterday's suggestions to see today's. Historical suggestions are useful in the transcript but not always in the active edit surface.
- **Recommended fix:** Either replace stale suggestion sets on new "Give me ideas" calls (only the latest set renders), or collapse older ones into an accordion.

---

### 4.3 Stale state and synchronization

#### [Blocking] `test.assumption_says` snapshots the assumption text at draft time and never re-syncs

- **Where:** `src/app/itc/[mapId]/test-design-form.tsx:77-79` reads `test?.assumption_says ?? assumption.text`. `map-canvas.tsx:307-310` shows the "Testing this assumption" panel with the LIVE `assumption.text`. Both render on the same screen.
- **What you saw:** The server pre-drafts a test via `draftTestForAssumption` (`actions.ts:1905-1932`) which persists `assumption_says` on the `itc_tests` row. If the coachee returns to Column 5 and edits the assumption text (fully supported — assumptions are always editable, `assumptions-row.tsx:411-446`), the `itc_tests.assumption_says` column is not re-synced. The next time they visit test_design, the "Testing this assumption" context box shows the new assumption text, but the "My Big Assumption Says" form field shows the OLD snapshot.
- **Why it matters:** This is exactly the class of stale-quote bug the layout amendment was designed to eliminate. The two fields visibly disagree; the coachee reads that disagreement as either a bug or as coach carelessness. Worse, they might edit the assumption thinking that will flow through to the test design and be surprised when the test says something else.
- **Recommended fix:** Two options, both form-first-compatible. (a) Re-fetch and overwrite `test.assumption_says` on entry to test_design any time `assumption.text` differs from `test.assumption_says` (server-side, in `deliverTestDraftAfterAdvance` and its page-load recovery equivalent). (b) Drop `assumption_says` from the test row entirely — the assumption is a live join, not a snapshot. If the coachee wants a "sharpened" version of the prediction, that lives in `behavior_change` / `in_order_to_find_out`. Option (b) is architecturally cleaner and matches the stage-intros pattern (live interpolation from source of truth).

#### [Friction] `worry.coach_commitment_draft` doesn't refresh when a worry is edited

- **Where:** `src/app/itc/[mapId]/commitments-row.tsx:211-228` renders `worry.coach_commitment_draft` inside a "Coach's draft" card whenever the commitment doesn't exist yet. The draft is populated by `draftMissingCommitmentsAfterAdvance` (`actions.ts:1420-1467`) on entry to the commitments stage.
- **What you saw:** If the coachee advances into commitments, sees the draft, then goes back to Column 3 and materially rewrites the worry, the draft on Column 4 is still based on the OLD worry text. There's no re-draft trigger — `draftMissingCommitmentsAfterAdvance` only runs on the initial advance and skips worries that already have a draft.
- **Why it matters:** A coachee who took the worry deeper based on excavation prompting will find the coach's commitment draft still speaks to the shallower version. The draft could suggest a commitment that no longer fits the worry.
- **Recommended fix:** On worry save, if a `coach_commitment_draft` exists AND no `itc_commitments` row exists yet AND the new worry text differs materially, either (a) clear the draft (forcing the coachee to write from scratch or ask for ideas), or (b) enqueue a re-draft. (a) is safer — a stale draft is worse than no draft.

#### [Friction] `assumption_drafts` similarly don't refresh when commitments are edited

- **Where:** `src/app/itc/actions.ts:1477-1527` (`draftAssumptionsAfterAdvance`) — idempotent on any existing drafts OR existing assumptions.
- **What you saw:** The `existingDrafts.length > 0 || existingAssumptions.length > 0` guard prevents re-drafting. If a coachee reaches assumptions, sees the drafts, then goes back to Column 4 and rewrites a commitment, the drafts remain based on the old commitments. Coachee has to Dismiss all the drafts to force a re-draft the next time they arrive.
- **Why it matters:** Same failure class as commitment drafts. The visual coupling is real: drafts render with "underwrites #N" chips that map to specific commitment rows, so if the underlying commitment text changed, the coverage numbers still point at the (now different) commitments.
- **Recommended fix:** Two form-first-compatible options. (a) Clear drafts whenever any underlying commitment text changes materially (aggressive; user loses good drafts). (b) Add a visible "Regenerate drafts" affordance next to the "Coach's drafts" header that fires the drafter again. (b) is the honest read of the situation — no server can decide for the coachee whether a commitment edit invalidates the drafts.

#### [Friction] Prioritize recommendation is delivered once and never refreshes on re-visits

- **Where:** `src/app/itc/actions.ts:1677-1768` (`deliverPrioritizeRecommendationAfterAdvance`) — idempotent when any assumption is `selected_for_testing`.
- **What you saw:** If the coachee finishes a test cycle and lands back on prioritize with `next_step=new_assumption`, `advanceAfterResults` (`actions.ts:2791-2795`) clears the selection and reverts stage. The next time the page renders, `ensurePrioritizeRecommendationDelivered` runs (`page.tsx:62-64`) and drafts a fresh recommendation. Good. BUT the OLD `stage_note` from the previous prioritize visit is still on the map and rendered (`map-canvas.tsx:121-129` — `prioritizeNotes` filter picks up all `stage_note` messages with `stage_at_creation === "prioritize"`, no time cut-off). So the second-visit prioritize section shows two recommendations stacked.
- **Why it matters:** The coachee sees stale reasoning about assumptions they've already tested. If verdict was "challenged" on the first pass, the old recommendation may say something like "start with this one because it's powerful" — now confusing, because that assumption has been tested and (per verdict) challenged.
- **Recommended fix:** Filter `prioritizeNotes` to just the most recent, or mark older ones as `stage_at_creation="prioritize"` with a `superseded` flag when a new one is inserted. Server-owned decision.

#### [Polish] Legacy-canned-intro filter is a prefix match — genuine coach output that happens to open with those phrases would be suppressed

- **Where:** `src/lib/itc/stage-intros.ts:82-100`
- **What you saw:** `isLegacyCannedIntro` matches on 11 hard-coded prefixes. If a future coach turn happens to start with "Now the walkthrough" or "You've mapped the whole immune system", it will be silently filtered.
- **Why it matters:** Low probability but non-zero. If it hits, the coachee sees nothing where the coach expected to speak.
- **Recommended fix:** Either move the legacy filter to a one-time migration (find + delete legacy `stage_note` rows from before the client-intro cut-over, then remove the filter), or gate the filter on `created_at < CUT_OVER_DATE`.

#### [Polish] Walkthrough anchors to `itc_maps` and renders forever under `immuneSystemNotes` — no refresh path if the map is materially edited post-walkthrough

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:108-116` + `src/app/itc/actions.ts:1543-1632` (`deliverWalkthroughAfterAdvance` is idempotent on `walkthrough_delivered`).
- **What you saw:** The walkthrough quotes goal, behaviors, worries, commitments, and assumptions verbatim (per `prompts/stages/immune-system.ts`). If the coachee then goes back to Column 5 and rewrites an assumption, or Column 3 and sharpens a worry, the walkthrough on immune_system still quotes the pre-edit text.
- **Why it matters:** The whole walkthrough is a piece of coaching that says "here is what YOUR map is doing" — its persuasive power depends on the quoted text being what's currently on the map. Divergence undermines the argument.
- **Recommended fix:** Add a "Regenerate walkthrough" affordance on the immune_system section — visible when the walkthrough's stored `created_at` is older than any map-content edit. Server-computed comparison, coachee-triggered regeneration. Or (safer default) simply render a subtle "This walkthrough was written before your recent edits" banner with a regenerate button.

---

### 4.4 Visual hierarchy and layout

#### [Friction] `Section` uses `border-[primary]/25` on non-active sections — the "soft outline" reads as almost invisible on `#0b0f14`

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:612-620`
- **What you saw:** Active section: `border-[primary] bg-[primary]/[0.04]`. Non-active: `border-[primary]/25`. Against a near-black surface, `/25` opacity on the `#0075c9` primary is barely distinguishable from the border color. The 25% opacity was likely chosen to be "quietly there," but it may be too quiet — non-active sections may lose their edge definition entirely on some monitors.
- **Why it matters:** Sections that lose their border blend into the surface behind them, which weakens the "your work is preserved and structured" feel that the single-column canvas is trying to deliver. A live browser session would confirm.
- **Recommended fix:** Nudge the non-active border to `/50` or use a different token (`--color-border` = neutral gray, which is the tokenized "quiet boundary"). Would need to be A/B'd visually.

#### [Friction] Stage progress pills scroll horizontally on narrow viewports with no visual affordance for the scroll

- **Where:** `src/app/itc/[mapId]/stage-progress.tsx:24`
- **What you saw:** `flex items-center gap-1 overflow-x-auto` — the container scrolls but there's no gradient / fade indicating more stages are to the right on a narrow screen.
- **Why it matters:** On a phone, the "assumption / immune_system / prioritize / test_design / test_running / results" set almost certainly overflows. If the coachee is on `prioritize` and their current pill is at the far right, they may not know that pills exist to the right (they've already advanced past). More importantly they can't see how much further there is to go.
- **Recommended fix:** Add a fade-out gradient on both edges of the scroller. Or (better) collapse to a compact form on mobile: "Step 6 of 10 · Prioritize" with expand-to-see-all.

#### [Polish] Deprecated `TestsPanel` component still ships in the bundle

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:761-889`
- **What you saw:** `TestsPanel` and `TestCard` are defined but never rendered (the comment at line 565 confirms it was removed). Dead code compiled into the client bundle. Not user-visible, but bloats the JS shipped to every coachee.
- **Why it matters:** Not a user finding. Dev hygiene. Also risks accidental re-import.
- **Recommended fix:** Delete `TestsPanel`, `TestCard`, `TestField`, and the `TEST_TYPE_LABELS` / `FRESH_ROW_MS` / `isFresh` at the top of the file if they're no longer used elsewhere. Grep confirmed they're only referenced within this file.

#### [Polish] Section titles use "1." – "5." numbering that duplicates the "Column N" language the voice guide bans in coach output

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:247, 279, 302, 326, 351`
- **What you saw:** Section titles are `"1. Improvement goal"`, `"2. Doing / not-doing"`, `"3. Worry box"`, `"4. Competing Commitments"`, `"5. Big Assumptions"`.
- **Why it matters:** The numbering is a UI-atom convention (fine per `app-voice-adaptation.md §3.1.1`) but reinforces the "Column N" mental model that the voice guide explicitly asks the coach to move away from. When the coach then talks about "your Big Assumptions" and the section is titled "5. Big Assumptions", the coachee has to keep both conventions in his head.
- **Recommended fix:** Consider dropping the numeric prefix entirely. "Improvement goal" / "Doing and not-doing" / "Worry box" / "Competing Commitments" / "Big Assumptions" tell the same story without invoking the schema.

---

### 4.5 Feedback and system status

#### [Friction] Coach reaction is `await`-ed inline in every save action — perceived latency on every entry save is one full LLM turn

- **Where:** `src/app/itc/actions.ts:120-131` (`awaitReactionOrSwallow` awaits inline), used by `saveGoal:558`, `addBehavior:627`, `updateBehavior:680`, `saveWorry:837`, `saveCommitment:960`, `saveAssumption:1136`.
- **What you saw:** The code comment at 108-119 explains the deliberate choice: `after()` was tried, discarded because the client never re-rendered. So every Add/Save action blocks for the round-trip + the coach LLM. That's 2–5 seconds under normal load, longer under contention.
- **Why it matters:** For the Add-behavior flow especially, the coachee has just finished typing a behavior, hits Enter, and now waits. The `Saving…` indicator (worries-row.tsx:216, similar elsewhere) is there, but it's a small text label rather than a progress state. A coachee typing fast can feel this as "the app got slow."
- **Recommended fix:** Two form-first-compatible options. (a) Show a more prominent coach-thinking state under the just-saved entry ("The coach is reading…"). (b) Persist the entry immediately AND fire the reaction in the background via a client-side polling / server-sent event mechanism, so the entry appears instantly and the reaction slides in when ready. (a) is easier and would blunt the perceived-latency concern.

#### [Friction] `Give me another draft` / `Have the coach revise this` have distinctly different regen indicators but similar semantics

- **Where:** `src/app/itc/[mapId]/test-design-form.tsx:340-366` (regenerate row) and `test-design-form.tsx:590-604` (SMART revise button)
- **What you saw:** Regenerate row shows a small "The coach is writing a new draft…" span with a spinner. SMART revise button changes label from "Have the coach revise this" to "The coach is revising…" but doesn't add a spinner. Both fire similar-shaped LLM calls (test draft, possibly multiple attempts). The revise loop can run 3 attempts (`MAX_REVISE_ATTEMPTS`) which means up to ~30 seconds of latency; no visible progress.
- **Why it matters:** Under a 3-attempt revise, the coachee waits 30 s with just a label change. Screen looks frozen; they might click again or leave.
- **Recommended fix:** For revise, show an incremental progress state — "Coach is revising (attempt 2 of 3)…" — if streaming attempt counts is feasible, or at least show the spinner. Alternatively, dim the form fields visibly (as regenerate already does via `opacity-40 pointer-events-none`).

#### [Friction] Test-design form dims the fields during regenerate but not during "Run the Test"

- **Where:** `src/app/itc/[mapId]/test-design-form.tsx:370-425` shows fields as `opacity-40 pointer-events-none` when `regenPending`, but the same doesn't happen when `pending` (Run the Test in flight).
- **What you saw:** During `runTest`, the button shows `…`, but the fields remain visually interactive. If the coachee tries to edit while Run is in flight, the edit might make it into the DB update (via the same form values), but the SMART review will already have fired against the pre-edit state.
- **Why it matters:** Race condition + inconsistent feedback. Also inconsistent with the regenerate flow's stronger visual treatment.
- **Recommended fix:** Apply the same `opacity-40 pointer-events-none` treatment to the field grid when `pending`.

#### [Polish] `Saving…` under each row uses the same tiny text on every stage — no visual differentiation between "saving your text" and "coach is thinking"

- **Where:** `src/app/itc/[mapId]/goal-row.tsx:132-141`, `behaviors-row.tsx:387-395`, etc.
- **What you saw:** After a save, the local `pending` from the `startTransition` covers both the save and the awaited coach reaction. Coachee sees `Saving…` for the whole duration but doesn't know whether they're waiting on the DB write (instant) or the coach (a few seconds).
- **Why it matters:** For a fast typist, the sustained "Saving…" state feels wrong — they know they only typed a sentence, and the save took 4 seconds. Splitting the state ("Saved. Coach is reading…") would trade a small amount of prose for clarity.
- **Recommended fix:** After the write completes, swap the indicator from `Saving…` to something like `Saved · coach is reading…` for the remainder of the pending state.

---

### 4.6 Error recovery

#### [Polish] Delete-behavior fails at DB layer once a worry exists — UI doesn't warn the user before they try

- **Where:** `src/lib/itc/maps.ts:352-368` throws `deleteBehavior: behavior has a paired worry — remove via replace_behavior instead, or return to worries stage first.` Surfaces in `behaviors-row.tsx:325-327` as `setError(res.reason ?? "Could not remove.")`.
- **What you saw:** A coachee who has already added worries and then decides to remove one of the underlying behaviors gets the raw error message. The message reads as internal-implementation lingo ("via replace_behavior instead").
- **Why it matters:** The user hits a dead end without a clear next step. The Remove button doesn't tell them the constraint exists before they try; they only learn after clicking through a confirm() dialog.
- **Recommended fix:** Two changes. (a) On the behavior Remove button, disable it visibly (with `title=`) when the behavior has any downstream dependents (worry, commitment via that worry, etc.) and explain in a tooltip: "This behavior has a worry attached — clear the worry first." (b) Rewrite the error message in coach voice, not code voice: "You wrote a worry paired to this behavior. Clear the worry first, then you can remove the behavior."

#### [Polish] `resetMap` copy is functional but harsh — mentions the destruction but not the intent

- **Where:** `src/app/itc/[mapId]/reset-map-button.tsx:12-14`
- **What you saw:** Confirm text: `"Clear this map and start over? All messages, goal, and behaviors will be deleted. This cannot be undone."` Only mentions "messages, goal, and behaviors" — not worries, commitments, assumptions, tests, or results. A coachee halfway through the assumptions stage would see this and think their Column 3 / 4 / 5 work is safe, then be surprised.
- **Why it matters:** Inaccurate warning. Coachee could destroy work thinking they're only wiping a small part.
- **Recommended fix:** "Clear this map and start over? Everything on it — your goal, behaviors, worries, commitments, assumptions, tests, and results — will be deleted. This cannot be undone."

#### [Polish] `advanceAfterResults` failure surface is small text at the bottom of the results form

- **Where:** `src/app/itc/[mapId]/results-form.tsx:222-227` (error text after advance)
- **What you saw:** If the `new_test` / `new_assumption` / `map_complete` routing fails (rare — DB error, stage-machine violation), the coachee sees a red text line at the bottom. No retry button, no explanation of what state the map is in now.
- **Why it matters:** They've saved their debrief. The map has been mutated (result persisted). But they can't advance and don't know what's recoverable.
- **Recommended fix:** On advance failure, offer a "Try again" affordance and either re-render the debrief (still saved) with a "Result saved. Advance failed — try again" state.

---

### 4.7 Accessibility

#### [Friction] Primary blue `#0075c9` at 25% opacity on `#0b0f14` for the SectionBorder is likely below WCAG contrast for a boundary

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:618` (`border-[primary]/25`)
- **What you saw:** Borders are decoration, so WCAG doesn't require 4.5:1 for them. But when a border is the primary way to distinguish sections that all live on the same surface, it becomes semantic. At 25% opacity the border may fall below meaningful visual separation.
- **Why it matters:** Users with reduced vision or on low-quality monitors may not perceive the section boundaries. A live browser session with contrast measurement would confirm.
- **Recommended fix:** Bump to `/50`, or use a slightly lighter neutral (`border-[color:var(--color-border)]` for non-active) and reserve the primary color for the active section only.

#### [Friction] Muted text on muted-70 opacity (placeholders, hints) — likely below 4.5:1 on dark surface

- **Where:** Many, e.g. `map-canvas.tsx:419` (`text-[muted]/70`), `behaviors-row.tsx:52` (same), `results-form.tsx:283` (`text-[muted]/70`)
- **What you saw:** `--color-text-muted` at 70% on `--color-surface` = a muted gray value further attenuated. Placeholders and hint text (field descriptions, "None yet.") use this pattern throughout.
- **Why it matters:** Placeholders and hints are functional copy — the man needs to read them. If they're too dim, they're invisible without effort.
- **Recommended fix:** Standardize on unattenuated `--color-text-muted` for placeholders and hints. Reserve the `/70` and `/80` attenuations for truly decorative context (relative timestamps, "underwrites" chip label, etc.).

#### [Friction] Icon-only Remove and abandon buttons have `title` attributes but no `aria-label`

- **Where:** `behaviors-row.tsx:377-385`, `assumptions-row.tsx:545-553`, `test-design-form.tsx:437-445`, `reset-map-button.tsx:20-26`
- **What you saw:** Buttons contain visible text ("Remove", "← Test a different assumption", "Clear map") — not truly icon-only. So `aria-label` isn't strictly required. But the smaller ones ("Remove", "Clear map") are visually dense and would benefit from an explicit `aria-label` for screen-reader clarity, particularly since the visible text is small.
- **Why it matters:** Screen readers announce the visible text as the accessible name, which is technically correct but doesn't tell the user what the button removes. `aria-label="Remove behavior 1"` would be materially clearer.
- **Recommended fix:** Add `aria-label` to Remove and destructive buttons that includes the target ("Remove behavior 1: 'I bring up things she did in the past'").

#### [Friction] `gate.reason` disabled-state message renders as plain paragraph — no `aria-live` so screen-reader users may not hear it toggle

- **Where:** `map-canvas.tsx:747-751`
- **What you saw:** The `<p>` under the disabled Continue button contains the reason. Not wrapped in `aria-live="polite"`, so screen readers announce it only when focus lands on it.
- **Why it matters:** A coachee using a screen reader might tab through the page, hit Continue, get told "button disabled," and have no way to hear WHY without hunting for the paragraph.
- **Recommended fix:** Wrap in `<p aria-live="polite" role="status">…</p>` or associate via `aria-describedby={reasonId}` on the button itself.

#### [Polish] Chip button `title="Use this in the input"` is not the accessible name

- **Where:** `map-canvas.tsx:691-699` and `entry-thread.tsx:133-142`
- **What you saw:** Chip's visible text IS the suggestion value; `title` provides hover tooltip explaining the affordance. Screen reader reads the chip value; user doesn't learn tapping fills the input until they act on it.
- **Recommended fix:** Add an `aria-description` or use a visually-hidden appended span: `<span className="sr-only"> (tap to use in the input above)</span>`.

---

### 4.8 Content and voice

#### [Friction] Every stage intro in `stage-intros.ts` uses "Column N" and em dashes throughout

- **Where:** `src/lib/itc/stage-intros.ts:17-70`
- **What you saw:** Every intro opens with `Column 2 is what you actually do...`, `Column 3 is the worry box...`, etc. Also uses em dashes freely: "Aim for 3 to 5 — enough to see the pattern", "Push until it lands on identity — that's the depth.", "Column 5 is the Big Assumptions — the beliefs about how..." (also "belief" — see next finding). Full em-dash count: roughly 12 in the visible intros.
- **Why it matters:** These are the FIRST thing the coachee reads on entry to each stage. They set the coach's voice for the section. Every one contains an active violation of the voice-and-tone rules the coach is supposed to embody. Voice-adaptation §3.1.5 explicitly permits stage intros — but permits them as functional orientation in voice-compliant prose. Right now they're the loudest violation source in the whole flow.
- **Recommended fix:** Rewrite each intro per the voice-and-tone rules: replace "Column 2 is..." with "The behaviors you actually do, or fail to do..." (name the thing, not the schema), replace em dashes with periods or commas, use "assumption" not "belief" (see next finding). Keep the two-sentence cap and the connection-to-map-content mandate from voice-adaptation §3.1.5.

#### [Friction] Three stage intros use "belief" where the vocabulary was standardized on "assumption"

- **Where:** `src/lib/itc/stage-intros.ts:51` (`whether the belief actually holds`), `:57` (`whether the belief actually holds`), `:65` (`One test rarely fully overturns a belief`)
- **What you saw:** Voice-adaptation ruling: "Assumption, not belief — 'belief' as a synonym has been retired throughout schema, prompts, and UI." These three intros still use "belief."
- **Why it matters:** Inconsistent vocabulary between the intro copy and the field labels + coach output. Small but a copy audit would catch it.
- **Recommended fix:** Replace all three with "assumption."

#### [Friction] `startMap` first coach message references "Column 1" and narrates the UI

- Covered above in §4.1 (blocking finding). Also a voice violation.

#### [Friction] Walkthrough prompt tells the coachee to "hit Continue to Prioritize" — brittle to label logic + UI narration

- **Where:** `src/lib/itc/prompts/stages/immune-system.ts:76`
- **What you saw:** The walkthrough must end with the exact line `"When you're ready, hit Continue to Prioritize to pick which assumption to test first."` The ContinueBar label logic (`actions.ts:3343-3350`) does produce `"Continue to Prioritize"` today, so the reference matches — but "hit" is a banned UI verb and the whole sentence is UI narration.
- **Why it matters:** Two failure modes. (1) Voice violation on a very-high-visibility surface: the walkthrough is the emotional peak of the coaching sequence, and it closes on a robotic UI direction. (2) Fragility: if the label logic ever changes (e.g. to "Show me who to test first"), the walkthrough will reference a button that doesn't exist. This is exactly the reason the layout amendment moved static text to live interpolation.
- **Recommended fix:** Rewrite the close to name the intent, not the button: "When you're ready, pick which assumption to test first." Same for the prioritize prompt's close line (`prompts/stages/prioritize.ts:63` — "hit Continue to Test").

#### [Friction] `map-canvas.tsx:420` uses "Column 5 above" in fallback placeholder copy

- **Where:** `src/app/itc/[mapId]/map-canvas.tsx:420`
- **What you saw:** When no assumption is selected on the test_design section, placeholder reads `"Pick an assumption to test first (Column 5 above)."`
- **Why it matters:** Direct voice violation. Also user-facing.
- **Recommended fix:** `"Pick an assumption to test first (from your Big Assumptions above)."`

#### [Friction] Results-form verdict `<select>` options open with the label + em dash + explanation

- **Where:** `src/app/itc/[mapId]/results-form.tsx:169-177`
- **What you saw:** Three options:
  - `"Held — the evidence supported the assumption"`
  - `"Partially challenged — some evidence didn't fit"`
  - `"Challenged — the evidence clearly didn't fit"`
- **Why it matters:** Em-dash violation on a required user interaction. The concatenation also reads oddly in a `<select>` (which browsers render as a single line; the description gets clipped on narrow selects).
- **Recommended fix:** Two options per select item, joined by a period. Or use a separate hint label under the select. Or use a radio-group visual pattern so each option has room for label + one-line explanation on its own line.

#### [Friction] SMART review card criterion note uses em dash separator

- **Where:** `src/app/itc/[mapId]/test-design-form.tsx:575`
- **What you saw:** `<span className="text-[muted]"> — {row.note}</span>` — em-dash character in visible UI, appended after the label ("Safe", "Modest", etc.).
- **Recommended fix:** Replace with a period or colon: `<span>: {row.note}</span>`.

#### [Polish] Results-form hint and placeholder use em dashes

- **Where:** `results-form.tsx:130` (hint: "What you actually did — the concrete move..."), `:145` (placeholder: "how it ended — the videotape version"), `test-design-form.tsx:387` (hint: "Modest — worst case must be livable.")
- **Why it matters:** Voice-adaptation lint would fail. Consistency with the rest of the pass.
- **Recommended fix:** Replace with periods or commas.

#### [Polish] "Ask the coach" dock CTA copy is fine but the empty-state prompt ("What's on your mind?") reads slightly casual

- **Where:** `coach-dock.tsx:90`
- **What you saw:** Not a violation. Elliptical form permitted in coach chat per app-voice-adaptation §3.1.2. Grouped as polish.
- **Recommended fix:** No change needed.

---

### 4.9 Onboarding into the tool itself

#### [Friction] `/itc/login` page gives no explanation of what ITC is or how long it takes

- **Where:** `src/app/itc/login/page.tsx:1-78`
- **What you saw:** Just the Dad Edge logo, "Dad Edge Goal Clarifier" heading, and "Boardroom preview. Sign in to build your map." Then email + password fields. No description of the tool, no time estimate, no disclosure about the coach or what will be saved.
- **Why it matters:** A man arriving at this page from an invite email has no signal about what he's signing up for. "Sign in to build your map" is a phrase that presupposes he knows what an ITC map is.
- **Recommended fix:** Add a paragraph under the heading: "Immunity to Change is a self-coaching exercise. You'll spend 30–45 minutes mapping the goal you can't quite hit, the behaviors under it, and the beliefs that hold the pattern in place. Your work is saved as you go. Come back anytime."

#### [Friction] `/itc` landing page tells the coachee to pick a pillar but doesn't explain what a pillar is or how ITC applies to it

- **Where:** `src/app/itc/page.tsx:122-131`
- **What you saw:** "Pick the BRAVEMAN pillar this map is about." No explanation of what BRAVEMAN is, no per-pillar description on hover / focus (the code has `pillar.short` but not the fuller domain the coach prompt has access to via `pillar.domain`).
- **Why it matters:** A first-time coachee doesn't know what "N" means (Network) or how a Network map differs from a Bond map. He'll pick something and hope.
- **Recommended fix:** Show pillar name + one-line domain on the label. Something like `A / Amplify — the way you build your work` under the letter. The `PILLAR_BY_CODE[code].domain` field already carries this. Not shown today.

#### [Friction] First screen of a new map opens on `/itc/{id}` with the goal section active and a canned first coach message — no orientation about what's coming

- **Where:** `src/app/itc/actions.ts:371-381` (the seed message on `startMap`) + `page.tsx:36-160`
- **What you saw:** The seed message says "You've picked {pillar}. Column 1 is one goal..." That's all the coachee gets about the arc of the flow. No "here's what we're going to do in the next 45 minutes" preview. No "the map will grow as we go" preview.
- **Why it matters:** The coachee is committing to a longer flow than a single form fill. The stage progress bar at the top shows 10 stages, which may itself be daunting without context.
- **Recommended fix:** On the first map for a participant (`listMapsForParticipant.length === 1`), show a one-paragraph onboarding above the goal section: "This is a 4-column immunity map. We'll start with the one goal you can't quite hit, walk down to the behaviors keeping you from it, the hidden fears under them, the vows that protect the fears, and the assumptions holding it all together. Then we'll test one of those assumptions. Save-as-you-go; come back anytime."

---

### 4.10 Facilitator view

#### [Friction] `/itc/admin` map index shows email + stage + status + timestamp, but no goal, no pillar-color-coding on the list

- **Where:** `src/app/itc/admin/page.tsx:44-76`
- **What you saw:** Each map row has email, pillar label (color-coded), current_stage, status, and updated timestamp. Not shown: the `improvement_goal` text, the number of tests run, the last coach turn.
- **Why it matters:** A facilitator prepping for a Boardroom call needs to know "what is Steve working on right now" — the goal is the fastest way to answer that. Currently they have to click into each map.
- **Recommended fix:** Add a two-line row layout: line 1 = email + pillar + stage badge; line 2 = truncated `improvement_goal` (or `Goal not yet locked`).

#### [Friction] No search / filter on the admin index

- **Where:** `src/app/itc/admin/page.tsx:44-76`
- **What you saw:** Simple `<ul>` of all maps, no search input, no stage filter, no sort control. Order is whatever `listAllMaps` returns (looks like recency-based).
- **Why it matters:** As the number of maps grows, finding a specific coachee becomes a scroll exercise. A facilitator with 40 maps in the list can't quickly answer "who's stuck on assumptions?"
- **Recommended fix:** Add a text filter (matches email or goal), a stage filter (dropdown), and a "stuck for more than X days" quick-filter.

#### [Friction] Admin transcript view is a single scrollable pane with no stage anchors, no message search, and no way to filter to just coach messages or just entries

- **Where:** `src/app/itc/admin/[mapId]/page.tsx:72-92`
- **What you saw:** A single `<ol>` of user + assistant messages, dumped chronologically. No indication of which stage a message was sent on (though `stage_at_creation` is available), no search, no jump-to-stage.
- **Why it matters:** A facilitator preparing for a call needs to review the coaching arc, not read every message. Currently they have to scroll linearly and hold the sequence in their head.
- **Recommended fix:** Group messages by stage with sticky headers. Add a stage-jump dropdown at the top. Consider a "coach messages only" toggle for scanning just the coach's side.

#### [Friction] "Rubric / gate visibility" — no way for the admin to see WHY a coachee is stuck at a stage

- **Where:** `src/app/itc/admin/[mapId]/page.tsx:93-156` (right panel)
- **What you saw:** Right panel shows raw state (goal, behaviors, worries, commitments, assumptions). Doesn't show per-entry `depth_score`, `attempts`, or the current `gate.reason` for the map's stage.
- **Why it matters:** A coachee stuck at worries because two worries score 1/3 with 5 attempts each is a specific coaching signal — the facilitator needs to see the excavation failing, not just the map contents. Also `itc_turn_events` (the diagnostic log) isn't shown at all, which the spec explicitly says is admin-facing.
- **Recommended fix:** Add a "Diagnostic" section under each column showing per-entry `depth_score / attempts` for worries, commitments, assumptions. Add a "Current advance gate" panel at the top showing `computeAdvanceGate` output. Long-term: surface the last N `itc_turn_events` in a scrollable panel so admins can spot LLM failures.

#### [Polish] Admin page renders `map.current_stage` as raw enum ("prioritize", "test_design") instead of `STAGE_LABELS[stage]`

- **Where:** `src/app/itc/admin/page.tsx:64` (`stage: {m.current_stage}`)
- **What you saw:** Facilitator-facing text shows the machine identifier.
- **Recommended fix:** Use `STAGE_LABELS[m.current_stage]`.

---

## 5. Not covered by this pass

- Live perceived-latency of every LLM-triggered flow. Would need a browser session.
- Actual color-contrast measurements. Would need DevTools + a contrast analyzer.
- Keyboard focus order in practice. Would need a browser session.
- Screen-reader announcement of the ContinueBar disabled-state reason and the SMART review card. Would need VoiceOver / NVDA testing.
- Mobile layout under real viewport constraints (particularly the stage-progress overflow behavior and the interleaved entry-thread + input layout). Would need device testing.
- Race conditions when a fast typist submits multiple entries in quick succession before the awaited coach reaction completes. Would need integration testing.
- The BRAVE MAN pillar semantics beyond letter + label (per user MEMORY.md, `A = Amplify` but domain descriptions for the others are external to the codebase). The pillar selection UI on `/itc` doesn't surface domain descriptions in a way that would tell a first-time coachee what a pillar means for this exercise.
