# DECISIONS

Live log. When the spec is silent, choices land here.

## Section 11 open items (resolved by user in build kickoff)

1. **Leaderboard composite** — 70% Daily Living weekly total (normalized to /56), 30% mission completion rate. Formula: `round( (dailyTotal/56)*100*0.7 + missionRate*100*0.3 )`.
2. **Late-completed missions** — full credit, `completed_late` flag set true; UI renders "Completed · late" pill.
3. **Missions cap** — 5 per week per user. Enforced by DB trigger `enforce_mission_weekly_cap_trg` and app validation.
4. **Win-back window** — 30 days after `deactivated_at`. Encoded in `src/lib/entitlement.ts` (`WIN_BACK_DAYS`) and memberships.`canceled_visible_until`.
5. **Price point** — $39/month; **coach message allowance** — 150 messages/month. Recorded here for Phase 2 metering; no runtime impact yet.
6. **Coach conversation flags** — platform admin only. RLS policy on `coach_flags_queue` scoped to `is_platform_admin()`; community leaders have no read access.

## Smallest-reasonable-choice log (build-time defaults)

- **Branding folder path.** Spec references `/branding`; actual repo folder is `Dad Edge Branding Guidelines/`. Web-optimized assets live at `/public/brand/` and are the runtime source; the raw folder remains untouched as archival. `/public/brand` is the only path components reference.
- **Tracker filename.** Spec references `DAD_EDGE_BRAVEMAN_TRACKING_2026-2.xlsx`; actual file is `Brave Man Sheet.xlsx`. Importer accepts either via `--file` arg; defaults to `Brave Man Sheet.xlsx` if the spec-named file is absent.
- **Migration application.** Migrations authored as `supabase/migrations/*.sql`. Apply locally via `npx supabase start && npx supabase db reset` (Docker required) or push to a hosted project via `npx supabase link && npx supabase db push`. See README §Migrations.
- **Fonts.** Trade Gothic Bold and Proxima Nova are licensed via Adobe Fonts; not shipped yet. Fallbacks (Archivo, Inter) load via `next/font/google` in `src/lib/fonts.ts`. Swapping to Adobe Fonts requires only replacing that file — no component edits.
- **Tailwind version.** Tailwind v4 alpha (uses `@theme` in `globals.css`) so the token file is the single source of truth and Tailwind classes plus `var(--color-*)` refer to the same values.
- **Route group scaffolding.** `(app)`, `(leader)`, `(admin)` groups created empty for Checkpoint A; populated in Checkpoint B onward.
- **User timezone default.** `America/Chicago` at DB level; overridden per-user in onboarding. Chosen because Dad Edge HQ operates in CST.
- **Pillar color mapping.** Rotated blue/cyan/green/orange/purple/red across B/R/A/V/E/M and tints of blue/cyan for A2/N so eight distinct hues stay within the approved palette. Locked in `src/lib/pillars.ts` and CSS tokens.
- **Streak visual.** Triangle glyph (▲) as a stand-in for a flame icon so no additional asset is needed and the mark stays visually consistent with the "command center" language. Replaceable with an inline SVG later without contract change.
- **Design route protection.** Public in dev; requires `ALLOW_DESIGN_ROUTE=1` in production. Prevents leaking the component library on live tenants.
- **`users.canceled_at`.** Added via migration `20260713000008` so the §5 entitlement gate has a per-user "when did canceled state begin" moment; `memberships.deactivated_at` is per-community and doesn't fit the app-level gate.
- **Check-in three-state cycle.** Toggle rotates null → 1 → 0 → null. Blank-vs-zero preserved (null deletes the row via the server action; 0 upserts a value=0 row).
- **Mission concreteness gate implementation.** Rejects vague-only patterns ("be more present", "focus on…", "improve"), requires an action verb in the first three words, requires target_date to be a real ISO date, and enforces min-length 8 (DB backstop mirrors this). Full list in `src/lib/validation/mission.ts`.
- **Weekly mission cap enforced twice.** Server-action validation counts the same week the DB trigger counts, so the UI can show "Weekly cap reached" without waiting for the DB error.
- **Streak flavor.** Engagement streak (consecutive prior days with any check-in row) is what the header chip on /today shows. Per-pillar streaks come with the community view (Checkpoint C).
- **Session helper redirect strategy.** `requireUser` redirects to `/login?next=…`; `requireAccess` redirects to `/inactive` when the gate returns none. Read-only (canceled-within-win-back) still renders pages, but write-path server actions early-return `Read-only account.`.
- **Seed script writes as service role.** Uses `auth.admin.createUser` so seeded members can sign in via magic link with the same email. Idempotent via natural keys (`user + date + pillar`, `slug`, `user + community`).
- **Onboarding tracked as `users.onboarding_step` (0..7).** Migration `20260713000009` adds it. `requireAccess()` redirects to the resume step; onboarding layout redirects home when complete. Backfill treats anyone with a check-in row as fully onboarded.
- **`users.why_yes` column.** Same migration adds it so the coach can read the man's stated reason on first conversation (Phase 2). Never surfaced in community views.
- **Onboarding partner+kids steps are skippable.** Per §12.1: identity and why are required, partner/kids optional. Skip advances the step counter so the user isn't looped back.
- **Missions in leaderboard denominator.** `mission_rate = completed / (completed + missed)` — planned-but-not-yet-past does not penalize. Rolled-over is neutral. Matches DECISION #1 intent (rate captures follow-through, not ambition).
- **Streaks tab replaces composite with streak days.** Composite drives Weekly/Monthly rows; the Streaks tab ranks purely by engagement streak, using the leaderboard row layout with `composite` field holding the streak number for display.
- **Community scorecard shows within-win-back inactive members.** Per §5: canceled members still visible to their group for the 30-day window. Row gets an "INACTIVE" badge; no leaderboard placement (`.eq("status", "active")` on leaderboard queries).
- **Survey notes are required-in-UI.** The DB allows null `note` for flexibility, but the take-survey form refuses to submit unless every question has a note. Her words are the point; scores without notes are worthless.
- **Family-layer joins use array-safe casting.** Supabase-JS types Foreign Key joins as arrays regardless of `.maybeSingle()` semantics on the parent, so accessors do `Array.isArray(x) ? x[0] : x` to handle both shapes. Documented once here; pattern is consistent across `/community`, `/me`, `/community/leaderboard`.

## ITC Addendum

Ad-hoc ITC Map Builder for the Boardroom group. Intentionally isolated from the main app; deeper integration comes later. Isolation guarantees are documented in `docs/itc-isolation.md`.

- **Ad-hoc auth is a hard boundary.** ITC uses its own email+password (fixed `1111`) login, a separate `itc_participants` table, and a distinct HMAC-signed cookie (`itc_session`, path=`/itc`). The main `users` table and Supabase auth are never touched by the ITC flow. Matching emails do not link the two identities.
- **Cookie scoping.** `itc_session` is set with `path=/itc`, so browsers do not send it to any other route. Main middleware also short-circuits on `/itc/*` and never runs Supabase session refresh for those requests.
- **RLS deny-all on `itc_*` tables.** All ITC tables have RLS enabled with zero policies. The anon key cannot see them at all. Only the service role (via `/api/itc/*` server code) reads or writes. Participant scoping happens at the API layer, keyed off the `itc_session` cookie's `pid`.
- **Model selection.** `ITC_COACH_MODEL` defaults to `claude-sonnet-5`. Configurable via env so the model can be swapped without a deploy. User confirmed the model ID on 2026-08-11; if the API rejects it at runtime, override the env var.
- **Vercel Hobby-tier cron.** Removed the hourly cron entry from `vercel.json` (the endpoint stays for manual/future use). Hobby accounts only allow daily schedules.
- **Feature flag `ITC_DEMO_AUTH`.** When unset or not `"1"`, the entire `/itc/*` tree 404s via the ITC layout gate. This is how the feature is disabled in production without removing code.
- **`itc_worries.behavior_id UNIQUE NOT NULL`.** Schema enforces exactly one worry per behavior. API stage-machine also refuses to transition to `commitments` until every behavior has a worry.
- **`pillar_code` enum reuse.** ITC maps carry a BRAVEMAN pillar so the ad-hoc feature stays aligned with the main framework vocabulary. No new pillar taxonomy.

## ITC v2 Elevation

Multi-checkpoint upgrade. Judgment calls per checkpoint.

### Checkpoint A — infrastructure

- **Retry cadence.** `runItcCoachTurn` now attempts `generateObject` three times total (initial + 2 retries) before falling back to `generateText`. Chose 3 not 2 because the observed "no object generated" errors were transient in the reviewed session; two retries got us into cost/latency territory (each attempt is a full turn). If cost/latency hurts, drop to 2.
- **Text fallback returns action:null.** A prose-only reply cannot advance stages or save entries — the stage machine and rubric checks (Checkpoint C onward) rely on structured actions. Losing an action for one turn is preferable to a bogus one. The affirmation safety net in `sendCoachMessage` still fires, so goal-lock isn't blocked by a fallback.
- **Empty-turn / dedupe policy.** Guard runs after every coach turn (including the fallback path). Empty replies get one nudge-and-regen. Consecutive verbatim duplicates get one nudge-and-regen with an inline system-message hint. A second failure is accepted — the fallback path guarantees a non-empty string, so nothing empty ever hits the DB.
- **Formatting default is at the prompt.** Numbered-list-for-more-than-two-items and re-display-relevant-list-when-asking are now mandatory in the system prompt, not a UI post-process. Post-processing prose into lists would be brittle; instructing the model is cheaper and cleaner.
- **Live map panel scope for A.** Verified goal, behaviors, worries render live as they lock (columns 1–3). Hidden commitments (col 4) and Big Assumptions (col 5) still render as placeholders because no capture flow exists yet — those wire up in Checkpoint D. Review-stage rendering piggybacks on the always-on right-side panel; no chat recap needed on desktop, and the numbered-list default (1.2) covers mobile and any admin-only chat surface.
- **`/admin/itc` vs `/itc/admin` naming.** Instruction referenced `/admin/itc`; shipped route is `/itc/admin`. Kept the current route since it's already in production and admin nav links point at it. Rename can happen later without functional change.

### Checkpoint B — Column 2 pruning + 1:1 worry gate

- **Parked, not deleted.** Behaviors below the cap set `selected=false` rather than being removed. Guides emphasize the fuller picture is useful context even if only a subset gets a worry pairing. Kept a separate delete affordance for actual typos.
- **Single `prune_behaviors` action instead of batched park/unpark.** Coach emits one `keep_indices` array; server sets `selected=true` for those and `selected=false` for everything else. Atomic, single-turn, and lets the coach propose a whole reshaped set in one move. Alternative (individual park/unpark actions) would require multi-turn coach flow which the current one-action-per-turn schema doesn't support.
- **1-based indices in the schema.** The coach emits 1-based `keep_indices` matching the numbered list it sees in the context block. UUIDs would be reliable but hard for the model to output correctly; index-into-order is simpler and matches how the coach references the list conversationally.
- **Gates enforced in `advanceStage`, not in the client.** `behaviors → worries` refuses if selected count is <1 or >5; `worries → commitments` refuses if any selected behavior lacks a worry. Client-side "continue" button gates on the same rule, but the server is authoritative.
- **`itc_worries.behavior_id UNIQUE` already exists** (per the original addendum). Now paired with the server-side 1:1 gate — the DB constraint prevents two worries per behavior, the stage gate prevents advancement with any missing worry. Both fire.
- **No affirmation safety net at behaviors stage.** The manual "I'm done adding behaviors — continue" button is always available and the coach's prompt is explicit about emitting advance_stage on affirmation. The goal-stage affirmation net was needed because the coach was mid-turn between propose_goal and advance_stage; behaviors doesn't have that seam.

### Checkpoint C — worry depth (rubric + excavation + no false praise)

- **Rubric model = Haiku.** `ITC_RUBRIC_MODEL` defaults to `claude-haiku-4-5-20251001`. Sonnet is overkill for three binary judgments; Haiku is fast, cheap, and firm. Chose an env override so the rubric can be swapped without a deploy.
- **Three binary criteria, sum to 0–3.** is_fear, is_first_person_felt, touches_self_image. Score < 2 always rejects. Score 2 requires at least one prior attempt (i.e., at least one excavation pass). Score 3 locks immediately. Simpler than a continuous score and easier to explain to the coach in prompt.
- **`itc_worry_attempts` table.** Every `propose_worry` lands here with its rubric score and accept/reject state, so the excavation-pass count for a behavior is a cheap `count(*)` rather than transcript heuristics. Enables the "score 2 needs a second attempt" rule without special history walks.
- **Rejections surface to the coach as `[action rejected]` system messages.** Existing catch already writes those. The coach input now includes the last 3 for the next turn's context block. Alternatively I could inject as assistant turns — chose not to because they'd render in the coachee's chat panel.
- **No worry capture UI panel.** Worries are captured exclusively via the coach's `propose_worry` action. The reviewed session showed the coach happily accepting shallow worries when the man typed them freely; forcing every worry through the rubric via a coach turn keeps depth honest. If the coach breaks down completely and can't drive it, the fallback is: participant asks the coach to try again.
- **No-false-praise ban is duplicated in the prompt, not only in the voice-and-tone doc.** The reviewed session showed the model drifted into "brave," "raw," "things most guys never say out loud" praise at exactly the moment the rubric would have scored 1/3. Explicit list of banned praise phrases at the worry-stage instructions.
- **behavior_index vs. behavior_id in propose_worry.** Same reasoning as prune_behaviors: 1-based indices into a stable ordered list are easier for the model to output correctly than UUIDs. The context block shows the selected-behavior numbering explicitly.
- **Server error message is a coach instruction, not user-facing.** "worry not deep enough (score X/3)... Keep excavating with the coachee — do NOT re-propose the same text." The message is captured as a `[action rejected]` system message and only surfaced to the coach's next turn context. The coachee never sees the rubric score.

### Checkpoint D — columns 3–4, reveal, prioritization, test design

- **Two rubrics beyond the worry one.** Commitments rubric is binary-pass (self-protective + first-person, no productivity-blog phrasing); assumptions rubric is the same 3-criterion shape as worries (finished-then + first-person felt + lands in identity/Big Time Bad). Chose consistency with the worry pattern where possible; commitments got a pass/fail because "self-protective" is really the whole test.
- **Reveal beat and full walkthrough are separate.** `reveal_delivered` here tracks the brief gas-and-brake beat at the end of column 3 (v2 3.3b). The deeper immune-system walkthrough gets its own stage and its own `walkthrough_delivered` flag in the next commit. Keeping the two distinct so we can gate prioritize on the walkthrough while still letting the reveal happen mid-column.
- **`itc_assumption_commitments` join table.** Assumptions consolidate — one Big Assumption underwrites several commitments. Join table records which commitments an assumption covers; the map panel renders the coverage inline. Alternative (array column on itc_assumptions) would break relational hygiene and make coverage checks slower.
- **Coverage gate at `assumptions → review`.** Every commitment must be covered by at least one assumption link. Prevents advancing with orphaned commitments and forces the coach to consolidate honestly.
- **Prioritization uses recommend_ then select_ actions.** Coach recommends first (per v2 3.5 — inverted in the reviewed session), then the coachee's pick wins. Two actions so both signals persist and the map panel can render both "coach recommends" and "selected for testing" states clearly.
- **Test design action wiring deferred to Checkpoint E.** The four Appendix D fields and target_date already exist in `itc_tests`. Wiring a `propose_test` action + the target-date validation is straightforward but adds another set of moving parts. Prompt instructs the coach to walk the coachee through the four fields in prose meanwhile; migration path is a one-commit follow-up if E surfaces a real UX need.
- **Rubric feedback surfaces to coach the same way as worries.** Rejected `propose_commitment` and `propose_assumption` both throw with an instruction to rework rather than re-propose. `[action rejected]` messages accumulate in the coach's context via the same last-3 feed established in C.

## Immune System Walkthrough

- **New stage `immune_system` slotted between `review` and `prioritize`.** Distinct from the brief 3.3b reveal beat at column 3 (which stays as-is). Prioritize is now gated on `walkthrough_delivered`, not `reveal_delivered`. Two flags, two beats, no ambiguity.
- **Text-only three-movement delivery for the MVP.** The spec calls for a lit-up in-action visual mode on the map panel (assumption → commitment → behavior → goal, sequential highlight, replay control). Ships in this commit as text only via the prompt's three-movement narrative. Visual choreography deferred as a follow-up; when it ships it can piggyback on the assumption-commitment join table already in place. Fallback rule the spec mandates ("if client is chat-only, use formatted step-by-step trace") is the shipping default.
- **Q&A lives in the same transcript.** No separate table. The stage persists after the walkthrough so the coachee can ask questions freely and the coach answers grounded in HIS map. Coach emits `mark_walkthrough_delivered` + advance_stage only on his explicit readiness signal — not on the coach's initiative.
- **"Ask about my map" reopener deferred.** Spec calls for reopening this stage from the completed-map screen. Not built yet because we don't have a completed-map screen distinct from the in-progress one. When we ship one, the reopener becomes a form that flips `current_stage` back to `immune_system` and `walkthrough_delivered` to `true` (already delivered). One-file addition.
- **canTransitionTo still applies.** Backward moves to any stage remain legal, forward moves must be one step at a time. Since `immune_system` slots at index 6 (was `prioritize`), all downstream indices shifted by one; no external code references the numeric indices so this is transparent.

## ITC State Rebuild — Checkpoint A (2026-08-18)

- **Native tool use replaces the marker + extractor pipeline.** Coach turn runs `generateText` with `tools:` bound to a `TurnScope`; content actions become `itc_action_proposals` cards, immediate actions apply server-side through existing stage guards. See `src/lib/itc/coach-tools.ts`, `src/lib/itc/coach-turn-tools.ts`. Marker parser + leakage regex + extractor LLM are still on disk behind `ITC_PIPELINE=legacy` and deleted once Checkpoint D passes.
- **Rubric-at-proposal-time, not at accept-time.** Worry and assumption depth rubrics run inside the tool's `execute()`. A rejected proposal never becomes a card. The tool result returned to the model names what failed and instructs recovery — this text is invisible to the coachee.
- **Multi-step tool use with `stopWhen: stepCountIs(2)`.** The coach gets one recovery step after a rubric rejection, in the same turn. Cost: one extra model call on rejected proposals. Chosen over next-turn feedback for UX (one exchange instead of a dead beat). If cost becomes prohibitive, revert path: set `stopWhen: stepCountIs(1)`, delete the recovery event-emitter branch, and feed the rejection reason as an `[action rejected]` system message on the coachee's next turn (matches the legacy pattern).
- **Rubric-rejection cap = 1 per turn, enforced two ways.** `stopWhen: stepCountIs(2)` caps model calls. `scope.rejectionsCount` inside `buildCoachTools` blocks any further proposal tool calls after the first rejection, regardless of type. Belt-and-suspenders.
- **On rejection, coach ends on a question and cannot re-propose in the same turn.** The rejection tool-result instructs the model that the coachee's answer supplies the depth, not the coach's rewrite. Enforced by prompt only; if the model ignores it we add a post-step check that fails the turn.
- **Visible-reply policy on rejection: last step only.** If a rubric rejection fired, the coachee sees only the recovery step's prose. Step 1's failed-draft prose is suppressed. Without a rejection, all step texts concatenate.
- **Two new turn-event types: `rubric_rejected_proposal` and `same_turn_recovery`.** Rich payloads (rejected text, rubric scores, is-fear/first-person-felt/touches-identity flags, recovery prose, ends-with-question boolean, step-by-step texts) so live sessions can be audited for whether recovery questions actually land.
- **Preamble no longer teaches marker syntax.** Marker docs replaced with a short "state changes go through tool calls" section and hard rules against referencing rubrics/validation/UI in visible prose. Per-stage prompts still reference the old marker names — legacy still runs if the flag flips; delete at Checkpoint D.
- **`docs/coach-voice-and-tone.md` gained two sections.** "Never reference the interface" and "Never reference validation, rubrics, or rejection" — comprehensive banned lists for both. Every coach turn loads this file; new sections apply immediately.
