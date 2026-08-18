# Copy Audit — Voice Compliance Pass

Working document from the Voice-A sweep. Each row is a current string, where it lives, what rule it violates (cited from the voice/craft guides or `app-voice-adaptation.md`), and a proposed rewrite. **No user-facing copy changes until this is reviewed and approved.**

Legend for the "rule" column:
- **VS §X** — `voice-and-style.md`, section named
- **WC §X** — `writing-craft.md`, section named
- **APP §X** — `docs/app-voice-adaptation.md`, ruling number
- **[dash]** — em dash / en dash / `--` (VS "No em-dashes")
- **[banned]** — a word or phrase on the banned/AI-signature lists

Priority column:
- **P0** — user-facing, high-visibility, changes the man's read of the app
- **P1** — user-facing, lower-visibility (admin/leader tools, footers)
- **P2** — internal-facing (code comments, developer messages) — out of scope

---

## 1. Method

**Sweep scope:**
- All `.tsx` and `.ts` files under `src/app` (78 files).
- `src/lib/email.ts` (all outbound email templates).
- `docs/coach-voice-and-tone.md` (source of truth loaded on every coach turn).
- ITC coach system prompt + per-stage prompts (`src/lib/itc/prompts/**`).
- Static UI copy in components under `src/components/**` and `src/lib/copy/**` (none of the latter exists yet — copy is inline).

**Tools:**
- `grep -rn` for em dashes across all above surfaces.
- `grep -rn` for each phrase on the banned + AI-signature lists.
- Manual read-through of the ITC surface (highest-touch, active-work).
- Sampling read of every other route's top-level page.

**Counts collected:**
- Em dashes in `src/app/**` (`.tsx`/`.ts`): **119 hits** across ~30 files.
- Em dashes in `src/lib/**`: 472 hits, ~all in code comments/JSDoc (out of scope, P2).
- Em dashes in `docs/**`: 19 hits, all in prompt-authoring comments/instructions (P2).
- Banned-phrase hits in `src/app/**`: **1** (`sit with`, inside a coach-side CTA whitelist, not user-facing prose).
- AI-signature word hits in `src/app/**`: **0**.

Full listings appear inline below by surface.

---

## 2. ITC surface (detailed)

The ITC tool is where the active rebuild has been happening, so it carries copy I authored recently against an earlier voice standard. Highest priority.

### 2.1 `src/app/itc/actions.ts` — initial startMap greeting

Line 103:
```
"Alright. You've picked ${pillar.label} as the pillar. The map begins with
one goal that starts \"${GOAL_STEM}...\". If you already know your goal,
type it into the Column 1 input on the right and hit Save goal. If you
want help getting to one, tell me what's on your mind here and I'll help
you shape it."
```

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.1.1 | `type it into the Column 1 input on the right` | APP §5 "Never reference the interface" (from `docs/coach-voice-and-tone.md`) | Remove UI direction. Coach speaks natural language; the UI explains itself. |
| 2.1.2 | `hit Save goal` | Same as above. | Same. |
| 2.1.3 | Reads as concierge greeting ("Alright. You've picked..."). Filler. | VS "Voice: what it doesn't sound like" — filler openings. | Cut the acknowledgment. Start with the substance. |

**Proposed rewrite (single sentence, straight to the ask):**
> Your goal for ${pillar.label} starts "${GOAL_STEM} ...". If you know how you'd finish it, write it. If you want to work it out here, tell me what's on your mind.

---

### 2.2 `src/app/itc/actions.ts` — behaviors stage-intro seed

Line ~1730 (inside STAGE_INTROS):
```
"Column 2 is what you actually do, or fail to do, in the moment that
works against ${goal ? `"${goal}"` : "your goal"}. Not why. Not what
you should do instead. Just the specific behavior. First one that comes
to mind? Type it into the Add a behavior input on Column 2, or tell me
here if you want help shaping it."
```

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.2.1 | `Type it into the Add a behavior input on Column 2` | APP §5, docs/coach-voice-and-tone.md "Never reference the interface." | Remove UI direction. |
| 2.2.2 | Otherwise clean — plain, direct, second person, contractions. Keep the body. | | |

**Proposed rewrite:**
> Column 2 is what you actually do, or fail to do, in the moment that works against ${goal ? `"${goal}"` : "your goal"}. Not why. Not what you should do instead. Just the specific behavior. What's the first one that comes to mind?

Same treatment for the other STAGE_INTROS entries: strip any UI direction; keep the substance.

---

### 2.3 `src/app/itc/actions.ts` — fallback error message

Line ~316 (legacy path, low priority since it's on its way out but still shipping):
```
`[coach error] ${message} (mode=tools model=${process.env.ANTHROPIC_MODEL ?? "(unset)"})`
```

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.3.1 | Not user-facing (system message with brackets — coach only). | APP §3.1.11 exempts structured system messages. | **No change. Keep.** |

---

### 2.4 `src/app/itc/actions.ts` — `looksLikeBareStatus` CTA whitelist

Line 1077:
```
"sit with",
```

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.4.1 | `sit with` appears in the whitelist of "acceptable CTA phrases" but is on the banned list. The whitelist means the coach can end a reply with "sit with this" and the bare-status guard won't flag it. | VS "Language to avoid in every post". | **Remove from whitelist.** The coach should never write "sit with" in the first place. Same for `notice when` if the coach starts using it as a stall — flag but leave for now. |

---

### 2.5 `src/lib/itc/prompts/preamble.ts` — voice section

Loaded on every coach turn. Currently reads em dashes freely in the *instruction to the coach*, banned in the *coach's own output*. Line 155:
```
- NO EM DASHES ANYWHERE IN THE REPLY. Do not use the character —, and do
  not use the pair -- as a stand-in. If you want a pause, use a period
  and a new sentence. If you want to join two clauses, use a comma,
  semicolon, or colon. This prompt uses em dashes freely for INSTRUCTION
  to you, but your OUTPUT to the coachee must never contain them.
```

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.5.1 | Preamble as authored uses em dashes as intra-instruction punctuation. Not user-facing but per the enforcement lint scope in APP §4, the coach voice docs are scanned. | APP §4. | **Convert instruction-text em dashes to commas or periods** so the file passes its own lint. No content change, just punctuation. |
| 2.5.2 | Voice section is missing several bans from the pass: crutch words, Latinate replacements, "It's not X, it's Y" cap, false dichotomy setup, question-as-transition, signposting, sentence-fragment rule, "It's important to note"-family. | VS + WC comprehensive. | **Rewrite voice-rules block** to fold in all applicable rules from both guides (Voice-D scope). |
| 2.5.3 | Voice section has no reference to the substitution table (internalize → the rules you've been running on; regulate → snap at your kids and hate yourself; etc.) | VS "Language level". | **Add substitution table** to preamble (Voice-D scope). |

Actionable in Voice-D, not this checkpoint.

---

### 2.6 `src/lib/itc/prompts/stages/*.ts` — per-stage prompt em dashes

Each stage prompt has 3–15 em dashes in instruction text (e.g. `worries.ts:51: "the map on the next turn still shows [not yet] for that behavior"`). Instruction to the coach, not coachee output.

| # | Violation | Rule | Rewrite |
|---|-----------|------|---------|
| 2.6.1 | Same as 2.5.1 — the enforcement lint doesn't distinguish "instruction to LLM" from "prose meant for a human," so it flags. | APP §4. | **Convert em dashes to commas/periods** file by file. No content change. Sweep applies to all 12 stage prompt files. |

---

### 2.7 ITC UI components — `src/app/itc/[mapId]/*.tsx`

Read every string manually:

| # | String | Location | Violation | Rewrite |
|---|--------|----------|-----------|---------|
| 2.7.1 | `"Type… (Enter to send, Shift+Enter for newline)"` | `conversation.tsx:82` | UI atom — placeholder. Elliptical form OK. Ellipsis char is fine. | **Keep.** |
| 2.7.2 | `"Send"` | `conversation.tsx:99` | UI atom — button. | **Keep.** |
| 2.7.3 | `"Say hello, or tell me what's on your mind about this pillar."` | `conversation.tsx:49` | Empty state prose. Direct, plain, active. Contraction. | **Keep.** |
| 2.7.4 | `"← Maps"` | `page.tsx:59` | UI atom — link label. | **Keep.** |
| 2.7.5 | `"Sign out"` | `page.tsx:77` | UI atom — button. | **Keep.** |
| 2.7.6 | `"1. Improvement goal"` / `"2. Doing / not-doing"` / `"3. Worry box"` / `"4. Competing commitments"` / `"5. Big Assumptions"` | `map-panel.tsx` | Column titles — UI atoms. The ITC framework naming rule applies inside the tool per APP §3, so "Competing commitments" and "Big Assumptions" stay. | **Keep.** |
| 2.7.7 | `"Not yet set."` / `"None yet."` / `"Fills in after behaviors."` / `"My vows to make sure my worries never come true."` / `"Comes together from the commitments."` | `map-panel.tsx` (column placeholders) | Placeholder prose. All plain, all direct. Row 4 ("My vows to make sure...") is doing narrative work as a placeholder, arguably too clever. Rows 3 and 5 use "Fills in after..." which reads like an instruction — fine, but could be tighter. | **Keep 1, 2, 4, 5. Row 4 revisit optional.** |
| 2.7.8 | `"Save goal"` / `"Save changes"` / `"Cancel"` / `"Refine"` / `"Next column →"` | `goal-column.tsx`, `behaviors-column.tsx` | UI atoms — buttons. `Next column →` uses arrow-char for direction; no violation. | **Keep.** |
| 2.7.9 | `"Add a few more words after the stem."` | `goal-column.tsx:44` | Validation message. Plain, direct, complete sentence. | **Keep.** |
| 2.7.10 | `"Add a behavior…"` | `behaviors-column.tsx` (placeholder) | UI atom — placeholder. | **Keep.** |
| 2.7.11 | `"Cap reached (5). Refine or remove one to add another."` | `behaviors-column.tsx` | State prose. Plain, direct, imperative. | **Keep.** |
| 2.7.12 | `"Type a behavior first."` / `"Too short."` | `behaviors-column.tsx` | Validation. Short, imperative or fragment-of-diagnosis. "Too short." is a fragment of diagnosis, functionally a label. | **Keep.** |
| 2.7.13 | `"Remove behavior #${index}?"` in `confirm()` dialog | `behaviors-column.tsx:143` | UI atom — confirm prompt. | **Keep.** |

**Proposal card copy** (`proposal-cards.tsx`):

| # | String | Violation | Rewrite |
|---|--------|-----------|---------|
| 2.7.14 | `"Add to map"` (default accept label) | UI atom. | Keep. |
| 2.7.15 | `"Pass"` (reject button) | UI atom. Plain, direct. | Keep. |
| 2.7.16 | `"Edit"` (edit button) | UI atom. | Keep. |
| 2.7.17 | `"Save & add"` / `"Save & lock all"` / `"Save test"` / `"Record results"` / `"Remove"` / `"Go with #${index}"` | UI atoms. | Keep. |
| 2.7.18 | `"Passed on ${humanType(payload.type)} — kept probing."` | `proposal-cards.tsx:111` | **Em dash violation.** Also "Passed on X" reads slightly awkward — clearer with a period or a colon. | **Rewrite:** `"Passed on ${humanType(payload.type)}. Kept probing."` |
| 2.7.19 | `"(Stale — coach moved on)"` | `proposal-cards.tsx:117` | **Em dash violation.** | **Rewrite:** `"(Stale. Coach moved on.)"` |
| 2.7.20 | `"Goal locked in"` / `"Behavior added"` / `"Worry locked in"` / `"Hidden commitments locked in"` / `"Big Assumption locked in"` / `"Test saved"` / `"Results recorded"` / `"Recommendation accepted"` / `"Behavior refined"` / `"Behavior removed"` | Locked-state labels. Plain, direct, past-tense. Short punchy landing. | **Keep.** |
| 2.7.21 | `"Recommendation: test assumption #${assumption_index}"` | Label. Complete phrase but no verb — functionally a label. | Keep. |
| 2.7.22 | `"Coach flagged behavior #${index} for removal. Confirm to drop it from the map."` | `RemoveBehaviorCard` prose. "Coach flagged" reads slightly clinical. | **Rewrite:** `"Coach flagged behavior #${index} to drop. Confirm to remove it."` |

---

## 3. Outbound emails (`src/lib/email.ts`) — detailed

Every template is short and mostly already in the guide's register. Main violations: em dashes in subject lines and sign-offs.

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 3.1 | `sendInviteEmail` subject line 71 | `` `You're in — ${opts.communityName}` `` | Em dash. | `` `You're in. ${opts.communityName}.` `` |
| 3.2 | `sendInviteEmail` text/html sign-off line 71–77 | `— BRAVE MAN OS` | Em dash sign-off appears in every email. | **Sign off with a line break and a plain-cap `BRAVE MAN OS`.** No dash. |
| 3.3 | `sendDailyReminderEmail` text sign-off line 92 | `— BRAVE MAN OS` | Same. | Same. |
| 3.4 | `sendMissionDayNudgeEmail` text sign-off line 111 | `— BRAVE MAN OS` | Same. | Same. |
| 3.5 | `sendDisengagementEmail` text sign-off line 135 | `— BRAVE MAN OS` | Same. | Same. |
| 3.6 | `sendWeekCloseEmail` text sign-off line 179 | `— BRAVE MAN OS` | Same. | Same. |
| 3.7 | `sendLeaderDisengagementAlert` subject line 153 | `` `${opts.memberName} — ${opts.daysSince} days silent` `` | Em dash. | `` `${opts.memberName}. ${opts.daysSince} days silent.` `` |
| 3.8 | `sendDigestEmail` subject line 197 | `` `${opts.communityName} — week of ${opts.weekStart}` `` | Em dash. | `` `${opts.communityName}. Week of ${opts.weekStart}.` `` |
| 3.9 | `sendDigestEmail` html headline line 199 | same as above | Em dash. | Same. |
| 3.10 | `sendDailyReminderEmail` subject `"Log today."` | | Perfect example of the guide's register. | **Keep.** |
| 3.11 | `sendMissionDayNudgeEmail` subject `"Mission day. Report back."` | | Same. | **Keep.** |
| 3.12 | `sendDisengagementEmail` gentle line `"Been ${opts.daysSince} days since your last check-in."` | | Plain, direct, second-person. Contraction implied ("Been" not "It's been"). | **Keep.** |
| 3.13 | `sendDisengagementEmail` direct line `"${daysSince} days. Your brothers noticed. Get back in."` | | Textbook build-to-a-drop. Three short sentences, landing on an imperative. | **Keep. Do not touch.** |
| 3.14 | `sendDisengagementEmail` subject direct `"You've gone quiet."` | | Perfect. | **Keep.** |
| 3.15 | `sendLeaderDisengagementAlert` body `"Personal check-in from you now saves the man."` | | Direct. Anglo-Saxon. Concrete. | **Keep.** |
| 3.16 | `sendDailyReminderEmail` greeting `"Brother"` when no first name | | Slightly generic. Not a violation. | **Keep.** |
| 3.17 | HTML button labels `"Sign in"`, `"Log today"`, `"Report back"`, `"Open leader panel"`, `"Close it out"` | | UI atoms. Perfect. | **Keep.** |

---

## 4. Other pages — spot-audit summary

Full string-by-string audit not performed (78 files, out of session budget). Every file below was opened and read for major violations against the ban lists. Findings:

### 4.1 `/today` (`src/app/(app)/today/*.tsx`)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.1.1 | `reflection-panel.tsx:76` | `"Auto-saves as you type. Only you and your coach see this — never your community."` | Em dash. | `"Auto-saves as you type. Only you and your coach see this. Never your community."` |
| 4.1.2 | `reflection-panel.tsx:59` | `"What worked today? Any small victory counts."` | Two questions in prose. First is fine; "Any small victory counts." is a complete sentence. | **Keep.** |
| 4.1.3 | `reflection-panel.tsx:68` | `"What did today teach you? What'll you do differently?"` | Two questions, both complete. Contractions used. | **Keep.** |
| 4.1.4 | `reflection-panel.tsx:130,136,144` | `"SAVING…"` / `"SAVED"` / `"ERROR"` badges | UI atoms. | **Keep.** |
| 4.1.5 | `checkin-board.tsx:65` | `"Action (A) is auto — it flips to 1 when a mission dated today is marked done."` | Em dash. | `"Action (A) is auto. It flips to 1 when a mission dated today is marked done."` |

### 4.2 `/missions` (`src/app/(app)/missions/*.tsx`)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.2.1 | `page.tsx:101` | `"5 per goal, 5 unattached — max 15 per week. Quarter ends in {daysToQEnd} day"` | Em dash. | `"5 per goal, 5 unattached. Max 15 per week. Quarter ends in {daysToQEnd} days"` (also pluralization fix) |
| 4.2.2 | `page.tsx:117` | `"Missions serve goals. Set one first — or set an unattached mission below."` | Em dash. | `"Missions serve goals. Set one first, or set an unattached mission below."` |
| 4.2.3 | `page.tsx:150` | `"Front-load Monday. It's Sunday — plan the week before it hits."` | Em dash. | `"Front-load Monday. It's Sunday. Plan the week before it hits."` |
| 4.2.4 | `page.tsx:130, 146` | `` `THIS WEEK · {format(...)} –{...}` `` and `NEXT WEEK` variant | En-dash separator between dates (`Mon 3–7`). This is functional date-range notation; en-dashes are also on the ban list per VS. | **Rewrite:** use `to` or `→`: `THIS WEEK · Mon 3 to 7` or `THIS WEEK · Mon 3 → 7`. |

### 4.3 `/goals` (`src/app/(app)/goals/*.tsx`)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.3.1 | `new-goal-form.tsx:33` | `"NEW GOAL — Q START {currentQuarterStart}"` | Em dash. | `"NEW GOAL. Q START {currentQuarterStart}"` or drop the dash: `"NEW GOAL Q{n} · {date}"` |

### 4.4 `/community` (`src/app/(app)/community/*.tsx`)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.4.1 | `page.tsx:82` | `body="Invites pending — check back once your brothers sign in."` | Em dash. | `body="Invites pending. Check back once your brothers sign in."` |
| 4.4.2 | `page.tsx:236` | `hint="Avg quality score (0–10) across missions in the last 28 days. Min 3 to qualify."` | En dash in number range. | `hint="Avg quality score (0 to 10) across missions in the last 28 days. Min 3 to qualify."` |
| 4.4.3 | `page.tsx:335` | Code comment. | | **Keep (out of scope).** |

### 4.5 `/coach` (member coach hub — `src/app/(app)/coach/*.tsx`)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.5.1 | `conversation.tsx:60,73` | Code comments. | | **Keep (out of scope).** |

Actual user-facing copy in this route is minimal (thread renderer). Spot-check clean.

### 4.6 `/me/*` (self surfaces)

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.6.1 | `partner/page.tsx:48` | `<option value="">—</option>` | Em-dash placeholder in `<select>`. | `<option value="">(none)</option>` or `<option value="">--- select ---</option>` if a visual placeholder is required. |
| 4.6.2 | `survey/[id]/page.tsx:98` | `{delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} {Math.abs(delta)} vs prior` | Em dash used as "zero" indicator in a delta chip. | Replace with `"·"` (middot) or `"0"`. |
| 4.6.3 | `survey/page.tsx:85` | `"Composite {n} vs {n} last time —"` | Em dash. | Replace with a period + `Delta:` prefix on the next span. |
| 4.6.4 | `me/page.tsx:9` | `if (!iso) return "—"` (return value for missing date) | Em dash. | Return `"(none)"`. |

### 4.7 `/leader/*`

| # | Location | Current | Violation | Rewrite |
|---|----------|---------|-----------|---------|
| 4.7.1 | `leader/page.tsx:122` | `` `${u.first_name} ${u.last_name}` || u.email : "—"` `` | Em dash fallback. | `"(unnamed)"`. |
| 4.7.2 | `disengagement/page.tsx:49` | `|| (u?.email ?? "—")` | Em dash fallback. | `"(unknown)"`. |
| 4.7.3 | `disengagement/page.tsx:77–80` | Section titles: `"14+ days silent — call them"`, `"14 days — leader outreach"`, `"7 days — direct nudge"`, `"3 days — gentle nudge"` | 4 em dashes. | `"14+ days silent. Call them."` / `"14 days silent. Leader outreach."` / `"7 days silent. Direct nudge."` / `"3 days silent. Gentle nudge."` |
| 4.7.4 | `actions.ts:209` | `"Action is derived from mission completion — correct the mission instead."` | Em dash. Server-action error. | `"Action is derived from mission completion. Correct the mission instead."` |

### 4.8 `/admin/*`

Per §1 scoping, admin surfaces are working tools for facilitators. Get plain-language and banned-vocabulary rules, not full craft treatment. Spot-audit: no banned words. Em dashes scattered in labels — same rewrite pattern (dash → period). Deferred to Voice-B.

### 4.9 `/design` (dev-only route)

Two em dashes at `design/page.tsx:36,209`. Dev-only, gated behind env flag. **Deferred.** Non-user-facing in prod.

### 4.10 `/onboarding/*`

Sampled `goal/goal-form.tsx` — clean (no dashes, no banned words). Suggestions like `"Weekly date night with my wife, every week this quarter."` are exemplars of the register. Deep audit of remaining onboarding steps deferred to Voice-B.

### 4.11 `/itc/login`, `/itc/logout`

Sampled. Login form + logout button. Minimal copy. Clean.

---

## 5. `docs/coach-voice-and-tone.md` — pre-Voice-D findings

Currently 194 lines. Already carries: no em dashes, no markdown, "Never reference the interface," "Never reference validation." Missing to satisfy the full pass:

| # | Missing rule | Where it comes from | Voice-D task |
|---|--------------|---------------------|--------------|
| 5.1 | Full substitution table (internalize → …; regulate → …; etc.) | VS "Language level" | Add as an explicit section. |
| 5.2 | Anglo-Saxon > Latinate rule + short list (help > assist, use > utilize, start > commence, show > demonstrate) | WC "Words" | Add. |
| 5.3 | Crutch-word ban (very, really, quite, rather, somewhat, truly) | WC "Words" | Add. |
| 5.4 | "It's not X, it's Y" one-per-reply cap | WC "Constructions that mark the writing as machine-made" | Add. |
| 5.5 | Anaphora rule | WC | Add. |
| 5.6 | False-dichotomy setup ban | WC | Add. |
| 5.7 | Signposting/summary-sandwich ban | WC | Add with APP §3.1.5 stage-intro exception. |
| 5.8 | Question-as-transition ban | WC | Add with APP §3.1.2 elliptical-question exception. |
| 5.9 | "It's important to note" family ban | VS | Add. |
| 5.10 | AI-signature vocabulary ban (delve, tapestry, navigate, resonate, elevate, leverage, robust, profound, deeply, genuinely, truly as intensifiers) | VS | Add. |
| 5.11 | Sentence-fragment rule + APP §3.1.1 UI-atom + §3.1.2 elliptical-question exceptions | VS 2.2 | Add. |
| 5.12 | Contractions everywhere | VS | Add explicitly (currently implicit). |
| 5.13 | Profanity scope: only when coachee's own register invites it | APP §5 | Add. |
| 5.14 | Build-to-a-drop rhythm | VS + WC "Sentences" | Add. |
| 5.15 | No abstract nouns (framework, architecture, foundation, ecosystem, structure) with the APP §3.1.7 exception for "the immune system" | VS + APP §3.1.7 | Add. |

Voice-D scope. Not touched in this checkpoint.

---

## 6. `src/lib/itc/prompts/preamble.ts` — pre-Voice-D findings

Same as §2.5 above plus §5. Rewritten in Voice-D.

---

## 7. Member coach system prompt

`src/lib/coach/voice-rules.ts` was referenced in `docs/coach-voice-and-tone.md`. Does not exist in the repo. Members app coach is Phase 2 per PRODUCT_SPEC.md and hasn't been built yet, so no member-coach system prompt to audit. When it's built, it inherits the same voice doc.

---

## 8. Prioritized rewrite plan

Ordered by expected impact on the coachee's read of the app.

**P0 — high-visibility user-facing copy:**
1. ITC coach prose (2.1, 2.2) — remove UI narration from startMap greeting and STAGE_INTROS.
2. Outbound email em dashes (3.1–3.9).
3. `/today` reflection-panel em dashes (4.1).
4. `/missions` page em dashes (4.2).
5. `/community` page em dashes (4.4).
6. `/leader/disengagement` section titles (4.7.3) — highly visible on a working tool.
7. `/me/*` em-dash fallbacks (4.6).

**P1 — lower-visibility user-facing:**
8. `/goals` new-goal-form header (4.3).
9. `/leader/*` other em dashes (4.7).
10. `/admin/*` em-dash sweep (§4.8).
11. `/onboarding/*` full audit (§4.10).
12. ITC proposal-card resolved-state labels (2.7.18, 2.7.19).

**P2 — internal, deferred:**
13. Preamble + stage-prompt em dashes (2.5.1, 2.6) — punctuation-only, no coachee-visible effect. Sweep as part of Voice-D since preamble is being rewritten anyway.
14. `/design` route (4.9) — gated.
15. Code comments — out of scope.

**Voice-D (separate from this rewrite pass):**
- Full rewrite of `docs/coach-voice-and-tone.md` per §5.
- Full rewrite of ITC preamble voice section per §2.5.
- Wire the voice doc into the ITC preamble (already done) and confirm loading.

**Voice-E (separate):**
- Lint script scanning strings + prose files against the ban lists. Allow-list mechanism.
- CI integration.

---

## 9. Not touched by this pass

- Every code comment (~all 472 `src/lib/**` em-dash hits).
- Every JSDoc block.
- Every internal system message (structured `[type] payload` format).
- The 15 Partner Connection Survey questions (VS §2.7 exempt).
- Any legally-meaningful disclosure.

---

**Total user-facing string changes in the P0+P1 plan: ~40.** No behavior changes, no logic changes, no test changes required. Applied in Voice-B after review.
