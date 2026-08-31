# BRAVE MAN OS — Product Specification

_Snapshot of current app behavior as of 2026-08-24. Reverse-engineered from the codebase at `/Users/jasonmackenzie/Custom Applications/Dad Edge Brave Man OS/`._

_Change log since 2026-08-20 snapshot:_
- Auth phase shipped: email + password (magic-link default retired), forgot-password + activation via admin Send Invite, ITC accounts unified onto main-app auth via `users.itc_access`.
- Resend Stage B live on verified `dadedgeoperatingsystem.com`; branded activation + reset emails.
- Onboarding wizard: added `/onboarding/profile` step (avatar + city + phone) with Facebook-style circular cropper. Goal + mission steps temporarily hidden — 6-step flow (was 7).
- Storage: `avatars` bucket provisioned; `users.avatar_url` + `users.city` columns.
- ITC coachees now go through the same onboarding wizard as main-app users; land back on `/itc` at wizard end.
- Admin `/admin/users`: bulk delete with typed confirmation, universal pending states on every button, `itc_access` toggle on user detail. Row shows sign-in status (`signed in Aug 24` / `NOT ACTIVATED`) via `auth.users.last_sign_in_at` instead of the old "never seen" derived from `last_seen_at`.
- Platform admins auto-provisioned as leader in every community (backfill + DB triggers on new communities / new admins).
- ITC: one active map per participant (DB unique index + app guard); admin triage dashboard with health signals; immune-system side-by-side diagram; SMART review adds `example_rewrite` fragment for coachee self-fix.
- **Scoring model overhaul (2026-08-24):** daily out of 49 (7 checkable pillars × 7 days; Action removed from daily count), missions out of planned count (1 point per completed), combined weekly total displayed as `Daily N/49 · Missions N/M · Total N/(49+M)`. Composite score deleted. Leaderboard ranks by combined_total (tiebreaker: daily_total).
- **Legacy invites removed:** `/admin/invites` page + `leaderInvite` action + `sendInviteEmail` all deleted. All invites go through `/admin/users` → CREATE ACCOUNT → SEND INVITE.
- **Landing `/` redirects signed-in users** to their default landing (`/today` or `/itc`); marketing page only renders for signed-out visitors.
- **Coach → Coach Larry** in nav + on `/coach` page copy.
- **Sign-in loop fix (`f82080d`):** removed `signOut({scope:"others"})` from `updatePassword` (was invalidating the current session under Next.js server-action cookie handling); added `revalidatePath` after auth mutations. Friendly translation of Supabase's "new password can't be the same as old" error into a "you've already set that password — sign in with it" message + a GO TO SIGN IN button on `/reset-password`.
- **Logout:** explicit 303 redirect to `/login` (was 307 to `/` → 405 blank screen).
- Voice/tone pass across every user-facing surface: em-dashes stripped, partner form generalized ("HER" → "PARTNER"), copy tightened per `docs/coach-voice-and-tone.md`.
- **In-app notifications (bell)** shipped: `notifications` table with per-kind dedup, header bell with unread badge + dropdown, five kinds (daily_reminder, week_lock, weekly_digest, quarter_closing, goal_midpoint). New nightly job `goal-midpoint-check`.
- **Weekly summary card** on `/dashboard` — grace-period-gated streaming recap ({ highlight, what_worked, opportunity }) persisted to `weekly_summaries`. Streams via `[HIGHLIGHT]/[WHAT WORKED]/[OPPORTUNITY]` markers with typewriter reveal.
- **Pillar Consistency chart** replaces the old grouped bar chart on `/dashboard`; Action pillar dropped (derived from missions). Daily Living trend card removed — weekly summary now carries the trend narrative.
- **Community tabs shipped:** `/community` is now Leaderboard + People (new). People tab renders a 6-week rolling directory with tenure-normalized activity + streak + mission metrics, gold/silver/bronze pips, search + sort, MESSAGE button.
- **1-on-1 messaging shipped:** `message_threads` + `messages` + `message_reactions` with canonical (a<b) pair ordering, RLS gated on shared-active-community at thread creation, realtime publication. Messages nav item + speech-bubble header icon with unread badge. Two-pane `/messages` shell, quick reactions, day-dividers, optimistic send.
- **Admin memberships management:** `/admin/users/[id]` now edits per-membership role, removes memberships, and adds new ones via community dropdown + role selector. Audit-logged.
- **Admin-only users:** new `users.is_admin_only` flag (requires `is_platform_admin`). `requireAccess()` short-circuits admin-only users to `/admin`; coachee shell hidden. New Account form gains an "Admin only" checkbox.
- **Goals page:** entire improvement-goal section now hidden for users without `itc_access`. Multi-lookup fallback finds the improvement map by `participant_id` when the goal-link is missing (legacy migrated users). (Section was originally called "Adaptive Goal / ITC map"; renamed to "Improvement Goal / Improvement Map" in user-facing copy 2026-08-26 — internal identifiers and database column names still use the ITC prefix.)
- **Nav reordered:** Today → Missions → My Braveman → Community → Coach Larry → Goals → Me → Messages → Admin. Missions moved directly under Today (2026-08-31) — logging today's pillars and hitting missions for the week are the two most-frequent daily jobs, so keeping them adjacent shortens the scan. "Community" replaced "Leaderboard" as the label since the page now has both tabs.
- **Admin polish:** `/admin/jobs` FORCE checkbox on daily reminders + mission-day nudges; new `goal-midpoint-check` + `mark-goals-for-review` jobs. `/admin/help-content` REGEN ALL STALE button. `/admin/disengagement` renamed "Silent" → "Inactive", split "Never activated" out, corrected ranges to 21+/14-20/7-13/3-6 days.
- **Cron dedup fix:** `daily-reminders`, `week-lock`, `disengagement-scan` now dedupe email + notifications per user_id across communities via in-memory Set. Digest stays intentionally per-community.
- **End-of-column reviews shipped (`column_review` surface):** on advance between columns, the coach runs a short structured review of the completed set and persists it as a `column_review` message that renders inline above the Continue button on the closed column. Auto-invalidated when the coachee edits the underlying set. **Refactored 2026-08-31:** goal / worries / commitments / assumptions now run the SHARED CRITERIA module (`src/lib/itc/criteria/`) via `runColumnCriteria` and render deterministically via `renderFindings` with `mode: "column_review"`. Only `behaviors-review.ts` still exists and still uses `generateColumnReview` in `src/lib/itc/coach.ts` (behaviors has no structured criteria). The other four `-review.ts` prompts have been deleted — construction reviews and the hone audit now share one source of truth so the coach can't approve during construction and flag on hone.
- **Hone diagnostic shipped (`hone_diagnostic` surface):** on-demand whole-map audit triggered by the "Hone this map" button on the canvas. **Refactored 2026-08-31:** replaced the 14 typed checks in `src/lib/itc/audit-rules.ts` and the `audit-render.ts` renderer with the shared criteria module (`src/lib/itc/criteria/{types,goal,worries,commitments,assumptions,tests,orchestrator,render}.ts`). `runHoneWaterfall` walks goal → worries → commitments → assumptions and stops at the first column with findings — everything downstream of a broken column is re-derived when the coachee fixes it, so critiquing them now is asking to fix something about to change. Called from `runHoneDiagnostic` in `actions.ts`; rendered by `renderFindings` in `criteria/render.ts` with `mode: "hone"`. `audit-rules.ts` and `audit-render.ts` are deleted. Findings on the same entry share one quoted opener; multiple drift findings on the same assumption merge into one clause naming all paired commitments; multiple critiques on the same entry enumerate as "N things to fix. (a) … (b) …". Result persists as a dismissible amber banner at the top of the map (`hone-diagnostic-banner.tsx`).
- **New rubric-derived field 2026-08-31:** `itc_commitments.mirrors_worry_identity boolean` (migration `20260831000001_itc_commitment_mirrors_worry.sql`) populated by `scoreCommitmentDepth` at save; `checkCommitmentMirrorsWorry` fires `commitment_doesnt_mirror_worry` (critical) when the stored value is false.
- **Downstream re-derive nudges 2026-08-31:** migration `20260831000002_itc_updated_at_downstream_staleness.sql` adds `updated_at` timestamps to `itc_worries`, `itc_commitments`, `itc_assumptions` via triggers. `commitments-row.tsx` and `assumptions-row.tsx` compare upstream vs. current `updated_at` and show an amber "re-derive?" affordance when the upstream is newer. Actions: `redriveCommitmentFromWorry`, `redriveAssumptionFromCommitment` in `src/app/itc/actions.ts`.
- **Walkthrough staleness 2026-08-31:** migration `20260831000003_itc_walkthrough_stale.sql` adds `walkthrough_stale boolean not null default false` on `itc_maps`. AFTER-update triggers on the 5 child tables + a BEFORE trigger on `itc_maps` set it true when anything changes after the walkthrough was delivered. Regenerating clears it. Banner in `map-canvas.tsx` shows "the map has moved — regenerate to refresh the walkthrough".
- **Test snapshot + supersede 2026-08-31:** migration `20260831000004_itc_test_assumption_snapshot.sql` adds `assumption_text_at_design text` to `itc_tests` (captured on save, never mutates). New `superseded` value in `itc_tests.status`. Result view shows "assumption at test time" vs. "current" when they differ. Action: `supersedeTest`.
- **Assumption delete guard 2026-08-31:** migration `20260831000005_itc_tests_restrict_assumption_delete.sql` flips the `itc_tests → itc_assumptions` FK from `ON DELETE CASCADE` to `ON DELETE RESTRICT`. `removeAssumption` in `actions.ts` checks for linked tests first and returns "This assumption has N test(s) attached..." if any exist.
- **Multi-day missions 2026-08-31:** migration `20260831000006_missions_target_dates.sql` adds `missions.target_dates date[] not null` (GIN indexed). `target_date` kept as `max(target_dates)` for backwards compat with jobs and views. Weekly cap unchanged (15/week, 5/goal, 5/other). One COMPLETE tick still closes the mission — no per-day completion.
- **Weekly planner slot grid shipped 2026-08-31:** replaced the single-mission composer (`mission-composer.tsx`) with a slot grid (`weekly-planner.tsx` + `mission-slot.tsx`). Every goal has 5 slots underneath + a separate BRAVE MAN MISSIONS section (5 slots) for unattached. Empty slots render as "+ ADD MISSION" placeholders. Autosave on blur; Enter saves, Shift+Enter newline; auto-resizing textareas. Day picker is a multi-select day-of-week toggle (M T W T F S S). Quality pill shows just the score (10/10 / 6/10 / 3/10) with click-to-expand feedback panel (no hover). Completed missions are fully read-only, pill visible but non-interactive. Column headers above the slots: MISSION | DAY YOU'LL DO IT | COACH.
- **Mission scoring rubric update 2026-08-31:** `time_bound` in `src/lib/coach/mission-quality.ts` now reads the `target_date` field directly (score 2 when set, 0 when missing) — no longer parses the description for dates. Verb-allowlist (`CONCRETE_VERBS`) deleted from `src/lib/validation/mission.ts`; only the vague-pattern blocklist + min length remain.
- **Goal coaching consolidation 2026-08-31:** LLM `entry_thread` reaction for goals deleted. `fireCoachReaction` is no longer called with `kind: "goal"`; the `if (kind === "goal")` pillar-mismatch + role-identity prompt blocks in `coach.ts` are gone. All goal coaching lives in `criteria/goal.ts` (currently just `checkBundledGoal`). `switchMapPillar` action + `SwitchPillarButton` component deleted. `suggested_pillar` removed from `ReactionSchema` and `persistReaction` payload.
- **Mission COMPLETE gated behind confirmation 2026-08-31:** COMPLETE flips a mission to read-only (no more edits to description / days / score), so a one-click transition was too easy to trigger by accident. `useConfirm` hook + `ConfirmDialog` promoted from `src/app/itc/[mapId]/` to `src/components/ui/` (six ITC callsites re-imported) so both surfaces share one dialog. Missions dialog copy: "Completing locks this mission — only do this when it's actually done."
- **Mission carry-forward action 2026-08-31:** new `→ NEXT WEEK` pill in the row actions duplicates a mission +7 days, preserving multi-day patterns (M/T/F/S stays M/T/F/S). Works on active AND completed missions — covers "this is my weekly staple" and "push this forward" without introducing recurrence state. Backed by new server action `carryMissionToNextWeek` (`src/app/(app)/missions/actions.ts`) which copies with `shiftDatesByOneWeek` (UTC-safe day math in `target-dates.ts` — tested against DST spring-forward + fall-back weeks). Source row untouched (unlike `rolloverMission`, which flips source to `rolled_over`). `rolled_over_from_mission_id` on the child is the link. Missions page always loads through `nextWeek[6]` (rendering next-week section still Sunday-only) so a `carriedForwardIds: Set<string>` can thread down to the slot; once carried, the button relabels to `✓ CARRIED` + disables, preventing duplicate spawns.
- **Row actions column re-laid out with fixed sub-slots 2026-08-31:** each action (COMPLETE / → NEXT WEEK / ×) now lives in its own fixed-width sub-column (68 / 92 / 24px, +2×4 gap = 192px) inside the actions grid. Empty slots render as spacers so buttons hold consistent x-positions between active and completed rows — before, `justify-end` + hidden buttons let siblings slide right and mis-align the grid.
- **Legacy `rubric_reason` backfill 2026-08-31:** migration `20260831000008_itc_null_legacy_pass_rubric_reason.sql` nulls `rubric_reason` on `itc_worries` / `itc_commitments` / `itc_assumptions` / `itc_behaviors` rows where `depth_score >= 3`. Before `composeXxxSharpen` shipped, saves persisted the depth rubric's pass-reason ("All three criteria met.") verbatim — which then rendered inside the red "ONE THING TO SHARPEN" box as a critique. The current save path writes `null` on pass; the migration cleans the historical corpus so the contract "`rubric_reason` populated ⇒ this row needs sharpening" holds retroactively.
- **Help extractor handles ternary-labeled buttons 2026-08-31:** `collectJsxText` in `scripts/help/extract-routes.ts` now unwraps `{cond ? "A" : "B"}` JSX expressions when both branches are string literals (prefers `whenFalse` as the default state). Without this the `→ NEXT WEEK` / `✓ CARRIED` toggle button dropped out of the manifest and the help-content LLM had no way to describe carry-forward.

---

## 1. Overview

**BRAVE MAN OS** is a multi-community accountability platform for men implementing the BRAVE MAN framework. It combines daily pillar check-ins, day-anchored missions, quarterly goals, a community leaderboard, an AI coach, and a private "family layer" for tracking partner and children relationships. Positioned as a lower-ticket offering beneath full Dad Edge memberships.

**Roadmap phase model** (per `braveman-app-build-config.md`):
- **Phase 1 — Core Tracker** (largely complete)
- **Phase 2 — The Coach** (in progress; scaffolding shipped, allowance metering and email delivery pending)
- **Phase 3 — Stripe Billing** (not started; subscription status currently managed manually)
- **Phase 4 — Polish & Expand** (push notifications, deeper analytics, funnel integrations)

**Tech stack**
- Next.js 15 (App Router) + TypeScript 5.6
- React 19 + Tailwind CSS v4 (alpha) + custom shadcn-style components
- PostgreSQL via Supabase, with Row Level Security everywhere
- Supabase Auth — email + password (magic-link fallback removed); admin-driven activation via Send Invite; forgot-password via recovery link
- Supabase Storage — `avatars` bucket (public read, authenticated write-to-own-folder RLS)
- Anthropic Claude API (Sonnet for substantive coach turns, Haiku for routing/safety/summaries/titling)
- Resend for transactional email (Stage B live — activation + reset + all app notifications route through verified `dadedgeoperatingsystem.com`)
- Vercel for hosting + cron
- PostHog + Sentry configured but not yet wired

**Reference documents in repo**
- `braveman-app-build-config.md` — authoritative product spec (32 KB)
- `DECISIONS.md` — decision log for open items and build-time defaults
- `README.md` — quick-start and checkpoint status
- `Phase 1 Build Config` — original Phase 1 scope notes
- `Brave Man Sheet.xlsx` — legacy tracker workbook (Phase 1D importer target)

---

## 2. The BRAVE MAN Framework

Eight pillars, seven of which are self-reported daily; one is derived from mission completion.

| Code | Label | Point rule | User-choosable? |
|------|-------|-----------|-----------------|
| B  | Bond      | daily_binary | Yes |
| R  | Raise     | daily_binary | Yes |
| A  | Amplify   | daily_binary | Yes |
| V  | Vitality  | daily_binary | Yes |
| E  | Enjoyment | daily_binary | Yes |
| M  | Movement  | daily_binary | Yes |
| A2 | Action    | derived_from_missions | No (derived) |
| N  | Network   | daily_binary | Yes |

- Canonical definition: `src/lib/pillars.ts` and DB seed `supabase/migrations/20260713000007_seed_framework_and_survey.sql` (`pillar_framework_versions` v1, effective 2026-01-05).
- Weekly max score = 56 (8 pillars × 7 days).
- `A2` is not user-selectable when picking a pillar for goals or missions — filtered out via `CHOOSABLE_PILLARS`.
- Deeper semantic meanings of each pillar (beyond the label) are not encoded in code or seed data — they live in external brand/coaching material.

---

## 3. Routes / Pages

### 3.1 Auth
| Path | File | Behavior |
|------|------|----------|
| `/` | `src/app/page.tsx` | Marketing landing (signed-out only). Signed-in users get server-side redirected to `/today` (admins + non-ITC users) or `/itc` (non-admin `itc_access=true` users). |
| `/login` | `src/app/login/page.tsx` | Email + password sign-in (default). Two modes: `signin`, `forgot`. Public sign-up is off — accounts are admin-created via `/admin/users`. After `?reset=1`, the sign-in form is hidden and a "Check your email" panel renders instead (avoids implying they can sign in while waiting on the reset email). |
| `/auth/callback` | `src/app/auth/callback/page.tsx` + `callback-bridge.tsx` | Handles both PKCE (`?code=`) and hash-based (`#access_token=...&type=`) flows. PKCE resolves server-side via `exchangeCodeForSession`. Hash flow renders a client bridge that calls `setSession()` then routes by `type`: `recovery` → `/reset-password` (or `next`), `invite` → `/set-password`, others → `next` / `/today`. |
| `/set-password` | `src/app/set-password/page.tsx` | Activation destination for admin Send Invite links. User arrives already-authenticated, sets a password, `updatePassword()` invalidates other sessions and lands them on `/itc` (ITC users) or `/today`. |
| `/reset-password` | `src/app/reset-password/page.tsx` | Same shape as set-password with reset copy. Also lands on `/itc` or `/today` based on `itc_access` + admin status. When Supabase rejects the update because the new password matches the current one, the raw error is translated to "You've already set that password. Sign in with it here — no need to reset again." + a GO TO SIGN IN button so the user isn't stuck in a reset loop. |
| `/logout` | `src/app/logout/route.ts` | POST-only. Explicit 303 redirect (default 307 preserved POST → 405 blank screen). Lands on `/login`. |
| `/inactive` | `src/app/inactive/page.tsx` | Shown when subscription is `canceled` and the 30-day win-back window has elapsed. |

**Sign-in landing logic** (in `signIn` and `updatePassword`, `src/app/login/actions.ts`):
- Explicit `?next=` param wins.
- Platform admins → `/today` (their admin surface lives there).
- Non-admin users with `itc_access=true` → `/itc`.
- Everyone else → `/today`.

**Send Invite / activation** (Supabase quirk): `type: "invite"` in `generateLink` rejects existing users ("A user with this email address has already been registered"). Since `createAccount` always pre-creates the auth row, admin invites use `type: "recovery"` under the hood with `redirectTo=/auth/callback?next=/set-password`. From the user's POV nothing changes — they click, land on `/set-password`, set a password.

### 3.2 Onboarding (6 steps, tracked by `users.onboarding_step`)

Total step count lives in `ONBOARDING_STEPS_TOTAL` in `src/lib/session.ts` (currently 6, was 8 before goal + mission were hidden — pages still exist and can be re-enabled by restoring them to `onboardingRouteFor` and bumping the constant back to 8). Redirects always resume the user at their current incomplete step; completion sends non-ITC users to `/today` and ITC users (`itc_access=true`) to `/itc`. Platform admins bypass the gate entirely (they can visit onboarding URLs directly but aren't force-redirected).

1. `/onboarding` — **Identity.** First name, last name, timezone (11 presets), occupation, employment type (`w2` / `contract` / `self_employed` / `business_owner` / `other`).
2. `/onboarding/profile` — **Profile.** Facebook-style circular avatar cropper (via `react-easy-crop`), city, cell phone. All optional; Skip button advances without saving. Cropper renders a 512×512 JPEG client-side and posts as a base64 data URL; server decodes and uploads to `avatars/{user_id}/profile.jpg` via the service client. Cache-busted public URL stored in `users.avatar_url`.
3. `/onboarding/why` — **Why you're here.** Free-text captured to `users.why_yes`; fed to the coach later.
4. `/onboarding/partner` — **Partner profile** (optional, skippable). Name, relationship label (`wife` / `husband` / `partner` / `girlfriend` / `boyfriend` / `fiancee`), partner birthdate, relationship date, three "things you love most about her" entries.
5. `/onboarding/kids` — **Children** (optional, skippable, repeatable). Per child: name, birthdate, three "things you love most" entries.
6. `/onboarding/first-checkin` — **First check-in.** Toggles across all 8 pillars for today, guaranteeing day-one activity.

**Hidden (still routed if accessed directly):**
- `/onboarding/goal` — first quarterly goal picker. Removed from the flow 2026-08-24 pending design work.
- `/onboarding/mission` — first mission picker. Same status.

### 3.3 Member app (route group `(app)`)
| Path | File | Purpose |
|------|------|---------|
| `/today` (also root default) | `src/app/(app)/today/page.tsx` | Daily check-in hub. Shows the viewed day's date, this week's Daily Living total (0–56), engagement streak, 8-pillar tap-to-toggle grid, and a Reflections panel with optional Wins/Learnings text. `A2` is displayed as derived from the day's mission completions. **Past-day editing:** accepts `?date=YYYY-MM-DD` to view/edit any prior day back to the earliest still-editable date (see §6 Week lock). Prev/next chevrons in the header page through valid days; out-of-range or malformed dates silently redirect to bare `/today`. Header H1 flips to "Edit &lt;date&gt;" and shows an "EDITING PAST DAY" accent when the viewed date isn't today. |
| `/missions` | `src/app/(app)/missions/page.tsx` | Weekly mission planner. Shows this week (and next week if today is Sunday), active quarterly goals, quarter-deadline countdown, mission creation form with concreteness validation, and mission completion controls with completed-late flag. |
| `/goals` | `src/app/(app)/goals/page.tsx` | Quarterly goal management (create / edit / status). "Improvement goal" section (improvement map card) is gated on `users.itc_access=true`; hidden entirely for coachees without ITC access. Two states: **map in progress** → `AdaptiveGoalCard` links into `/itc/[mapId]`; **no map** → `NoImprovementMapCard` CTA with a primary START button that lands on `/itc` (was a dead-end italic sentence before the 2026-08-26 nav integration). Multi-lookup fallback: if the `quarterly_goals.itc_map_id` link is missing (legacy migrated users whose map predates the goal-mirror hook), looks up the map by `participant_id`. User-facing label renamed from "Adaptive Goal / ITC map" 2026-08-26; DB columns + internal identifiers still ITC-prefixed. |
| `/community` | `src/app/(app)/community/page.tsx` | Two-tab shell (`community-tabs.tsx`) driven by `?tab=` param: **Leaderboard** (scorecard content — daily/49, mission completion, combined total, streak, delta, INACTIVE badge for canceled-within-win-back; each row shows the brother's avatar via `<UserAvatar size="sm">` and a compact speech-bubble message icon that deep-links to the existing thread or `/messages/with/[userId]` — own row shows a blank spacer, no self-message) and **People** (see §6 People directory; MESSAGE button uses the same speech-bubble icon for visual consistency). Multi-community members see rosters from every community they're in, deduped by user_id, with all community names listed in the header. |
| `/community/leaderboard` | `src/app/(app)/community/leaderboard/page.tsx` | Tabs: Weekly, Monthly (4-week rolling), Streaks. Top 3 get a medal treatment. |
| `/dashboard` (aka "My Braveman") | `src/app/(app)/dashboard/page.tsx` | Personal dashboard. Top card: streaming **Weekly Summary** (`weekly-summary-card.tsx`) — grace-period-gated, three sections ({ highlight, what_worked, opportunity }), typewriter reveal on first generation, static on subsequent loads. Pillar Consistency chart (`pillar-progress-chart.tsx`) replaces the older grouped bar chart — brand-colored progress bars per pillar, denominator = days elapsed in quarter, last-quarter overlay tick + delta pill, sorted strongest → weakest, Action pillar dropped (derived from missions). Old "Daily Living trend" card removed — the weekly summary now carries the trend narrative. |
| `/messages` | `src/app/(app)/messages/page.tsx` + `layout.tsx` | Inbox. Two-pane on desktop (thread list left, message pane right); stacked on mobile. Root `page.tsx` renders empty right-pane state; layout owns the inbox rail. |
| `/messages/[threadId]` | `src/app/(app)/messages/[threadId]/page.tsx` + `thread-view.tsx` | Server fetches messages + reactions for the thread; `ThreadView` client component owns realtime subscription per-thread, optimistic send, day-divider bubbles, 5 quick reactions (👍 ❤️ 💪 🔥 🙏), autofocus input. |
| `/messages/with/[userId]` | `src/app/(app)/messages/with/[userId]/page.tsx` | Server-side resolver: finds or creates a thread with `userId` (canonical pair, shared-community precheck), redirects into `/messages/[threadId]`. Used by the MESSAGE button on the People tab and elsewhere. |
| `/coach` | `src/app/(app)/coach/page.tsx` | Coach Larry hub — lists conversations, "new conversation" button (general or mission mode). Nav label is "Coach Larry"; card copy uses first-name personalization ("Talk to Larry"). |
| `/coach/[id]` | `src/app/(app)/coach/[id]/page.tsx` | Threaded conversation. Coach messages get a purple accent + Centurion mark avatar. Mission suggestion cards render inline with accept/reject. |
| `/me` | `src/app/(app)/me/page.tsx` | Profile: circular avatar (via `UserAvatar` component; initial fallback), name, email, city, partner summary, kids summary, latest survey composite + delta. Edit link → `/me/profile`. |
| `/me/profile` | `src/app/(app)/me/profile/page.tsx` | Dedicated post-onboarding profile edit: first/last name, city, cell phone, avatar (reuses `AvatarCropper` from onboarding). Own server action (`saveProfileEdit`) skips `bumpStep` and redirects back to `/me`. |
| `/me/partner` | `src/app/(app)/me/partner/page.tsx` | Full partner profile edit. |
| `/me/kids` | `src/app/(app)/me/kids/page.tsx` | Add / edit / delete kids. |
| `/me/survey` | `src/app/(app)/me/survey/page.tsx` | List of Partner Connection Surveys with composite + delta. |
| `/me/survey/[id]` | `src/app/(app)/me/survey/[id]/page.tsx` | Read-only view of a completed survey. |
| `/me/survey/take` | `src/app/(app)/me/survey/take/page.tsx` | Take a new survey — 15 questions, score 1–5 + partner's verbatim note per question. |
| `/design` | `src/app/design/page.tsx` | Component library. Public in dev; requires `ALLOW_DESIGN_ROUTE=1` in production. |

### 3.4 Community leader (route group `(leader)`)
| Path | Purpose |
|------|---------|
| `/leader` | Dashboard: active count, disengaged buckets (3/7/14+ days), avg weekly Daily Living (/49), mission completion rate. |
| `/leader/members` | Member status table with invite / deactivate actions. |
| `/leader/disengagement` | Members bucketed by inactivity with contextual nudge copy and send-nudge action. |
| `/leader/nudges` | Configure daily reminder time and disengagement ladder thresholds. |
| `/leader/corrections` | Edit past check-ins after a week has locked; writes to `score_corrections` with reason. |

### 3.5 Platform admin (route group `(admin)`)
| Path | Purpose |
|------|---------|
| `/admin` | Platform overview: communities, active members, this week's check-ins, disengagement. |
| `/admin/communities` | List + create community (name, slug, timezone, week lock days, accent color). |
| `/admin/communities/[id]` | Edit community settings and roster; deactivate / reactivate members. |
| `/admin/users` | User list with subscription status. Universal checkboxes drive two batch actions: SEND INVITES (BATCH) (fires activation via Resend) and DELETE SELECTED (opens modal requiring typed "DELETE" confirmation). New Account form creates auth + public user in one step with optional platform-admin checkbox and an **"Admin only"** checkbox (community selector becomes optional; server refuses admin-only without platform-admin). All buttons use the shared `<SubmitButton>` with pending state (spinner + disabled + swapped label). |
| `/admin/users/[id]` | Edit a user: subscription status, platform-admin toggle, `itc_access` toggle, **admin-only toggle** (`setAdminOnly` force-sets `is_platform_admin=true` alongside), single-user Send Invite, and a Danger Zone panel with a hard-delete requiring typed email confirmation. **Memberships management** section: per active membership a role dropdown (Member/Leader) with save action + REMOVE button, plus an "Add to community" form (community dropdown that excludes ones the user is already in + role selector + ADD). Backed by `addMembership` / `removeMembership` / `setMembershipRole` server actions in `src/app/(admin)/admin/users/actions.ts`, all audit-logged. Audit-log entries surface below. |
| `/admin/disengagement` | Platform-wide disengagement view. Split into "Never activated" + "Inactive" sections (renamed from "Silent" on 2026-08-24). Inactive ranges: **21+ / 14-20 / 7-13 / 3-6 days inactive**. |
| `/admin/coach-flags` | Review queue for messages flagged by the safety classifier (severity ≥ medium, per 2026-08-27 update). Filterable by severity + status via `?severity=` + `?status=` query params. Notes + mark reviewed. |
| `/admin/audit` | Platform-wide audit log, searchable by actor / action / target. |
| `/admin/jobs` | Manual trigger for daily jobs with recent run history. **FORCE checkbox** next to Daily reminders + Mission-day nudges bypasses the time-of-day gate for testing. Includes `goal-midpoint-check` and `mark-goals-for-review` alongside the existing jobs. |
| `/admin/help-content` | Manages the help-content library (source manifests → DB rows). **REGEN ALL STALE** button appears when stale count > 0; recomputes `source_hash` across manifests + DB rows and regenerates every mismatched row in one click. |

### 3.6 API routes
Coach
- `POST /api/coach/messages` — send a user turn; runs safety classification (Haiku), builds context via the provider pipeline (see §6 Coach context pipeline), routes to Sonnet, validates any mission suggestion + one-shot retry on concreteness fail, scrubs em-dashes from the reply, persists both turns to `coach_messages` with context + safety metadata written to the assistant row, enqueues flags at severity ≥ medium. Returns `{ conversationId, userMessageId, assistantMessageId, reply, missionSuggestion, allowance, crisis }`. `allowance` shape: `{ used, softCap: 150, noticeThreshold: 120, hardCap: 300, remaining, bucket: 'ok'|'notice'|'over'|'block' }`.
- `POST /api/coach/accept-mission` — user accepts a coach-suggested mission. Validates concreteness, enforces weekly cap, creates a `missions` row with `created_by='coach_suggested'`.

Missions
- `POST /api/missions/quality` — server-side concreteness validator (mirrors client-side check for real-time UX).
- `GET /api/missions/examples?pillar=…` — returns exemplar missions promoted by leaders/admins for the given pillar.

Cron
- `GET /api/cron/daily` — orchestrator; runs in parallel: mark missed missions, week lock, disengagement scan, weekly digest, exemplar novelty. Auth via `CRON_SECRET` bearer.
- `GET /api/cron/hourly` — placeholder for TZ-precise streak recalculation.
- `GET /api/cron/run?job=…` — admin manual trigger.

### 3.7 ITC (Immunity to Change) coaching
| Path | File | Purpose |
|------|------|---------|
| `/itc` | `src/app/itc/page.tsx` | Landing. In-page header carries (admin-only) "Admin" + "Sign out"; the "← Dad Edge OS" back-to-main-app affordance lives one layer up in the shared `ItcTopBar`. If the coachee has exactly one in-progress map, first-login silently redirects to `/itc/{mapId}`. Start-new-map section hidden when any in-progress map exists (one-active-map rule). |
| `/itc/[mapId]` | `src/app/itc/[mapId]/page.tsx` | Full-width single-column ITC canvas. Sticky in-page header carries "← Maps", (admin) "Admin", Reset, Sign out. Above it, the layout-level `ItcTopBar` provides the "← Dad Edge OS" exit. Stage-by-stage sections (goal → behaviors → worries → commitments → assumptions → immune-system walkthrough → prioritize → test-design → test-running → results → done). Each active section owns its own form; the coach's output renders inline in one of six surfaces (stage note, entry thread, column review, focus, dock, hone diagnostic). Above the immune-system walkthrough: side-by-side "Improvement Goal vs Competing Commitments" diagram with opposing arrows + "Working against each other" caption. A "Hone this map" button in the canvas triggers an on-demand whole-map audit that persists as a dismissible amber banner at the top. End-of-column reviews render inline above the Continue button once a column has enough entries. A floating "Ask the coach" dock in the bottom-right is a free-form back-channel. |
| `/itc/no-access` | `src/app/itc/no-access/page.tsx` | Friendly deny page for signed-in main-app users without `itc_access`. "Not for you yet" copy + links back to `/today` and `/me`. Not a 404. |
| `/itc/admin` | `src/app/itc/admin/page.tsx` | Coach-facing map index (admins only). Triage view sorted by health signal (stuck > overdue_test > idle > stalling > ok) with counts summary; display-only, no messaging. Lists in-progress maps only by default; completed maps hidden to keep the watchlist tight. |
| `/itc/admin/[mapId]` | `src/app/itc/admin/[mapId]/page.tsx` | Per-map viewer with full transcript + turn events (`itc_turn_events`) for coach debugging. Includes a Tests (N) section under Big Assumptions with each test's assumption tag (A1/A2/A3), type, status, target date, verdict (if run), all four Kegan/Lahey fields, and result fields when a result exists. |
| `/itc/login` | `src/app/itc/login/page.tsx` | Legacy email-only session for coachees who haven't been migrated. If the entered email matches a user with `itc_access=true`, redirects to `/login` with an "Your account has been upgraded" banner and a "Go to the main login" button. Retained as a soft-landing during migration; ITC_DEMO_AUTH flag still enabled. |
| `/itc/logout` | `src/app/itc/logout/route.ts` | POST-only. Clears the legacy ITC session cookie, redirects to `/itc/login`. Note: does NOT sign out the main-app Supabase session — main-app sign-out is separate (via `/logout`). |

**Session resolution (`src/lib/itc/session-guards.ts::requireItcParticipant`):**
1. Main-app path: if a Supabase session exists AND `users.itc_access=true`, upsert the participant row by email and return it. If `onboarding_step < ONBOARDING_STEPS_TOTAL` and the user isn't a platform admin, redirect to the appropriate onboarding step first. If the session exists but `itc_access=false`, redirect to `/itc/no-access`.
2. Legacy path: fall back to the ITC session cookie (`readItcSession`). If neither resolves, redirect to `/login?next=/itc`.

**ITC ↔ main-app navigation (added 2026-08-26).** ITC is treated as a focused workspace, not a nav destination — deliberately kept lightweight rather than sharing the full main-app shell. Two connection points:
- **In:** `/goals` (for `itc_access=true` users) shows the "Improvement goal" section. Map in progress → `AdaptiveGoalCard` links into `/itc/[mapId]`. No map → `NoImprovementMapCard` CTA with a primary START button that lands on `/itc`.
- **Out:** Every `/itc/*` page carries the `ItcTopBar` (in `src/app/itc/itc-top-bar.tsx`, wired via `src/app/itc/layout.tsx`). Slim top strip with the Dad Edge mark + "← DAD EDGE OS" text linking to `/goals` (not `/today` — goals is where the improvement map surfaces in the main app, so the mental model holds). Deliberately excludes the notification bell, messages icon, and avatar menu that live on the main-app `AppHeader` — an interruption badge during a "hidden competing commitment" moment is exactly the friction the workspace framing exists to prevent. The coachee sees new activity when they exit.

**One active map per participant:** enforced at the DB layer (`unique (participant_id) where status='in_progress'`, migration `20260828000001`) and at the app layer (`/itc` landing hides the start-new-map form when an in-progress map exists). Migration cleaned up any pre-existing multi-map coachees by keeping the most-recently-updated in-progress map and moving older ones to `complete`.

**ITC migration script:** `npm run migrate:itc -- --dry-run | --apply` (`scripts/migrate-itc-participants.ts`). Links `itc_participants` rows to `users` rows by email match, sets `itc_access=true` on matched user rows, and populates `itc_maps.user_id`. Unmatched participants are reported so the admin can create accounts manually via `/admin/users` before re-running. Uses raw fetch against PostgREST (bypasses supabase-js JWT time validation).

---

## 4. Data Model

Migrations live in `supabase/migrations/`. Schema highlights below.

### Core
- **`users`** — id (PK, mirrors `auth.users.id`), email (unique), first/last name, phone, timezone (default `America/Chicago`), `is_platform_admin`, `is_admin_only` (backstage-only admin; CHECK `users_admin_only_requires_platform_admin` forces `is_platform_admin=true` when true), `itc_access` (per-user flag granting `/itc` access; set by migration script or admin toggle), `invited_at` (stamped when Send Invite fires), `subscription_status` (`trialing` / `active` / `past_due` / `canceled` / `comped`), `subscription_source` (`manual` / `stripe`), `stripe_customer_id`, `canceled_at`, `onboarding_step` (0–6 with current flow), `why_yes`, `occupation`, `employment_type`, `avatar_url` (cache-busted public URL from `avatars` bucket), `city`. Auto-populated by `handle_new_auth_user()` trigger on `auth.users` insert.
- **`communities`** — name, unique slug, accent color, timezone, `leaderboard_enabled`, `missions_visible`, status (`active` / `archived`), `week_lock_days` (default 3).
- **`memberships`** — one row per (user, community). Role (`member` / `leader`), status (`active` / `inactive` / `removed`), `joined_at`, `deactivated_at`, `canceled_visible_until` (= `deactivated_at + 30 days`). **Platform admins are auto-provisioned as `leader` in every community** via triggers `communities_grant_admins` (fires on community insert) and `users_grant_admin_communities` (fires when `is_platform_admin` flips true on insert or update). Backfill runs at migration time (`20260824000002`) for existing state. Idempotent via `on conflict (user_id, community_id) do nothing`.
- **`weeks`** — per community, Monday `start_date`, `is_intensive`, `locked_at`. Unique (community, start_date).
- **`pillar_framework_versions`** — versioned JSONB definition of pillars + `weekly_max`.
- **`daily_checkins`** — one row per (user, date, pillar). `value` is `0` or `1`. Absence of a row is meaningfully different from `value=0`.
- **`quarterly_goals`** — user + quarter_start + focus_area (pillar) + `desired_end_state` (renamed from `description` in migration `20260826000002`; both user and ITC goals use this column) + `current_state` (start line, user goals only) + `source` (`user`/`itc`, from migration `20260826000001`) + `status` (`active`/`completed`/`abandoned`/`needs_review`) + `midpoint_check_at` + `midpoint_check_answer` + `retrospective_what_happened` + `retrospective_what_learned`. DB trigger `enforce_active_goals_cap_trg` enforces a split cap: 2 user-authored active goals + 1 ITC-mirrored (3 total) per user per quarter. See §6 for the review flow that transitions goals into `needs_review`.
- **`missions`** — user, community, optional `quarterly_goal_id`, description (≥ 8 chars, DB CHECK), pillar, `target_date`, `target_dates date[] not null` (multi-day support added 2026-08-31 in migration `20260831000006_missions_target_dates.sql`; GIN indexed; `target_date` mirrors `max(target_dates)` for backwards compat with jobs/views), status (`planned` / `completed` / `missed` / `rolled_over`), `rolled_over_from_mission_id`, `created_by` (`user` / `coach_suggested`), `completed_at`, `completed_late`, `legacy_import`, `is_exemplar`. One COMPLETE tick still closes the mission regardless of how many days it targeted. Trigger `enforce_mission_weekly_cap_trg` enforces cap of 15/week total, 5/goal-bucket, 5/other; rolled-over missions excluded from count.
- **`daily_reflections`** — one row per (user, date) with optional `wins` + `learnings`. Self-only RLS; coach reads via service role.

### Notifications (migration `20260824000004`)
- **`notifications`** — `user_id → users(id)`, `kind text`, `title text`, `body text nullable`, `deep_link text`, `target_type text nullable`, `target_id uuid nullable`, `dedup_key text`, `metadata jsonb`, `created_at`, `read_at nullable`.
- **Unique** `(user_id, kind, dedup_key)` — writers use `ON CONFLICT DO NOTHING` for idempotency (same kind fires many times per day across communities without duplicating rows for the user).
- **Indexes:** `(user_id, created_at desc)` powers the dropdown; partial `(user_id) WHERE read_at IS NULL` powers the unread badge count.
- **RLS:** user reads their own; user updates their own (used only to stamp `read_at`).

### Weekly summaries (migration `20260825000001`)
- **`weekly_summaries`** — PK `(user_id, week_start)`, `body jsonb` (shape `{ highlight, what_worked, opportunity }`), `model text`, `generated_at`.
- **RLS:** read own. Insert/update via service role (`onFinish` of the stream).

### Messaging (migration `20260825000002`)
- **`message_threads`** — `(participant_a, participant_b)` unique + CHECK `a < b` (canonical ordering — thread lookups always sort the pair) + CHECK `a <> b` (no self-threads). `last_message_at timestamptz` denormalized so inbox sort doesn't need a join. Created via `findOrCreateThread` which also enforces the shared-community precheck.
- **`messages`** — `thread_id`, `sender_id`, `body text` (CHECK length 1..4000), `read_at` (recipient stamps on view), `created_at`. Immutable content after insert.
- **`message_reactions`** — PK `(message_id, user_id)`, `emoji text`. One emoji per user per message (toggle replaces).
- **RLS:**
  - Threads: readable if participant. Insert allowed only if caller is a participant AND both participants share ≥1 active community membership. Once created, further messages don't re-check the shared-community gate (Slack "left the group" semantics).
  - Messages: read if participant. Insert if `sender_id = auth.uid()` and caller participates. Update `read_at` only if caller is the recipient (never the sender).
  - Reactions: read if participant. Insert/delete own only.
- **Realtime:** `messages`, `message_reactions`, `message_threads` added to `supabase_realtime` publication.
- **Excluded (never):** group chats, attachments, coach visibility. **Excluded from v1:** reporting/blocking, typing indicators.

### Family layer (self-only RLS everywhere)
- **`partner_profiles`** — unique per user. Name, relationship_label enum, partner_birthdate, relationship_date, `things_loved` TEXT[].
- **`children`** — user, name, birthdate, `things_loved` TEXT[].
- **`survey_question_sets`** — versioned; v1 seeded with 15 questions.
- **`survey_questions`** — set + sort_order + text.
- **`partner_surveys`** — user, question_set_id, taken_at, context_note.
- **`partner_survey_responses`** — survey + question, score (1–5, CHECK), optional note (partner's verbatim words).

### Coach
- **`coach_conversations`** — user, mode (`general` / `mission`), started_at, last_message_at, auto-generated title, reserved summary fields, `archived_at`.
- **`coach_messages`** — conversation, role (`user` / `assistant` / `system`), content, `model_used`, `tokens_in`, `tokens_out`, `flagged`, `flag_reason`, `metadata` (JSONB from migration `20260827000001`). Metadata is populated only on assistant turns; shape: `{ context: { providers: string[], tokenEstimate: number }, safety: { severity, categories } }`. Purpose: the "what did the coach know when it said that" audit trail reviewable from `/admin/coach-flags` (same purpose `itc_turn_events` serves for the ITC coach).
- **`coach_flags_queue`** — message ref, severity, status (`open` / `reviewed`), reviewed_by, notes. Admin-only RLS (per DECISION #6). Enqueue threshold widened from `high`+ to `medium`+ on 2026-08-27.

### Admin & audit
- **`score_corrections`** — audit trail for post-lock check-in edits. admin, target user, date, pillar, old/new value, reason.
- **`audit_log`** — actor, action, target_type, target_id, metadata (JSONB). Captures admin view-as-member, data corrections, community/user changes, coach flag reviews.
- **`nudge_settings`** — per community. `daily_reminder_time` (default 18:00), `disengagement_ladder` JSONB (`{"day3":true,"day7":true,"day14":true}`).
- **`digests`** — one row per (community, week_start). JSONB body with rankings + mission analysis + deltas.
- **`invites`** — legacy table from the pre-auth-phase magic-link flow. Retained for historical records but not written to by any current code path. Can be dropped via a future migration when comfortable losing the history.

### Row Level Security
- Member data (checkins, missions, goals) scoped to self + community-mates (active + canceled-within-win-back).
- Family layer + coach data + reflections: self-only. Coach reads via service role for context.
- Coach flag queue, audit log, score corrections: platform admin only.
- Helpers: `shares_active_community()`, `is_leader_of_target()`, `is_platform_admin()`, `is_leader_of_community()`, `users_share_active_community()`.
- Consolidated in `supabase/migrations/20260713000006_row_level_security.sql`.

**Policy authoring rule — when to use `SECURITY DEFINER` (audit 2026-08-26).**

Any RLS policy on table `X` whose `USING` / `WITH CHECK` uses an inline `EXISTS (SELECT ... FROM Y ...)` against an RLS-enabled `Y` must first check whether the check depends on rows the *caller* can see under `Y`'s own RLS.

- **Safe as an inline subquery:**
  - SELECT-only policies (worst case is the caller sees fewer rows).
  - Self-referencing checks — the subquery only needs the caller's own row on `Y` (e.g. "the caller is a leader of this community", "the caller is a participant of this thread"), which they always see via `user_id = auth.uid()` or equivalent.
- **Requires a `SECURITY DEFINER` helper** (or the check will silently fail or leak):
  - INSERT / UPDATE / DELETE policies where the check needs to verify a fact about *another* user's rows on `Y` (e.g. "these two users share an active community"). The other user's rows are hidden from the caller by `Y`'s RLS, so the inline subquery returns nothing regardless of the underlying fact.

This rule was learned the hard way from the `message_threads_insert_shared_community` leak (fixed in `supabase/migrations/20260828000002_fix_messaging_cross_community_leak.sql`). The audit found no other instances of the anti-pattern in the schema. `SECURITY DEFINER` helpers already exist for every established cross-user check; add one when introducing a new one rather than inlining.

### Storage
- **`avatars`** bucket (public read, authenticated write-to-own-folder). Path convention: `{user_id}/profile.{jpg|png}`. RLS policies enforce that a user can only insert/update/delete objects where `storage.foldername(name)[1] = auth.uid()::text`. Uploads for the onboarding + `/me/profile` flows go through the service client (server action decodes the base64 data URL from the client cropper and uploads directly) so the RLS is defense-in-depth rather than the primary gate. Cache-busted public URL (`?v=<timestamp>`) is stored in `users.avatar_url` so browsers pick up new avatars without stale-URL confusion.

---

## 5. Authentication & Access

**Sign-in.** Email + password via Supabase Auth. Public sign-up is off. Accounts are admin-created via `/admin/users` (creates the auth row with `email_confirm=true` and no password) then invited via Send Invite. Users click the emailed link, land on `/set-password`, choose a password, and get signed in. On password reset the user is signed out of every other active session (mitigates the "stolen device" case where the reset was compromise-driven).

**Roles.**
- **Member** — self data + community read + coach.
- **Community leader** — everything a member has, plus member deactivation / reactivation, nudge settings, past-week corrections, digest visibility. (Leader invite flow removed 2026-08-24 — leaders now ask an admin to add new members.)
- **Platform admin** — full access; coach flag review; audit log; manual cron triggers. Bypasses RLS with the service role for admin flows. Auto-provisioned as `leader` in every community (see §4 memberships).
- **ITC access** — orthogonal per-user flag (`users.itc_access`) granting `/itc` visibility. Set by the migration script for legacy ITC participants, or manually via the admin detail page toggle.

**Entitlement gate** — `canAccess(user)` in `src/lib/entitlement.ts`:
- `subscription_status ∈ {active, trialing, comped, past_due}` → `access: "full"`.
- `canceled` and `now - canceled_at < WIN_BACK_DAYS (30)` → `access: "read_only"`. User keeps history read + shows on scorecard with "INACTIVE" badge; write actions rejected.
- `canceled` past 30 days → `access: "none"`; redirected to `/inactive`.

**Session helpers** (`src/lib/session.ts`):
- `requireUser()` — auth check + redirect. Loads `SessionUser` including `avatar_url`, `city`, `phone`.
- `requireAccess()` — entitlement check + onboarding gate. Redirects incomplete non-admin users to `onboardingRouteFor(step)`. Returns `{ user, readOnly }`.
- `currentUserHasItcAccess()` — read-only helper for the post-onboarding/sign-in redirect decision.
- `requirePlatformAdmin()` — admin check + redirect.
- `resolveLeaderCommunity()` — community-scoping for `/leader/*`.

**ITC session guard** — `requireItcParticipant()` in `src/lib/itc/session-guards.ts`. Two-path resolver:
1. **Main-app path.** Read the Supabase session. If `users.itc_access=true`, upsert an `itc_participants` row for the email and return. If onboarding is incomplete for a non-admin, redirect to the wizard first. If the session exists but `itc_access=false`, redirect to `/itc/no-access`.
2. **Legacy path.** Fall back to the ITC session cookie (`readItcSession`) for coachees not yet migrated. Redirects to `/login?next=/itc` when neither resolves.

**Admin-only users.** `users.is_admin_only` (migration `20260825000003`) toggles a user into backstage-only mode. DB CHECK forces `is_platform_admin=true` when `is_admin_only=true`. Three valid states:

| `is_platform_admin` | `is_admin_only` | Effect |
|---|---|---|
| `false` | `false` | Coachee (default). |
| `true`  | `false` | Coachee + admin. Lands on `/today`, can visit `/admin/*`. |
| `true`  | `true`  | Backstage admin only. No coachee shell. |

Behavior:
- `requireAccess()` in `src/lib/session.ts` short-circuits to `/admin` when `is_admin_only`. Every coachee route redirects automatically.
- Sign-in landing (`src/app/login/actions.ts`) and marketing landing (`src/app/page.tsx`) both check `is_admin_only` first and route to `/admin`.
- New Account form gates the "Admin only" checkbox on the "platform admin" checkbox being on; server refuses admin-only-without-platform-admin. User detail page `setAdminOnly` action force-sets `is_platform_admin=true` alongside so the flag combination is always valid.

---

## 6. Business Logic & Scoring

### Weekly score (revised 2026-08-24)

Two independent numbers plus a combined total:

- **Daily** — sum of `daily_checkins.value=1` across the 7 manually-checkable pillars (B/R/A/V/E/M/N) × 7 days. Max 49 per week. Action (A2) is excluded from this count — Action credit comes from completed missions.
  - `src/lib/scoring/week.ts` → `dailyLivingWeekTotal()` (excludes A2 rows)
  - `DAILY_PILLARS_WEEKLY_MAX = 49`
- **Missions** — 1 point per completed mission (target_date in the week, status=`completed`). Denominator is total planned missions that week (any status; excludes future planned outside the week bounds).
  - `src/lib/scoring/week.ts` → `missionScore()` returns `{ completed, planned }`
- **Total** — `daily + completed_missions` out of `49 + planned_missions`.
- `/today` displays all three in the header. `/community` and `/community/leaderboard` display Daily + Missions and rank by Total.
- NULL check-in row ≠ 0 (logged but not done).

### Mission scoring
- `completed` on or before target_date → full credit (1 mission point).
- `completed` after target_date with `completed_late=true` → full credit + "Completed · late" badge.
- `missed` → 0 credit.
- `planned` in the future → not counted this week.
- Weekly on-time rate = `on_time_completed / total_completed`; kept for display only, not used in ranking.
- Action is no longer a per-day binary; each completed mission stacks a point uncapped-per-day (still capped by the 15/week mission cap).

### Leaderboard ranking (composite removed)
- **Ranking:** by `combined_total` desc; tiebreaker `daily_total`.
- **No composite score.** Deleted `src/lib/scoring/composite.ts` and `leaderboardComposite()` — two independent numbers beat one made-up 0-100 blend. The 70/30 split was arbitrary and mixed dissimilar things.
- `LeaderboardRow` displays `Daily N/49`, `Missions N/M`, and `Total N/(49+M)` (accent-colored). Prior-week delta is combined-total delta (not composite).
- `src/lib/scoring/leaderboard.ts` → `assembleWeekly()`.

### Engagement streak
- Consecutive days ending today with **any** check-in row (any value). Used on `/today`, leaderboard, Streaks tab.
- `src/lib/scoring/streaks.ts`.

### Week lock
- Daily cron marks a week's `locked_at` when `now - week.end_date >= community.week_lock_days` (default 3). Post-lock edits require the admin `score_corrections` flow.
- **Editable-day boundary.** `getEarliestEditableDate(userId)` in `src/lib/scoring/week.ts` returns the day after the most recent locked week across the user's active communities (Monday of the week after the latest `weeks.locked_at IS NOT NULL` start_date). Multi-community users get the most restrictive boundary. Falls back to the current week's Monday when nothing is locked. Drives the `/today` prev/next date navigator.

### Mission caps (DECISION #3 v2)
- 15 total per week, 5 per goal bucket, 5 for the unattached "other" bucket. Rolled-over missions excluded from count.
- Enforced by DB trigger `enforce_mission_weekly_cap()` **and** server action (dual gate). Hard cap — no exceptions.

### Quarterly goal cap (revised 2026-08-26)
- Split cap enforced by `enforce_active_goals_cap_trg`: 2 user-authored active goals + 1 ITC-mirrored (3 total) per user per quarter.
- `source='user'` inserts rejected at 2/2 user goals with a message; the third slot is reserved for a `source='itc'` goal.
- Application-layer mirroring: `/goals` disables the "add" form at 2/2 with explanatory copy so the coachee doesn't hit the DB trigger. `syncItcGoalToTracker` in `src/lib/itc/tracker-link.ts` writes `source='itc'`.

### Quarterly goal review flow (added 2026-08-26)
- **Calendar quarters** — canonical UTC quarters (Jan/Apr/Jul/Oct) via `src/lib/scoring/quarters.ts::getCurrentQuarter`. Single source of truth for `/missions` header countdown, `/goals` header, quarter-end cron, and dashboard goal-period bands.
- **Midpoint check-in** — `computeMidpointCheckAt(quarter_end, created_at)` at goal-create time: halfway between `created_at` and `quarter_end`, or `null` when `<MIDPOINT_MIN_RUNWAY_DAYS` (21) remain (skip). ITC goals leave it `null` (their map has its own cadence). Prompt renders on `/today` and `/goals` when `midpoint_check_at <= today` AND `midpoint_check_answer IS NULL`. Answering writes to `midpoint_check_answer`; the prompt stops firing.
- **Quarter-end retrospective** — `runMarkGoalsForReview` (daily cron) transitions active goals to `needs_review` when the quarter is within `REVIEW_LEAD_DAYS` (=7) of ending. Prior-quarter safety-net path also runs unconditionally. Retrospective prompt renders on `/today` and `/goals` when a `needs_review` goal exists. Coachee answers Yes / Partway / No plus two freeform fields (`retrospective_what_happened` + `retrospective_what_learned`). Yes/Partway → `completed`; No → `abandoned`. ITC-sourced needs_review goals render an "open the map" variant that points to the ITC done-stage flow instead of the retrospective fields.

### Win-back window (DECISION #4)
- 30 days after `canceled_at`. Shown on scorecard as "INACTIVE," read-only. After 30 days, hidden and redirected to `/inactive`. Constant `WIN_BACK_DAYS` in `src/lib/entitlement.ts`.

### Coach allowance (DECISION #5, revised 2026-08-27)
- Metering: user-turn message count in the current UTC month across all conversations. `src/lib/coach/allowance.ts::readAllowance`.
- Buckets:
  - `ok` (0-119): silent.
  - `notice` (120-149, 80% of soft cap): quiet indicator in the composer + on `/coach` — "You've used X of 150 coach messages this month."
  - `over` (150-299): explicit "Over your monthly allowance" notice, coach STILL responds. Spec is explicit that we never hard-block a man mid-conversation about his marriage.
  - `block` (300+): hard cap — runaway-spend safety net only, composer disables. Normal use never approaches this.
- Exposed on every `POST /api/coach/messages` response via the `allowance` field so the client can render the bucket-appropriate treatment inline.
- No billing consequence yet; Stripe integration is Phase 3.

### Coach context pipeline (added 2026-08-27)
- Provider pattern under `src/lib/coach/context/`. Each provider is one file that returns a `{ label, text, tokenEstimate }` block (or null when it has nothing). Adding a new context source is: write the file, append to `registry.ts`. No changes to the assembler, no prompt changes, no other provider changes. Extensibility is the whole point; a load-bearing test in `tests/coach/context.test.ts` proves the pattern with a throwaway provider.
- 8 shipped providers: `identity`, `family`, `survey` (cacheable — change on the order of weeks); `streaks`, `goals`, `missions`, `reflections`, `itc` (volatile — change daily; ITC provider is null unless the user has a linked participant with an in-progress map).
- Assembler emits two strings: `cacheablePrefix` (identity + family + survey) and `volatileBody` (everything else). `send-message.ts` places the cacheable prefix immediately after the persona/method prompt and before the volatile body so Anthropic's automatic stable-prefix caching catches the largest shared byte range across turns without needing explicit cache_control breakpoints.
- Provider keys + combined token estimate + safety classification for the user turn are written to `coach_messages.metadata` on every assistant turn — reviewable from `/admin/coach-flags`.

### Coach voice bundle (added 2026-08-27)
- Main coach loads TWO docs via `src/lib/coach/voice-rules.ts`:
  - `docs/coach-voice-and-tone.md` — shared voice/tone rules also loaded by the ITC coach.
  - `docs/main-coach-ai-patterns.md` — stricter AI-pattern bans that apply ONLY to the main coach's open conversational surface (manufactured "It's not X, it's Y" reversals, dramatic acknowledgment openers, stacked fragment-for-emphasis, tricolon, anaphora, hedge-then-pivot, signature AI vocabulary, empty intensifiers, empathy preamble, mirrored conclusion, em-dash addiction).
- ITC coach loads only the shared doc via `src/lib/itc/prompts/preamble.ts`. Its voice is calibrated and working; the stricter rules would over-constrain a scoped surface for no gain.
- Defensive em-dash / en-dash / double-hyphen strip on main-coach output via `src/lib/coach/scrub-reply.ts`, applied in `send-message.ts` before persist + return. Belt-and-suspenders for the punctuation ban.

### Notification kinds + dedup
- Writers insert with `ON CONFLICT (user_id, kind, dedup_key) DO NOTHING`; every kind has its own dedup key semantics so re-runs and multi-community fan-out don't multiply rows.
- Kinds:

| Kind | Emitter | Dedup key | Cadence |
|------|---------|-----------|---------|
| `daily_reminder`   | `src/lib/jobs/daily-reminders.ts` cron | `YYYY-MM-DD` local date | One per user per day (alongside existing email). |
| `week_lock`        | `src/lib/jobs/week-lock.ts` cron | `week_start` of the locking week | One per user, 2 days before lock. Deduped across communities via in-memory Set. |
| `weekly_digest`    | `src/lib/jobs/digest.ts` | `community_id + week_start` | One per leader per community — leaders of N communities intentionally get N. |
| `quarter_closing`  | `src/lib/jobs/mark-goals-for-review.ts` | `goal_id` | Fires when a goal flips to `needs_review`. |
| `goal_midpoint`    | `src/lib/jobs/goal-midpoint-check.ts` (nightly, new) | `goal_id` | One per goal whose `midpoint_check_at <= today` and `midpoint_check_answer IS NULL`. |

- **Bell UI** (`src/components/shell/notification-bell.tsx`): icon in the app header (right of avatar), unread count badge (max `"9+"`), dropdown with last 20 rows, MARK ALL READ, row click → follow `deep_link` + mark read via `src/lib/notifications/actions.ts`.
- **Voice:** titles are terse per `docs/coach-voice-and-tone.md` — "Log today.", "Week locks Friday.", "Wrap this goal."
- **Cron dedup (2026-08-24):** `daily-reminders`, `week-lock`, `disengagement-scan` all dedupe email + notifications per user_id across communities via in-memory Set. Digest is intentionally still per-community.

### Weekly summary flow (`/dashboard` top card)
State machine in `src/lib/weekly-summary/state.ts` returns one of `ready | generating | not_yet | no_activity`:
1. **Grace-period gate.** `not_yet` until last week's Sunday + `earliest(week_lock_days)` across the user's memberships. Prevents generating a recap before the week has settled for at least one of the user's communities.
2. **Zero-activity check.** If the user had zero check-ins in the target week → `no_activity` (skip generation entirely, card renders a light empty state).
3. **Persisted row.** If a `weekly_summaries` row exists → `ready` (static render).
4. Otherwise → `generating` (stream on card mount).

**Streaming API:** `POST /api/summary/weekly/stream` with `weekStart` body. Server **re-resolves state** (never trusts the client) to prevent replay-triggered regeneration. Gathers 7 days of check-ins per pillar, missions planned vs completed, `daily_reflections`, active goals. Calls `streamText` from AI SDK against Claude with structured `[HIGHLIGHT] / [WHAT WORKED] / [OPPORTUNITY]` markers baked into the prompt. `onFinish` parses on the delimiters and persists `{ highlight, what_worked, opportunity }` to `weekly_summaries`.

**Client card** (`src/app/(app)/dashboard/cards/weekly-summary-card.tsx`) splits the incoming text on the markers as it arrives → typewriter reveal per section with a blinking cursor at the tail. Static section-by-section render on subsequent loads.

**Voice rules baked into the prompt:** no em-dashes, no "read" as a noun, positively framed but honest, opportunity-oriented forward-facing close.

**Failure handling:** the state resolver is wrapped in try/catch — DB failure returns `null` and the card hides silently so the dashboard stays alive. Stream fetch failure renders a compact "Recap couldn't generate. TRY AGAIN" state on the card.

### Community messaging boundary rule
- Threads can only be created between users who share ≥1 **active** community membership at the moment of thread creation (`findOrCreateThread` in `src/lib/messages/threads.ts` does the precheck and returns a plain-English error string when the pair doesn't qualify).
- Once a thread exists, subsequent messages never re-check the shared-community gate — mirrors Slack's "left the group" semantics. A member who is later removed from every shared community can still exchange messages in existing threads.
- Reactions: 5 quick picks only (👍 ❤️ 💪 🔥 🙏). Emoji picker not shipped.
- No group chats, attachments, or coach visibility (never). No reporting/blocking or typing indicators in v1.

### People directory (rolling 6-week window)
- Server aggregates per member in `src/lib/community/people-directory.ts`; consumed by `src/app/(app)/community/people-tab.tsx`.
- **`dailyLivingAvg`** = check-ins over the last 6 weeks ÷ `min(6, tenureWeeks)` — tenure-normalized so new members aren't punished for not having 6 weeks of history.
- **`missionPct`** = completed / planned over the last 6 weeks (`null` when the member had no planned missions in-window).
- **`streak`** = current engagement streak (same calc as `/today`).
- **Top-3 pips per metric** — gold / silver / bronze pip on the top three members in each of Activity / Streak / Missions.
- **Card layout:** `<UserAvatar>`, name + role tag, city + tenure line ("3 weeks in" for new members), pillar-colored goal chips (max 3), metric strip, MESSAGE button (routes to `/messages/with/[userId]`).
- **Client controls:** search box + sort dropdown (activity / streak / missions / newest / A→Z).
- **Multi-community handling:** rosters union across every community the viewer is in, deduped by user_id, all community names listed in the header. Rare — no picker.

### Concreteness validator (`src/lib/validation/mission.ts`)
1. Description length ≥ 8 chars.
2. Target date must be an ISO `YYYY-MM-DD` real date.
3. Description must not match vague-only patterns ("be more present", "improve", "be less…", "focus on…", "get better", "show up", "intentional", "mindful").

Verb allowlist removed 2026-08-31 — the pattern was too aggressive (rejected legitimate missions that started with domain-specific verbs the list didn't know about), and mission-quality LLM scoring covers concreteness far better than a hard-coded stopword list.

Applied client-side for real-time UX and server-side (server action + `/api/missions/quality` + DB CHECK) as the source of truth. Missions authored by the ITC coach (`created_by='itc'`) pass `bypassConcreteness: true`; length + real-date checks still apply.

### Mission quality scoring (`src/lib/coach/mission-quality.ts`)
Five criteria (0/1/2 each, sum out of 10): `concrete`, `binary`, `leverage`, `aligned`, `time_bound`. **`time_bound` reads the `target_date` field directly** — score 2 when set, 0 when missing. Does not parse the description for dates ("on Wednesday" doesn't affect the score if `target_date` is set). This lets the composer surface a clean quality pill (10/10 / 6/10 / 3/10) without penalizing missions where the date lives in the picker rather than the sentence.

### Disengagement classification
- Buckets by last check-in date: 3 / 7 / 14 / 14+ days inactive. `src/lib/scoring/disengagement.ts`.
- Copy escalates: gentle at day 3, direct at day 7, leader notification at day 14.

---

## 7. User Flows

### New member onboarding
Admin creates account via `/admin/users` → admin hits Send Invite (branded Resend activation email from `dadedgeoperatingsystem.com`) → user clicks link → `/set-password` → sets password + gets signed in → wizard: identity → profile (avatar + city + phone) → why → optional partner → optional kids → first check-in → land on `/today` (or `/itc` if `itc_access=true`, or `/today` if admin regardless).

### Daily check-in
Open `/today` → see week total + streak → tap each pillar (cycle null → 1 → 0 → null) with optimistic UI → optionally fill Wins/Learnings for the coach.

### Mission workflow
Open `/missions` (weekly planner slot grid — `weekly-planner.tsx`). Every quarterly goal shows 5 slots beneath it; a separate BRAVE MAN MISSIONS section carries 5 slots for unattached missions. Column headers: MISSION | DAY YOU'LL DO IT | COACH. Empty slots render as "+ ADD MISSION" placeholders. Fill in the description, pick one or more days on the M/T/W/T/F/S/S multi-select day picker (multi-day missions via `target_dates` array), autosave fires on blur. Enter saves, Shift+Enter inserts a newline, textarea auto-resizes to fit. Concreteness validator gates each save; caps stay at 15/week (5/bucket, 5/other). Quality pill shows the score (10/10 / 6/10 / 3/10); click expands the coach feedback panel. Row actions (right side, fixed sub-slots so alignment holds across states): **COMPLETE** — one tick regardless of day count; opens a themed confirmation because the mission goes fully read-only (no edits to description, days, or score after). **→ NEXT WEEK** — duplicates the mission +7 days preserving the multi-day pattern; source row stays intact; button relabels to `✓ CARRIED` and disables once a carry-forward child exists. **×** — delete (hover-reveal). Contributes 1 point to the weekly mission total when completed on or before the deadline.

### Coach conversation
Start conversation from `/coach` (general or mission mode) → user types → Haiku safety classification → context builder pulls 4-week history + streaks + missions + goals + family layer + reflections → router picks Sonnet or Haiku → reply streams back with optional mission suggestion card → accept creates a mission → both turns persisted → flagged messages go to admin queue → allowance ticks down.

### Partner Connection Survey
Open `/me/survey` → start new survey → sit with partner → for each of 15 questions record her score (1–5) and verbatim note → save → delta computed vs. prior survey → coach reads latest survey + delta as context.

### Community leaderboard
`/community` scorecard shows all active members (plus canceled-within-win-back with badge). `/community/leaderboard` ranks by combined weekly total (Weekly), 4-week combined total (Monthly), or raw streak (Streaks). Tiebreaker on Daily total. Top 3 get medal UI; delta vs. prior week is combined-total delta.

### Leader disengagement
`/leader/disengagement` shows 3/7/14+ day buckets with pre-filled nudge copy → send nudge (email in Phase 2+, console in Phase 1) → day 14 escalates to leader outreach.

### Admin community setup
`/admin/communities` → create community → `/admin/users` CREATE ACCOUNT (assigns to community) → SEND INVITE → member sets password + goes through onboarding wizard.

### Messaging
Open `/messages` or hit the MESSAGE button on a People-tab card → server resolves the canonical pair (`a < b`) → `findOrCreateThread` runs the shared-active-community precheck → new thread inserted or existing one reused → redirect to `/messages/[threadId]` → `ThreadView` subscribes to realtime for that thread → sender types → optimistic bubble appears → server insert → recipient sees it live and stamps `read_at` on view. Reactions: tap one of the 5 quick emoji, `toggleReaction` server action inserts or deletes. Header bell + Messages nav item show unread thread counts and refetch via realtime subscription on new messages.

### Weekly summary
Land on `/dashboard` → state resolver runs → if within grace period, card renders "not yet" empty state; if zero check-ins that week, renders "no activity" state; if a persisted row exists, static render; otherwise card mounts, POSTs to `/api/summary/weekly/stream`, and streams `[HIGHLIGHT] / [WHAT WORKED] / [OPPORTUNITY]` sections with typewriter reveal. `onFinish` persists to `weekly_summaries`; subsequent loads are static. Stream failure → compact "TRY AGAIN" state; state-resolver failure → card hides silently.

---

## 8. Integrations

**Supabase** — DB + Auth + RLS + (reserved) realtime. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Three clients: browser (`src/lib/supabase/browser.ts`), server request-scoped (`src/lib/supabase/server.ts`), service-role (`src/lib/supabase/service.ts`); middleware refreshes session per request.

**Anthropic Claude** — Sonnet for substantive coach turns; Haiku for routing, safety classification, nudge copy, digest summarization. Prompt caching used for stable context across turns. Env: `ANTHROPIC_API_KEY`. Files: `src/lib/coach/{client,prompts,safety,send-message}.ts`.

**Resend** — Stage B live. Sends activation invites, password resets, reminders, nudges, disengagement ladder, weekly digests through the verified `dadedgeoperatingsystem.com` domain. Gated on `EMAIL_STAGE=B` + non-empty `RESEND_API_KEY`; falls back to Supabase's default sender otherwise (dev / misconfig safety net). Detailed error responses (including Resend response body on 4xx/5xx) logged via `[email:send]` and `[admin] batch invite failed` prefixes. Env: `RESEND_API_KEY`, `RESEND_FROM`, `EMAIL_STAGE`. `src/lib/email.ts` + `src/lib/copy/auth-emails.ts`. Go-live checklist: `docs/email-setup-checklist.md`.

**Stripe** — Phase 3. Not yet integrated; subscription status is set manually via `/admin/users/[id]`. Planned webhooks: `customer.subscription.updated/deleted`, `invoice.payment_failed`. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Vercel Cron** — hits `/api/cron/daily` with `CRON_SECRET` bearer. `vercel.json` holds the schedule.

**PostHog + Sentry** — configured, not yet active.

---

## 9. Scripts

- `npm run seed` (`scripts/seed.ts`) — idempotent seed of one community ("The Basecamp", slug `basecamp`, `America/Chicago`) with 6 members (distinct behavior profiles: grinder, steady, cyclic, slipping, returning), Steve W as leader, 28 days of check-ins, one quarterly goal per member, one mission template per pillar.
- `npm run seed:boardroom` (`scripts/seed-boardroom.ts`) — stub for Boardroom-specific seed.
- `npm run brand:sync` (`scripts/sync-brand-assets.ts`) — reserved for auto-syncing brand assets to `/public/brand/`.
- `npm run migrate:itc` (`scripts/migrate-itc-participants.ts`) — `--dry-run` / `--apply` modes. Links `itc_participants` to `users` by email (case-insensitive), sets `itc_access=true` on matched user rows, populates `itc_maps.user_id`. Unmatched participants reported for manual account creation. Idempotent; safe to re-run.
- `npm run reset:onboarding` (`scripts/reset-onboarding.ts`) — `--dry-run` / `--apply` modes. Resets `onboarding_step` on existing users so they re-see newly-added wizard steps. `--email <addr>` targets a single user; `--step <N>` overrides the default (1, the new profile step); `--include-admins` overrides the default admin skip. Only moves users forward-to-backward — never pushes mid-flow users past what they were doing.
- `npm run backfill:itc-goals` (`scripts/backfill-itc-quarterly-goals.ts`) — `--apply` writes; default is dry-run. Mirrors ITC map goals into `quarterly_goals` for maps whose link never got created (goal saved before the participant → user bridge existed, or before `syncItcGoalToTracker` shipped). Idempotent via `WHERE quarterly_goal_id IS NULL`. Pairs with the `/goals` multi-lookup fallback that also finds the map by `participant_id` at render time.
- `npm run help:extract` / `npm run help:generate` / `npm run help:check-stale` (`scripts/help/`) — Help System pipeline for `/admin/help-content`. `extract-routes.ts` walks the app tree and produces per-route manifests (elements + roles) with a stable `source_hash`. `generate-content.ts` calls Haiku against each manifest (grounded in the manifest elements + this spec's route purpose + `docs/app-voice-adaptation.md`) and writes `help_content` rows with `reviewed=false`. `check-staleness.ts` re-extracts, diffs `source_hash`, and writes `docs/help-content-stale.md` — reports only, never silently overwrites reviewed content. `/admin/help-content` REGEN ALL STALE fires the same detect + regenerate loop from the browser.

---

## 10. Assets & Branding

**Public brand assets** (`/public/brand/`)
- `logo-black.png`, `logo-white.png` — master logos.
- `logo-tagline-white.png` — logo + tagline for marketing / auth.
- `mark-black.png`, `mark-white.png` — Centurion mark (favicon, app icons, coach avatar, loading).
- `texture-dark.png`, `texture-light.png` — blueprint-style textures.

**Branding archive** (`/Dad Edge Branding Guidelines/`) — original branding assets and `DAD_Edge_Guidelines_1.0.pdf`.

**Coaching reference** (`/Assets/CoachingDocuments/`) — `Immunity-to-Change-Coach_s-Guide-Volume-{1,2}.pdf`; used for coach prompt development, not shipped.

**Design system**
- Dark-first. True black (#000000) background, near-black surfaces (#0b0f14).
- Palette: primary blue #0075c9, accent cyan #6fcfeb, success #0075c9, warning #ff5f00, danger #fe3b1f, coach purple #8347ad.
- Fonts: Trade Gothic Bold headings, Proxima Nova body (Adobe Fonts, licensing pending); Archivo + Inter as current fallbacks.
- Tokens in `src/globals.css` (Tailwind v4 `@theme` syntax).
- Pillar colors mapped to `--color-pillar-{code}` CSS vars, used consistently across grids, cards, and coach bubbles.

---

## 11. Environment Variables

Supabase (required)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

App (required)
- `NEXT_PUBLIC_APP_URL` — required for auth redirects. Must match the production origin exactly (e.g. `https://dadedgeoperatingsystem.com`). If unset, activation/reset links fall back to `http://localhost:3300` and break. Also must match Supabase Auth's "Site URL" + Redirect URLs allowlist in the dashboard.
- `ALLOW_DESIGN_ROUTE` — set to `1` to expose `/design` in production.

Cron (required in prod)
- `CRON_SECRET`

Coach (required)
- `ANTHROPIC_API_KEY`

Email (Stage B — live in prod)
- `RESEND_API_KEY`
- `RESEND_FROM` — must be a bare email (`no-reply@dadedgeoperatingsystem.com`) or name-with-brackets (`Dad Edge <no-reply@dadedgeoperatingsystem.com>`). Local part must match the verified Resend sending domain.
- `EMAIL_STAGE` — must be exactly `B` (case-sensitive single char) to activate Stage B. Any other value falls back to Stage A (Supabase's default sender).

Stripe (Phase 3)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Examples at `.env.example` (minimal) and `.env.local.example` (extended).

---

## 12. Implementation Notes

- **Session management** in `src/lib/session.ts` (see §5).
- **Timezone handling** — `America/Chicago` default, per-user override at onboarding. Used for local date math, cron scheduling, and daily reminder time.
- **Prompt caching** — coach context assembled once per conversation, cached via `cache_control` for follow-up turns to reduce latency and cost.
- **Optimistic UI** — check-in toggles, mission completions, and reflection saves apply immediately with background sync.
- **Error handling** — API routes return JSON errors; server actions bubble to Next.js error boundaries; cron jobs fail open (one broken job doesn't block others).
- **Data privacy** — RLS enforces access at the DB layer. Family layer and coach data are self-only; coach reads via service role. Flag queue is admin-only per DECISION #6.

---

## 13. Checkpoint Status & Gaps

**Phase 1 — Core Tracker**
- [x] A — design tokens, brand shell, `/design` library.
- [x] B — auth, `/today`, `/missions`, `/goals`, seed script.
- [x] C — `/community` scorecard, leaderboard tabs, 7-step onboarding, Partner Connection Survey + delta, family layer.
- [ ] D — admin panel + importer dry-run against `Brave Man Sheet.xlsx` (not started). Importer plan: column-scan four drifted sheets, idempotent natural keys (user + date + pillar; user + week + mission description), per-sheet dry-run report.

**Phase 2 — The Coach** (largely shipped)
- [x] Context injection pipeline (provider pattern — identity, family, survey, streaks, goals, missions, reflections, itc).
- [x] Mission mode with concreteness gate at coach layer.
- [x] General mode (five dimensions: marriage, kids, business, finance, health).
- [x] Safety classifier + flag queue end-to-end (severity ≥ medium enqueued).
- [x] Model routing + allowance metering (150/month soft cap, 300 hard).
- [ ] Weekly digest generation.
- [x] Resend email delivery (Stage B live — activation + reset + nudges).

**Auth phase** (shipped)
- [x] Password sign-in + forgot-password + set-password.
- [x] Admin Send Invite (individual + batch) via Resend recovery link (invite type rejected existing users).
- [x] ITC migration — `users.itc_access` flag, `itc_maps.user_id` link, migration script, admin toggle for post-migration grants.
- [x] `/itc` route unification — main-app session preferred, legacy cookie as fallback, `/itc/no-access` for signed-in users without `itc_access`.
- [x] One-active-map rule (DB unique index + app guard).
- [x] Universal pending states on all server-action buttons.
- [x] Bulk delete on `/admin/users` with typed confirmation.

**Onboarding wizard extension** (shipped)
- [x] `/onboarding/profile` step with Facebook-style circular cropper, city, cell phone.
- [x] Storage bucket + RLS for avatars.
- [x] `UserAvatar` component with initial fallback.
- [x] `/me/profile` dedicated edit page.
- [x] Reset-onboarding script for existing users.
- [x] ITC users routed through the wizard before landing on `/itc`.

**Platform admin community access** (shipped)
- [x] Backfill: admins auto-membershipped as leader in every existing community.
- [x] Trigger on communities insert: any new community auto-grants existing admins.
- [x] Trigger on user is_platform_admin flip-to-true: backfill memberships.

**Phase 3 — Stripe Billing**
- [ ] Checkout, customer portal, webhooks, dunning, win-back mechanics.

**Phase 4 — Polish & Expand**
- [ ] Push notifications (PWA first).
- [ ] Cohort/retention analytics.
- [ ] Basecamp / Ascent funnel integrations.

**Intentionally out of scope (Phase 1)**
- Custom pillar frameworks per community.
- Light mode.
- Third-party job queue.
- Messaging v1 exclusions: group chats, attachments, coach visibility (never); reporting/blocking, typing indicators (deferred).

**Code hygiene** — no TODO/FIXME markers found in `src/`.

---

## 14. Route → Permission Matrix

| Route | Auth | Role | Notes |
|-------|------|------|-------|
| `/login` | none | any | Email + password |
| `/auth/callback` | pending session | any | PKCE + hash-based token handling |
| `/set-password` | authed | any | Activation destination |
| `/reset-password` | authed | any | Forgot-password destination |
| `/onboarding/*` | user | member | Sequential, gated by `onboarding_step`; admins bypass |
| `/today` | user | member | Check-ins + reflections |
| `/missions` | user | member | Weekly planner |
| `/goals` | user | member | Quarterly goals |
| `/community` | user | member | Scorecard |
| `/community/leaderboard` | user | member | Weekly / Monthly / Streaks |
| `/coach`, `/coach/[id]` | user | member | Coach hub + thread |
| `/me`, `/me/profile`, `/me/partner`, `/me/kids`, `/me/survey*` | user | member (self-only data) | Family layer + edit-profile |
| `/leader/*` | user | leader | Community tools |
| `/admin/*` | user | platform admin | Platform ops + audit + flags (no `/admin/invites` — deleted 2026-08-24) |
| `/design` | public in dev; `ALLOW_DESIGN_ROUTE=1` in prod | any | Component library |
| `/api/coach/messages` | user | member | Send coach turn |
| `/api/coach/accept-mission` | user | member | Accept coach suggestion |
| `/api/missions/quality` | user | member | Server-side concreteness |
| `/api/missions/examples` | user | member | Exemplar library |
| `/api/cron/*` | `CRON_SECRET` bearer | system | Vercel cron |
| `/itc`, `/itc/[mapId]` | main-app session + `itc_access` OR legacy cookie | ITC coachee | ITC coaching workspace |
| `/itc/no-access` | main-app session | any signed-in user | Friendly deny page |
| `/itc/admin`, `/itc/admin/[mapId]` | ITC coachee + admin allowlist | ITC coach | Triage view + per-map viewer |
| `/itc/login` | none | any | Legacy migration soft-landing |

---

_Note on pillar semantics: only the labels (Bond, Raise, Amplify, Vitality, Enjoyment, Movement, Action, Network) are canonical in the code and DB seed. Fuller behavioral definitions of each pillar are not encoded in the app and should be sourced from Dad Edge coaching material before being published._

---

## 15. ITC Coaching Architecture

The ITC ("Immunity to Change") coach is a distinct sub-app at `/itc/*` that walks a Boardroom man through building a Kegan/Lahey 4-column map plus a designed test. Source is `src/app/itc/*` and `src/lib/itc/*`.

### Form-First architecture

The previous version of this app used a two-region chat + map layout with tool-call proposal cards. That's been retired. The current architecture is **Form-First**: **the coach LLM never writes state**. Every map mutation is a server action initiated by the coachee via a form. The LLM's job is limited to producing metadata — either narrative prose (walkthrough, review, recommendation) or structured semantic slots (schema-validated Zod objects) that the server uses to draft content the coachee then confirms, edits, or discards.

Design principle: **server owns structure, LLM owns semantic content.** When the LLM keeps producing formatting drift or ignoring rules, the fix is to move structure out of the prompt and into the server — not to add another prompt rule.

Consequences:
- No proposal cards, no `itc_action_proposals` table (dropped 2026-08-18), no tool-call framework.
- No forced tool choice, no rubric recovery loop, no premature-advance stripping — those problems disappear when the LLM isn't authoring state.
- No `ITC_PIPELINE` env flag; the legacy pipeline is gone.

### Stage machine (12 stages)

`goal → behaviors → worries → commitments → assumptions → review → immune_system → prioritize → test_design → test_running → results → done`

Defined in `src/lib/itc/stage.ts`. Forward transitions are gated (`canTransitionTo()`); backward transitions are always allowed. `assumptions → immune_system` is a legal jump — `review` remains as a name for backward compat but is skipped in the natural forward flow.

### Single-column canvas

`/itc/[mapId]` is a full-width single-column canvas (`src/app/itc/[mapId]/map-canvas.tsx`). Each stage is a `Section` component. As the map advances, earlier sections stay visible (read-only summaries of what's been done) and the active section owns the interactive form for that column. All non-active sections have a soft blue outline (`--color-primary` at 25%); the active section gets a full-opacity blue border, bg tint, and highlighted header so the coachee always knows where they are.

A single **Continue to [next]** button lives at the bottom of the canvas and is server-computed from `computeAdvanceGate()` — enabled only when the current stage's invariants are met, with a plain-English reason ("Add at least one behavior first") when disabled. Exceptions: `test_design` hides the ContinueBar entirely (the form owns advance via the "Run the Test" button); `results` uses its own advance buttons routed by `next_step`.

### Six coach surfaces

Coach output renders in one of six surfaces, distinguished by the `surface` column on `itc_messages`:

1. **`stage_note`** — persistent, pinned at the top of a stage section. Examples: the immune-system walkthrough, the prioritize recommendation, the done closing summary. Some (walkthrough / prioritize / done) stay visible on their section forever; most filter to the current stage.
2. **`entry_thread`** — anchored to a specific map entry via `entry_ref_table` + `entry_ref_id`. Coach reactions to a saved worry / commitment / test land here, rendered inline beneath the entry.
3. **`column_review`** — end-of-column set review. Renders inline above the Continue button on a completed column (goal / behaviors / worries / commitments / assumptions). goal / worries / commitments / assumptions run the SHARED CRITERIA module (`runColumnCriteria` in `src/lib/itc/criteria/orchestrator.ts`) and render deterministically via `renderFindings` with `mode: "column_review"`. `behaviors` still uses `generateColumnReview` in `coach.ts` (LLM-generated prose — behaviors has no structured criteria to check). Auto-invalidated when the coachee edits an entry in that column so the next page render regenerates against fresh state. See "End-of-column reviews" below.
4. **`hone_diagnostic`** — on-demand whole-map audit result. Renders as a dismissible amber banner at the top of the canvas (`HoneDiagnosticBanner`). One row max per map; re-running the audit replaces it. Uses the same criteria module + renderer as column reviews, but with `mode: "hone"`. See "Hone diagnostic" below.
5. **`dock`** — messages in the floating "Ask the coach" drawer (bottom-right). Never render on the main canvas.
6. **`focus`** — reserved for future set-piece flows.

### Coach helpers (all metadata-only)

All coach LLM calls live in `src/lib/itc/coach.ts`. Each returns either a structured Zod object or narrative prose — never state. Server actions in `src/app/itc/actions.ts` decide what to do with the metadata.

**Reaction / conversation:**
- `generateCoachChat` — free-form Q&A reply, prose only (used by the CoachDock).
- `generateCoachReaction` — inline reaction to a just-saved entry (worry / commitment / etc.). Returns `{ reply, refinement?, suggestions? }` — the `refinement` chip is a one-line sharper version the coachee can tap to fill an input; `suggestions` is 4-5 grounded options. Chips are cosmetic; a missing chip degrades to plain prose, an entry never fails to land.
- `generateSuggestions` — "Give me ideas" trigger. Returns 4-5 grounded options for the current column.

**Structured drafters (server-assembled content):**
- `draftWorryForBehavior` — writes a worry from a behavior + goal + pillar. Returns two slots (`opposite_move` + `identity_landing`); server template assembles the canonical `"I worry that if I …, ."` sentence. See "Drafter verification pipeline" below for the three-layer consistency check + rubric self-scoring + retry loop. Persistence boundary also runs every worry through `normalizeWorryPrefix` (in `src/lib/itc/maps.ts`) so worries typed freely as "I fear being X" or "I'm afraid I'd Y" are normalized to the "I worry that..." shape at the DB write — catches chat-extraction paths where the LLM violated the prompt rule + direct edits in the form.
- `draftCommitmentForWorry` — writes a competing commitment from a worry, in the **introductory form** (Kegan Vol 1 pp 26-27). Returns ONE slot (`vow`); server template assembles the canonical `"I'm also committed to never <vow>."` sentence. The vow mirrors the paired worry's identity/outcome content — worry "I fear being the guy who's defensive" becomes commitment "I'm also committed to never being the guy who's defensive." Depth rubric self-scoring + retry pipeline (single-layer; no consistency check — the introductory form is a text transformation of the worry, no adjacent-mechanism drift to guard against). Design bet documented in §16: the mechanism form (Vol 2) requires live coaching pressure to push past the noble first pass, which a self-service tool can't provide.
- `draftAssumptionsFromCommitments` — batch-drafts 2-6 assumptions as slot sets (antecedent + tell + identity). Server assembles each with `"I assume that if I …, then … and …"` structure. Assembled sentences run through `trimAssembledDraft`, which is guaranteed to return a string (soft 20-word target, never silent-drop). Deterministic consistency check on each draft; if any fail, one batch retry fires with per-draft feedback.
- `draftTestForAssumption` — pre-drafts a Kegan-voiced test for the selected assumption. Server pins `testType` when the caller specifies it (see server-owned variation below). **Self-verifies against SMART before returning**: initial draft → `reviewTestDesign` → if `needs_work`, `reviseTestFromReview` with the failing SMART feedback → re-review, capped at 2 revise cycles. Same shape as `reviseTestFromCoach`'s loop but running on the pre-draft, not just the client-clicked revise. Coachees now see a Modest-clean draft by construction instead of a needs_work card on their first Run the Test click.
- `reviseTestFromReview` — targeted test revision from a SMART review. Returns full test slots; server ignores `testType` (pinned to what the coachee already has via the dropdown). Backed by a **self-verify loop** in the server action: after each revision, immediately re-run `reviewTestDesign`; if verdict is still `needs_work`, feed the new review back into another revise pass. Cap: 3 total attempts. Returns final draft + its verdict so the client updates both form fields and the SMART card in one round-trip.

**Drafter verification pipeline (`src/lib/itc/rubric.ts`):**

Every worry / commitment / assumption drafter runs its output through a deterministic three-layer consistency check plus (for worry + commitment) a rubric self-score. If any layer fails, one drafter retry fires with the failing layer's `reason` fed back as feedback. Whatever comes back from the retry is returned — never silent-drop, per the "coachee sees SOMETHING they can edit" invariant.

- **`checkWorryLogicalConsistency`** — three layers on the assembled worry:
  1. Interior-scaffolding blacklist (`I'd have to see/face/feel/know/admit/be/become`, `admit to myself`).
  2. Past-tense revealer whitelist (`I've been`, `'s been`, `she'd`, `he'd`, `they'd`, `the truth`, `couldn't pretend/hide/deny`, simple-past event verbs like `I chose / lied / walked`).
  3. Kegan-canonical identity-rung whitelist (role-noun `the husband/man/father who X`, self-label `a fraud / not enough`, seen-as / see-me-as, role-failure verb toward `her/him/them`, self-over-other pattern). Vol 1 pp 13-14, 27.
- **Commitment consistency check** — removed with the switch to the introductory form. The introductory form is a text transformation of the paired worry; there's no adjacent-mechanism drift to guard against and no `protective_purpose` slot where interior-witness verbs could leak. Depth rubric alone verifies correctness. Depth criteria: `is_first_person_never_vow` / `mirrors_worry_identity` / `is_specific_not_generic`.
- **`checkAssumptionLogicalConsistency`** — deterministic whitelist on `consequent_identity` requiring a past-tense revealer marker (replaced an earlier LLM verifier that made judgment calls on subtle semantic inversion).

All checks are deterministic pattern matching; zero LLM cost per check. Same architectural family as `trimAssembledDraft` — server-owned structure over LLM-obedience prompt rules.

**Set-piece prose (walkthrough / recommendation / summaries):**
- `generateImmuneSystemWalkthrough` — the top-down three-movement Kegan/Lahey walkthrough of the coachee's own map. Persists as a `stage_note` on the immune_system section, always visible.
- `recommendAssumptionToTest` — the coach's Vol 2 p 268-anchored recommendation of which assumption to test first. Pre-selects the recommended assumption; coachee can override.
- `generateMapCloseSummary` — Kegan-voice closing summary on advance to `done`.

**Structured review:**
- `reviewTestDesign` — SMART verdict as structured data: `{ verdict: "ready" | "needs_work", smart: { safe, modest, actionable, researches, counters_assumption: { pass, note } }, one_thing_to_tighten }`. LLM writes semantic content only; the client renders the visual card (icons, borders, layout). Never persisted — the review is a per-attempt UX affordance, not durable map state.
- `reviewTestResult` — Kegan-voice interpretation of the coachee's post-test debrief. Persists as `entry_thread` on the result row.
- `generateColumnReview` — behaviors-only end-of-column set review (LLM prose). The other four columns use the shared criteria module instead. See "End-of-column reviews" below.

**Shared criteria module + whole-map audit (`src/lib/itc/criteria/`):**
- `runColumnCriteria(column, input)` (`criteria/orchestrator.ts`) — fires the criteria for one column. Used at end-of-column construction reviews for goal / worries / commitments / assumptions.
- `runHoneWaterfall(input)` — walks the map top-down (goal → worries → commitments → assumptions) and stops at the first layer with any finding. Used by `runHoneDiagnostic` in `actions.ts`. Everything downstream of a broken column is re-derived when the coachee fixes it, so critiquing them now is asking to fix something about to change (Kegan/Lahey Vol 1 p 4).
- `renderFindings(findings, context)` (`criteria/render.ts`) — one entry point for both surfaces. `mode: "column_review"` tunes the opening ("Two things worth sharpening on your worries before you move on"); `mode: "hone"` tunes it as a whole-map assessment. Per-entry rendering is identical so the coach voice matches across both flows.
- Per-column check files: `criteria/goal.ts` (`checkBundledGoal`), `criteria/worries.ts` (depth + interior-witness + redundancy), `criteria/commitments.ts` (depth + mirrors-worry + interior-witness), `criteria/assumptions.ts` (depth + vague-then + coverage + drift + overload), `criteria/tests.ts`. Shared types in `criteria/types.ts`.
- Same criteria feed both surfaces — the construction coach and the hone audit will never contradict each other. See "Hone diagnostic" below.

### Server-owned variation

The "Give me another draft" and (currently hidden) "safer version" affordances on test-design don't use prompt-shaped variation. The server owns the target `testType` via two rotation tables in `src/app/itc/actions.ts`:

- **`ANOTHER_ROTATION`** — cycles through the four test types (`behavioral → observation → thought_experiment → data_mining → behavioral`). The coachee clicks "Give me another draft"; server picks the next type deterministically; LLM writes a fresh draft of that type.
- **`SAFER_LADDER`** — steps down the stakes ladder (`behavioral > observation > thought_experiment > data_mining`; `data_mining` maps to null and the button hides). Currently gated behind `SHOW_SAFER_BUTTON=false` — the SMART-driven "Have the coach revise this" path subsumes the safer affordance because the coach revises with actual feedback data rather than guessing.
- **`WORRY_IDENTITY_SHAPES`** (`src/lib/itc/coach.ts`) — four Kegan-canonical identity-landing shapes (`role_noun → role_failure_verb → seen_as → self_label`) rotated by behavior index in `draftMissingWorriesAfterAdvance`. Guarantees the map's worry set varies across shapes rather than the LLM defaulting to `"she'd see I've been the man who X"` on every behavior. Same architectural rationale as `ANOTHER_ROTATION`: hard-typed constraint from the server beats soft "vary the shape" prompt instruction.

This pattern is why the LLM produces genuinely different drafts each click instead of near-duplicates: the LLM sees a hard type constraint, not a soft "give me something different" instruction.

### Run the Test flow (single-button save + review + advance)

`test_design`'s "Run the Test" button collapses save + SMART review + conditional advance into one action (`runTest` in `actions.ts`):

1. Persist the test.
2. Fire `reviewTestDesign` → structured SMART verdict.
3. If verdict is `ready` (or the LLM failed — fail-open), advance to `test_running`.
4. If verdict is `needs_work`, stay on `test_design`; return the SMART payload so the client renders the review card inline at the top of the section (green border on ready, amber on needs_work, with a "One thing to tighten" callout).

The SMART card is client state only — never persisted. On successful advance, it disappears with the form. On needs_work, it stays until the coachee's next action (edit fields + Run again, or "Have the coach revise this" for a targeted rewrite).

### Immune-system walkthrough

On advance into `immune_system`, `deliverWalkthroughAfterAdvance` fires `generateImmuneSystemWalkthrough` and persists the result as a `stage_note` with `stage_at_creation=immune_system`. The walkthrough runs top-down: one loop per Big Assumption (assumption → underwritten commitments → paired behaviors → the goal it blocks), then a whole-system "gas and brake" summary, then the pivot to testing. Guide anchors: Vol 1 pp 4, 17 (top-down loop shape); Vol 1 pp vi, 3, 13 (gas/brake image); Vol 2 pp 250-252 (test-the-assumption pivot). Structure and prompt detail live in `src/lib/itc/prompts/stages/immune-system.ts`.

### End-of-column reviews (`column_review` surface)

Once a column has enough entries (`REVIEW_MIN_ENTRIES` per column) and no review row exists yet, the server generates a review on next page render and persists it as a `column_review` message on that column. The `ColumnReview` component in `map-canvas.tsx` renders it inline above the Continue button on the completed column.

Fires for the columns that reward set-level review: `goal`, `behaviors`, `worries`, `commitments`, `assumptions`. **Two code paths (refactored 2026-08-31):**

- **Shared criteria (goal / worries / commitments / assumptions):** the four honed columns run `runColumnCriteria(column, input)` from `src/lib/itc/criteria/orchestrator.ts` and render the findings deterministically via `renderFindings(findings, { mode: "column_review", columnLabel, ... })` from `src/lib/itc/criteria/render.ts`. Zero-finding case renders a "this column holds up" message; otherwise renders per-entry paragraphs grouped under the column header (quote + fix inline, or "N things to fix. (a) … (b) …" for multi-critique entries). Same criteria functions run in the hone waterfall, so a review that passed here won't fire on hone against the same map state.
- **LLM prose (behaviors):** `behaviors` still runs `generateColumnReview` in `src/lib/itc/coach.ts` against the system prompt at `src/lib/itc/prompts/stages/behaviors-review.ts`. Behaviors don't have structured criteria the way the other four columns do, so an LLM narrative is still the sharpest tool. Deleted 2026-08-31: `goal-review.ts`, `worries-review.ts`, `commitments-review.ts`, `assumptions-review.ts`.

Any add / edit / delete on a reviewed column calls `invalidateReviewsForColumn(mapId, column)` in `actions.ts`, which wipes the old `column_review` row so the next page render regenerates against fresh state. This is why the coachee never sees a review that references text they've since changed.

Column 4 (commitments) is the load-bearing column; a sharp end-of-column review here has outsized impact on the assumptions and tests that follow. Column 5 (assumptions) review has special attention on assumption-commitment pair drift, the single most common failure at that stage.

### Hone diagnostic (`hone_diagnostic` surface)

On-demand whole-map audit surfaced via the "Hone this map" button on the canvas (`hone-button.tsx` → `runHoneDiagnostic` in `src/app/itc/actions.ts`). Delivers a single amber banner at the top of the canvas (`HoneDiagnosticBanner`) with a Dismiss action. One row per map max; re-running the audit replaces the existing row.

Architecturally distinct from the behaviors-only LLM column review: the audit synthesis path is **pure deterministic template rendering, no LLM in the render step** (individual checks may still fire narrow structured LLM calls for pair-drift / overload / redundancy). **Refactored 2026-08-31 to use the shared criteria module (`src/lib/itc/criteria/`)** — same checks that power end-of-column reviews. The pipeline is:

1. **`runHoneWaterfall`** (`src/lib/itc/criteria/orchestrator.ts`) walks the map top-down (`goal → worries → commitments → assumptions`) via `runColumnCriteria` and stops at the first column with findings. Returns `{ column, findings }`. Waterfall rationale: everything downstream of a broken column will be re-derived once the coachee fixes it, so critiquing them now is asking to fix something about to change. Matches the derivation chain the Kegan/Lahey guide describes (Vol 1 p 4).
2. **`renderFindings`** (`src/lib/itc/criteria/render.ts`) with `mode: "hone"` renders the finding list as coach-voice prose. Openings vary by severity distribution ("N critical issues to fix before this hone pass is worth much else" / "map holds up structurally, N things worth sharpening"). Sections walk the map top-down (goal → worries → competing commitments → Big Assumptions). One paragraph per problematic entry.

Rendering rules that make multi-finding output read cleanly:

- **Grouped by entry.** Findings on the same map entry share a single `"quote"` opener. Multiple critiques on the same entry enumerate as "N things to fix. (a) … (b) …". Prevents the reader from seeing the same assumption quoted five times in a row when it has multiple issues.
- **Merged same-assumption drift.** Multiple `assumption_commitment_drift` findings on the same assumption merge into one clause naming all paired commitments with a "both" / "all three" quantifier and the shared scenario factored out.
- **Merged same-worry redundancy.** Multiple `worry_commitment_redundancy` findings on the same worry merge into a single "Duplicates both commitments" clause.

Issue types the checks emit: `bundled_goal`, `interior_witness_worry`, `interior_witness_commitment`, `commitment_doesnt_mirror_worry` (NEW 2026-08-31), `vague_assumption_then_clause`, `depth_shortfall_worry` / `_commitment` / `_assumption`, `assumption_commitment_drift`, `assumption_overload`, `assumption_uncovered_commitment`, `test_coverage_gap`, `test_grip_through_data`, `worry_commitment_redundancy`. `missing_commitment_stem` was deleted (unreachable — `ensureCommitmentStem` normalizes at save).

Why templates over LLM synthesis: earlier iterations wrapped the finding list in a synthesis LLM prompt. It kept inventing content (rewrites not present in any finding, aggregating single-A1 findings into "neither one has active tests", generalized "your worry hasn't reached depth" claims when no depth finding fired), even after multiple rounds of prompt sharpening and post-processing scrubs. Rewriting the synthesis as pure templates drove invented content to zero at the cost of stiffer prose. If a specific issue type ever needs a narrated beat templates can't produce, that single issue type can be selectively routed back through a narrow LLM call without reverting the whole architecture.

Coverage: `src/lib/itc/criteria/__tests__/checks.test.ts` + `src/lib/itc/criteria/__tests__/render.test.ts` (the pre-refactor `audit-render.test.ts` and `audit-rules.test.ts` have moved into the criteria tree).

### Freshness signals — downstream re-derive, walkthrough staleness, test snapshots (added 2026-08-31)

Four related mechanisms make sure a coachee never edits an upstream entry and forgets that downstream derivations have gone stale:

**Downstream re-derive nudges** (migration `20260831000002_itc_updated_at_downstream_staleness.sql`). Adds `updated_at timestamptz` columns to `itc_worries`, `itc_commitments`, `itc_assumptions` via triggers that fire on any row update. The UI compares timestamps:
- `commitments-row.tsx` shows a "re-derive?" affordance when `worry.updated_at > commitment.updated_at + 1s`.
- `assumptions-row.tsx` shows the same when the linked commitment's `updated_at` is newer.
- Actions `redriveCommitmentFromWorry` and `redriveAssumptionFromCommitment` (in `src/app/itc/actions.ts`) re-run the paired drafter against the fresh upstream text and replace the entry.

**Walkthrough staleness** (migration `20260831000003_itc_walkthrough_stale.sql`). Adds `walkthrough_stale boolean not null default false` on `itc_maps`. AFTER-update triggers on the 5 child tables (`itc_behaviors`, `itc_worries`, `itc_commitments`, `itc_assumptions`, `itc_assumption_commitments`) + a BEFORE trigger on `itc_maps` itself flip the flag to true whenever anything changes after the walkthrough was delivered. Regenerating the walkthrough clears it. Banner in `map-canvas.tsx` reads "the map has moved — regenerate to refresh the walkthrough".

**Test snapshot + supersede** (migration `20260831000004_itc_test_assumption_snapshot.sql`). Adds `assumption_text_at_design text` to `itc_tests`, captured at save time and never mutated afterward. Adds a new `superseded` value to `itc_tests.status`. When the underlying assumption text changes after a test was designed, the results view shows "assumption at test time" vs. "current" side by side so the coachee can decide whether the completed test still tells them what they think it tells them. Action `supersedeTest` marks a test superseded without deleting the row (so history stays intact) and unblocks designing a fresh one against the new assumption.

**Assumption delete guard** (migration `20260831000005_itc_tests_restrict_assumption_delete.sql`). Flips the `itc_tests → itc_assumptions` FK from `ON DELETE CASCADE` to `ON DELETE RESTRICT` so a stray delete can't wipe designed tests. `removeAssumption` in `actions.ts` pre-checks for linked tests and refuses with "This assumption has N test(s) attached. Abandon or supersede them first, or edit the assumption instead of deleting it."

### Coach Dock

`src/app/itc/[mapId]/coach-dock.tsx` is the floating "Ask the coach" drawer. Free-form Q&A back-channel — never writes map state (Layout Amendment §4). Every dock message calls `loadCoachContext(mapId)` first, so the LLM sees the full map (stage, goal, all four columns, tests, results) and the entire transcript before answering. Context-aware Q&A, not a generic chatbot.

### Data model

- `itc_participants` — separate identity table for Boardroom coachees. Email unique, normalized. See §17 for migration path to full auth.
- `itc_maps` — one per (participant, pillar). `current_stage`, `improvement_goal`, `reveal_delivered`, `walkthrough_delivered`, `walkthrough_stale` (added 2026-08-31; flipped true by triggers on any child-table update after walkthrough delivery, cleared on regenerate), `status`.
- `itc_messages` — chat transcript. `surface` (`stage_note` | `entry_thread` | `column_review` | `hone_diagnostic` | `dock` | `focus`), `stage_at_creation`, optional `entry_ref_table` + `entry_ref_id` for thread anchoring. System messages (e.g., `[coachee advanced map via Run the Test: test_design → test_running]`) never render to the coachee but stay in the coach's next-turn context.
- `itc_behaviors`, `itc_worries`, `itc_worry_attempts`, `itc_commitments`, `itc_commitment_attempts`, `itc_assumptions`, `itc_assumption_commitments` — the four columns plus attempt logs plus the many-to-many link between assumptions and commitments. `itc_worries`, `itc_commitments`, `itc_assumptions` carry `updated_at` (added 2026-08-31, populated by triggers) so the UI can detect and nudge downstream re-derivation. `itc_commitments.mirrors_worry_identity boolean` (added 2026-08-31) stores the rubric verdict on whether the vow mirrors the paired worry's identity/outcome; drives the `commitment_doesnt_mirror_worry` critical finding.
- `itc_commitment_drafts`, `itc_assumption_drafts` — server-generated draft metadata rows (from the on-advance draft hooks) that the coachee turns into real entries via save actions. Not first-class map content; wiped or filtered out once the coachee acts.
- `itc_tests`, `itc_test_results` — designed and completed tests. Test status: `designed | run | abandoned | superseded` (`superseded` added 2026-08-31). `itc_tests.assumption_text_at_design text` (added 2026-08-31) snapshots the assumption text at design time and never mutates; the FK on `assumption_id` was flipped from `ON DELETE CASCADE` to `ON DELETE RESTRICT` so a stray assumption delete can't wipe designed tests (the app-level `removeAssumption` action pre-checks). Result verdict: three-way (`held | partially_challenged | challenged`).
- `itc_turn_events` — per-turn structured diagnostic log (LLM attempts, dedup skips, stage advances, coach reactions, timing summaries).

All tables enforce RLS; server writes go through `createSupabaseServiceClient()` with participant-scoping enforced in application code (`getMapForParticipant` and friends).

### Voice and tone

`docs/coach-voice-and-tone.md` is loaded once at module init (`src/lib/itc/prompts/preamble.ts`) and prepended to every coach-generated surface. Single source of truth for language rules. The reaction coach + dock chat inherit voice via `buildItcCoachSystemSplit` → `PREAMBLE`. All drafters and stage-specific system prompts (worry, commitment, assumption, immune-system walkthrough, prioritize, test-design, results, done) inherit via `withVoiceRules()` in `src/lib/itc/coach.ts`, which prepends `VOICE_RULES` + delimiter to the drafter/stage body. No coach LLM call bypasses the voice doc.

Highlights:

- **No em dashes** (defensive strip catches misses).
- **No UI narration** (`paste`, `click`, `tap`, `hit`, `input`, `the card below`, `the button`, `the coach at the bottom-right` — banned).
- **No praise language** (`brave`, `raw`, `powerful`, `beautifully`, `you did great` — banned).
- **No therapy-speak** (`hold space`, `notice`, `invitation`, `sit with`, `lean into`, `process this` — banned).
- **No interior-witness metaphors in map entries** — `face`, `have to face`, `see` (self-truth object), `know` (self-truth object), `feel` / `have to feel`, `look at myself`, `own`, `sit with`, `admit to myself`, `land it` / `let it land` — banned. Names an OBSERVABLE consequence, not an interior reckoning. Concrete replacements table lives in the voice doc.
- **No product-speak** in coach-facing prose (`shape`, `the format`, `the template`, `the structure` — banned; describe the thing itself).
- **Pronouns and relational nouns must come from the coachee's own text.** Every pronoun and every relational noun in coach output must be traceable to the coachee's map (goal, behaviors, worries, commitments, assumptions) or their chat message. Prevents "she/her/wife" bleed from marriage-heavy worked examples onto maps about team, customers, kids, etc. Root cause of the leak: the ITC methodology's canonical examples in the training material are marriage-domain, and LLMs treat concrete few-shot examples as strong priors. Fix is a hard rule in `docs/coach-voice-and-tone.md` plus example diversification across pillars in the stage prompts.
- **Column labels by name, not number** (`your Big Assumptions` not `Column 5`; `your Competing Commitments` not `Column 4`).
- **Assumption, not belief** — Kegan's canonical term is "Big Assumption"; "belief" as a synonym has been retired throughout schema, prompts, and UI. The SMART criterion is `counters_assumption` (renders as "Counters the assumption").
- Full substitution table for jargon; contractions everywhere; Anglo-Saxon over Latinate; no crutch words (`very`, `really`, `truly`, `actual`, `actually`); no AI-signature vocabulary (`delve`, `tapestry`, `resonate`, `elevate`, `leverage`, `robust`, `profound`).

Adaptation rulings for how the two source guides (`Assets/Voice and Tone/voice-and-style.md`, `Assets/Voice and Tone/writing-craft.md`) apply inside the app live in `docs/app-voice-adaptation.md`.

### Test harness

`tests/form-first/` runs the current pipeline against the real DB with the real LLM (Anthropic Sonnet). Not persona-based — the earlier record/replay session harness was retired with the tool-call pipeline. Current suite has ~150 tests across regression + integration flows; run via `npm run test:itc`.

The unit-test file (`tests/form-first/units.test.ts`) is the fast, pure-function safety net — no LLM, no DB. Covers the deterministic pattern-matching helpers that the drafter verification pipeline depends on: `trimAssembledDraft`, `checkWorryLogicalConsistency` (three layers), `checkCommitmentLogicalConsistency` (three layers including the through-line check), `checkAssumptionLogicalConsistency`, `WORRY_IDENTITY_SHAPES` rotation, `withVoiceRules`, `worryPassesDepth`, plus stem/framing helpers. These lock the drafter safety net in place so a future refactor can't silently remove voice enforcement, revert a check layer, or reorder the shape rotation without a test failing.

---

## 16. Product Decisions Reference (ITC)

Two operating principles have driven every architectural decision on the ITC side:

**No bandaids.** When the LLM produces wrong output, refactor the LLM/server boundary before adding a prompt rule or post-processor. Concrete applications shipped: assumption/commitment drafters moved to structured slots with server-side sentence assembly; regenerate variation moved to server-side type-rotation tables; SMART review moved to structured data with client-rendered layout; single "Run the Test" button collapses save + review + advance; "Have the coach revise this" self-verifies in a server-side loop instead of asking the coachee to click three times. Memory: `~/.claude/projects/…/memory/feedback_no_bandaids.md`.

**Two-model separation for competing jobs.** When one LLM was doing both conversation and state extraction, both degraded. The split-conversation-from-state-extraction pattern was validated as the right call; reach for it when a single call is drifting between two competing responsibilities.

---

## 17. ITC ↔ Tracker Link

The ITC map isn't an isolated coaching artifact — an ITC improvement goal mirrors to the main-app `quarterly_goals`, and every ITC test mirrors to `missions`. Coaching work counts against the same weekly mission cap (15/week) and contributes to the same weekly total (Daily + Missions) as the rest of the app; the man has one integrated accountability record.

Wiring lives in `src/lib/itc/tracker-link.ts`; called from the ITC server actions. Failure policy: tracker-link failures never block the ITC action — a save that couldn't mirror gets logged, the ITC UX proceeds, and the next re-save retries.

### Identity bridge

`ensureUserForItcParticipant()` in `src/lib/itc/auth-bridge.ts` lazily bridges `itc_participants → public.users` on the first tracker-touching action:
1. If `participant.user_id` already set → return.
2. Match by normalized email against existing `public.users` → link and return.
3. Otherwise create an `auth.users` row (via admin API, `email_confirm: true`) → trigger inserts `public.users` → patch to `subscription_status='comped'` + `onboarding_step=7` (so an ITC-only coachee who later touches the main app passes the entitlement gate and skips onboarding).

### Sync points

- **Save goal** → `syncItcGoalToTracker`. Creates a `quarterly_goals` row in the current quarter (`focus_area = pillar_code`, `description = goal_text verbatim`, including the `"I'm committed to getting better at …"` stem). Stores the id on `itc_maps.quarterly_goal_id`. Edits update the linked goal in place.
- **Run the Test** → `createMissionForItcTest`. After SMART passes, mirrors the test as a `planned` mission (`created_by='itc'`, `target_date = test.target_date`, `pillar_code = map.pillar_code`, `quarterly_goal_id = map.quarterly_goal_id`). Application-level pre-flight cap check (15/week total, 5/bucket) — if the coachee is at cap, `runTest` returns a friendly reason and does NOT advance to `test_running`. Test row stays saved so no work is lost.
- **Save result** → `markMissionCompletedForItcTest`. Any verdict counts — the mission was "run the test," not "reach a specific outcome." Sets `completed_late` based on `ran_on` vs. `target_date`.
- **Abandon in-flight test** → `abandonMissionForItcTest`. Marks linked mission `abandoned` only if it was still `planned` — completed/missed/rolled_over stay as-is.
- **Reset map** → `cascadeItcMapClear`. Abandons the linked `quarterly_goal` and every linked `planned` mission; leaves completed/missed/rolled_over missions alone (they represent real historical work).

### Concreteness bypass

The application-level `validateMissionConcreteness` (`src/lib/validation/mission.ts`) takes an optional `bypassConcreteness` flag. Missions authored by the ITC coach (`created_by='itc'`) bypass the `CONCRETE_VERBS` + vague-pattern checks — ITC test behaviors like "stay in the room during the next argument" don't fit the "call/take/book" verb list but are already validated by SMART. Min-length and real-date checks still apply.

### Cap enforcement

ITC missions DO count against the same weekly caps as user-created missions. This is deliberate — an ITC test is real work and should compete for slot with other missions. If the cap is hit, the coachee gets a plain-English reason ("You're at your mission cap for the week...") from Run the Test and can resolve it on `/missions` before returning. The DB trigger `enforce_mission_weekly_cap` (updated to exclude `abandoned` from the count) is the backstop.

### No-community fallback

ITC-only coachees who haven't joined a `communities` row can still use the ITC UX. Their goal mirrors to `quarterly_goals`; their tests do NOT mirror to missions (which require `community_id NOT NULL`). Once they join a community, future tests mirror normally. Retroactive backfill of past tests is out of scope.

### Migration

Migration `20260820000001_itc_tracker_link.sql`:
- Adds `itc_participants.user_id` (nullable, unique).
- Adds `itc_maps.quarterly_goal_id` and `itc_tests.mission_id` (nullable FKs).
- Adds `'abandoned'` to `mission_status`.
- Adds `'itc'` to `mission_creator`.
- Updates `enforce_mission_weekly_cap` to exclude both `rolled_over` and `abandoned` from the count.

---

## 18. ITC Auth Migration (Shipped 2026-08-24)

The migration described in earlier drafts of this section is done. Current state:

- **Sign-in surface** — ITC users use `/login` (email + password) like every other user. `/itc/login` remains as a soft-landing that detects already-migrated emails and redirects to `/login` with a "Your account has been upgraded" banner.
- **Access flag** — `users.itc_access` boolean. Migration script (`npm run migrate:itc -- --apply`) set this on every user whose email matched an existing `itc_participants` row (case-insensitive). Admins can flip the flag via a checkbox on `/admin/users/[id]` for post-migration grants.
- **Session guard** — `requireItcParticipant()` reads the main-app Supabase session, checks `itc_access`, and upserts the `itc_participants` row for the email. Falls back to the legacy cookie for any coachee not yet migrated. Onboarding gate applies to ITC users too (except platform admins).
- **Data link** — `itc_maps.user_id` populated by the migration script so RLS and query paths can go through `auth.uid()` directly.
- **Deny UX** — signed-in main-app users without `itc_access` land on `/itc/no-access` (friendly "Not for you yet" page).

**Onboarding for ITC users.** Post-activation flow: click Send Invite email → `/set-password` → wizard (identity → profile → why → partner → kids → first-checkin) → `/itc` (their existing map, or landing if none). Admins skip the wizard.

**Auth-phase decisions worth remembering:**
- **`invite` type → `recovery` type in `generateLink`.** Supabase's `type: "invite"` refuses users that already exist in `auth.users`, which is every user we create via CREATE ACCOUNT. Switching to `type: "recovery"` with `redirectTo=/set-password` gives the same UX and works for existing users.
- **Two-callback flow support.** Supabase can return session tokens in either `?code=` (PKCE) or `#access_token=` (implicit hash). Our callback handles both — server-side PKCE exchange when present, otherwise a client bridge that parses the hash and calls `setSession()`.
- **Supabase URL config gotcha.** Site URL and Redirect URLs allowlist must include the prod domain. When they don't, Supabase silently rewrites redirects back to Site URL — which manifested as reset links landing on `localhost:3300`.
- **303 on logout.** Default `NextResponse.redirect` returns 307, which preserves POST. GET-only pages 405 back as blank screens. Explicit 303 See Other converts to GET.
- **Never reveal account existence.** Forgot-password and (removed) magic-link paths always render the "if that account exists, we've sent…" copy regardless of whether the email matched. Same rate-limit-friendly copy on retries.
- **Session invalidation on password change.** `updatePassword` calls `signOut({ scope: "others" })` so a reset triggered by real compromise doesn't leave a stolen device signed in.
