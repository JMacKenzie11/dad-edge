# App Voice Adaptation

Standing reference for how `Assets/Voice and Tone/voice-and-style.md` and `Assets/Voice and Tone/writing-craft.md` apply inside this app. Rulings from the Voice Compliance Pass Section 2 are restated verbatim below with cross-references, followed by additional adaptation calls made during the initial audit.

---

## 1. Applies everywhere, as written (from Section 2.1)

- Plain, concrete language. The full substitution list ("internalize," "process," "regulate," etc.) gets a plain replacement.
- The banned-language lists in `voice-and-style.md` (`grief journey`, `sit with`, `unpack`, `deep dive`, `at the end of the day`, `it's important to note`, `worth mentioning`, and so on) apply everywhere.
- The AI-signature ban list applies everywhere: `delve`, `tapestry`, `navigate` (metaphor), `resonate`, `elevate`, `leverage`, `robust`, `profound(ly)`, `deeply`, `genuinely`, `truly` as intensifiers, "in today's fast-paced world" and every opener like it.
- No em dashes anywhere. Including coach output.
- Contractions throughout ("don't," "you're," "it's," "won't").
- Second person throughout.
- Strong verbs, active voice, Anglo-Saxon over Latinate.
- No crutch words ("very," "really," "quite," "somewhat," "truly").
- No hedge-and-pivot, no validation-as-toll, no filtering ("it's important to note").
- The "It's not X, it's Y" construction capped at one per surface and only when the reversal is the point.
- No question-as-transition, no signposting, no summary sandwich.
- Say things once.
- No unearned profundity.
- Sentence variety — short sentences saved for moments that earn them.

## 2. No sentence fragments (from Section 2.2)

Strict. Every sentence in UI copy and coach output is grammatically complete. Imperatives are complete ("Log today." fine, "Report back." fine). "Behavior plus day." is a fragment; rewrite as "Give me the behavior and the day." Audit existing copy for this specifically; earlier copy leaned on fragments for punch.

## 3. ITC framework naming rule is scoped (from Section 2.3)

Inside the ITC tool (`/itc/*`) the framework IS the product. Column names, "competing commitments," "Big Assumptions," and "immunity" remain in use there. What transfers is the plain-language obligation: every framework concept gets explained in words a man can follow at 11pm without translating ("the belief you've been treating as a fact your whole life"), never in Kegan/Lahey academic register. Outside the ITC tool (member coach, emails, marketing surfaces), the framework stays unnamed per the guides.

## 4. Publication mechanics do not apply (from Section 2.4)

Title/subtitle rules, program bridge, content pillars, and grief-specific audience framing do not import. The audience here is the BRAVEMAN man; the existing product language standard (plain, direct, blue-collar) stands. Where the guides are stricter, the guides win.

## 5. Profanity (from Section 2.5)

Never in static UI copy, emails, or nudges. The coach may use it sparingly and only when the man's own register clearly invites it. Coach voice docs encode that boundary.

## 6. Functional lists survive (from Section 2.6)

The guides ban bullet summaries in posts. App UI and the ITC formatting rules (numbered recaps, labeled columns) are interface structure, not prose. They stay. The craft rules govern the sentences inside them. No "key takeaways" style blocks anywhere.

## 7. Exempt from rewriting (from Section 2.7)

- The 15 Partner Connection Survey questions. Versioned measurement instrument; changing wording breaks longitudinal comparability. Future edits go through a new `survey_question_sets` version, not this pass.
- Legally-meaningful disclosure content (ITC facilitator disclosure, coach-visibility disclosure). Must stay complete and plain. Tighten wording, never weaken the disclosure.
- Proper nouns and brand terms (BRAVEMAN, Dad Edge, Boardroom, the pillar names, "Immunity Map" as the app's own product name inside `/itc`).

---

## 3.1 Additional adaptation rulings (found during initial audit)

### 3.1.1 UI atoms are not sentences

Labels, placeholders, badges, headings, tab names, and column titles are UI atoms, not prose. The fragment rule from Section 2.2 governs prose (body text and coach output), not atoms. `"None yet."` on an empty column is fine because it's a placeholder, not a sentence in a paragraph. `"Add a behavior…"` in an input placeholder is fine for the same reason. Rule: if the copy is inside a `<p>`, `<div>`, coach chat bubble, email body, or nudge text, it must be a complete sentence. If it's a label, placeholder, badge, or heading, atomic form is fine.

### 3.1.2 Elliptical conversational questions are permissible in coach chat

A rule-strict reading of "no fragments" would ban questions like *"First one that comes to mind?"* or *"Anything else?"* because they omit the leading verb. These are how real people talk. The guides themselves use elliptical constructions in their example prose. Ruling: elliptical questions that read as natural conversation are allowed in coach output. Declarative fragments ("Not because you stopped caring.") are not — those get rewritten.

### 3.1.3 "It's not X, it's Y" cap scoped to a single coach reply

The guides' "one per surface" cap was written for a single post as the unit. Inside the app, a "surface" for this construction is a single coach reply (or a single email, or a single page). Across a session, there is no cumulative cap, but each use must earn its reversal.

### 3.1.4 Reference-repetition is not idea-repetition

The coach frequently references a saved entry by exact text across turns ("about behavior #1..."). That's factual reference, not "saying the same thing in different words." Fine.

### 3.1.5 Coach transition intros vs. signposting rule

Per `docs/coach-voice-and-tone.md` the coach opens each stage with a short intro naming the column and connecting to the prior work. That reads as signposting, which the craft rules ban in publication prose. Adaptation: in publication prose the reader has already picked up the post and doesn't need to be told where he is. In the app, the coach transitions between distinct stages of a session and the coachee needs orientation for what's about to happen. Rule: stage-intro blurbs stay; they are functional orientation, not editorial signposting. Cap them at two sentences and always connect to the coachee's specific entries.

### 3.1.6 "Navigate" as UI-navigation verb

The AI-signature ban on `navigate` is scoped to `navigate` used as a metaphor for living through something ("navigate your grief"). Using it in UI copy for actual navigation ("Sign out," not "Navigate to sign out") is not the same word in the banned sense. Rule: `navigate` is banned as metaphor everywhere and banned as a UI verb (say "go to X" or "open X" instead), so the practical effect is: don't use the word. Applies to coach output and static copy.

### 3.1.7 Framework abstract nouns inside the ITC tool

The guides ban `framework`, `architecture`, `foundation`, `ecosystem`, `structure`, `infrastructure`, `landscape`. Inside the ITC tool the coach may need to describe how the columns connect ("the whole system," "the pattern," "how these pieces fit"). Ruling: even inside the ITC tool, use plain descriptions of what's actually happening. "The system that keeps this in place" is fine. "The framework" is not. "The immune system" is the guide's own term and is the exception (it's central to Column 5's meaning).

### 3.1.8 One-line success confirmations

Success messages after a save action (goal saved, behavior added, test recorded) are candidates for extremely tight copy. The guides bless short sentences that earn their weight. Rule: single sentence, active verb, no praise ("Saved." "Added." "Locked in.") — never "Great, your goal has been saved to your map!" or similar cheerful-app defaults.

### 3.1.9 Error and validation messages

Plain diagnosis of what went wrong, no apology padding, no "Oops!" or "Sorry, something went wrong." Diagnose and instruct. "That behavior is already on the map. Refine an existing one if the phrasing is sharper." reads correctly. "Uh oh! Looks like that behavior might already exist on your map. Please try refining one that's already there!" does not.

### 3.1.10 Coach's response-length rhythm

The craft guide's build-to-a-drop rhythm applies to coach replies. Long observation or context-setting sentence, followed by a short landing sentence or a specific question. Cap coach replies at what a man reads on his phone in 10 seconds without scrolling more than once. If the reply won't fit that budget, the reply is doing too much.

### 3.1.11 Contractions in system-generated inserts

System notes like `[coachee saved goal via map: "..."]` and `[action rejected] ...` are structured logs for the coach LLM to read, not user-facing prose. Contraction and voice rules don't apply. They stay in the flat `[type] payload` format they use today.

---

## 4. Enforcement

The lint guard in Voice-E scans:
- All `.tsx`/`.ts` string literals inside `src/`
- All files in `src/lib/copy/` (once centralized copy exists)
- Outbound email templates
- Both coach voice docs

Scans for:
- Em dashes (`—`, `–`, `--`)
- Every word on the substitution list, banned list, and AI-signature list
- The avoided constructions ("it's important to note," "worth mentioning," "grief journey," "sit with," etc.)

The build fails on violations. An inline allow-list mechanism accepts an escape via a `// voice-allow: <reason>` comment on the offending line, with the reason string ≥ 20 chars.

---

## 5. Change log

- 2026-08-18 — initial adaptation addendum written during Voice-A. Section 3.1 rulings 3.1.1 through 3.1.11 captured from the initial audit.
