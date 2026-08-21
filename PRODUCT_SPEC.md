# BRAVE MAN OS — Product Specification

_Snapshot of current app behavior as of 2026-08-20. Reverse-engineered from the codebase at `/Users/jasonmackenzie/Custom Applications/Dad Edge Brave Man OS/`._

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
- Supabase Auth (magic links, no passwords)
- Anthropic Claude API (Sonnet for substantive coach turns, Haiku for routing/safety/summaries)
- Resend for transactional email (Phase 2+; Phase 1 logs to console)
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
| `/login` | `src/app/login/page.tsx` | Email entry → Supabase magic link. First sign-in triggers `handle_new_auth_user()` which creates a `users` row with `subscription_status='trialing'`, `onboarding_step=0`. |
| `/auth/callback` | `src/app/auth/callback/route.ts` | Handles Supabase auth code, establishes session. |
| `/logout` | `src/app/logout/route.ts` | Destroys session, redirects to `/login`. |
| `/reset-password` | `src/app/reset-password/page.tsx` | Stub — primary flow is magic link. |
| `/inactive` | `src/app/inactive/page.tsx` | Shown when subscription is `canceled` and the 30-day win-back window has elapsed. |

### 3.2 Onboarding (7 steps, tracked by `users.onboarding_step`)
Redirects always resume the user at their current incomplete step; completion sends them to `/today`.

1. `/onboarding` — **Identity.** first name, last name, timezone (11 presets), occupation, employment type (`w2` / `contract` / `self_employed` / `business_owner` / `other`).
2. `/onboarding/why` — **Why you're here.** Free-text captured to `users.why_yes`; fed to the coach later.
3. `/onboarding/partner` — **Partner profile** (optional, skippable). Name, relationship label (`wife` / `husband` / `partner` / `girlfriend` / `boyfriend` / `fiancee`), partner birthdate, relationship date, three "things you love most about her" entries.
4. `/onboarding/kids` — **Children** (optional, skippable, repeatable). Per child: name, birthdate, three "things you love most" entries.
5. `/onboarding/goal` — **First quarterly goal.** Pillar focus (B/R/A/V/E/M/N; A2 excluded) + description.
6. `/onboarding/mission` — **First mission.** Description, target date, pillar; passes through concreteness validator.
7. `/onboarding/first-checkin` — **First check-in.** Toggles across all 8 pillars for today, guaranteeing day-one activity.

### 3.3 Member app (route group `(app)`)
| Path | File | Purpose |
|------|------|---------|
| `/today` (also root default) | `src/app/(app)/today/page.tsx` | Daily check-in hub. Shows today's date, this week's Daily Living total (0–56), engagement streak, 8-pillar tap-to-toggle grid, and a Reflections panel with optional Wins/Learnings text. `A2` is displayed as derived from today's mission completions. |
| `/missions` | `src/app/(app)/missions/page.tsx` | Weekly mission planner. Shows this week (and next week if today is Sunday), active quarterly goals, quarter-deadline countdown, mission creation form with concreteness validation, and mission completion controls with completed-late flag. |
| `/goals` | `src/app/(app)/goals/page.tsx` | Quarterly goal management (create / edit / status). |
| `/community` | `src/app/(app)/community/page.tsx` | Community scorecard. Per member: last check-in, this week's total, engagement streak, mission completion rate, composite score, delta arrow vs. prior week. Canceled-within-win-back members shown with an "INACTIVE" badge. |
| `/community/leaderboard` | `src/app/(app)/community/leaderboard/page.tsx` | Tabs: Weekly, Monthly (4-week rolling), Streaks. Top 3 get a medal treatment. |
| `/coach` | `src/app/(app)/coach/page.tsx` | Coach hub — lists conversations, "new conversation" button (general or mission mode). |
| `/coach/[id]` | `src/app/(app)/coach/[id]/page.tsx` | Threaded conversation. Coach messages get a purple accent + Centurion mark avatar. Mission suggestion cards render inline with accept/reject. |
| `/me` | `src/app/(app)/me/page.tsx` | Profile: identity, partner summary, kids summary, latest survey composite + delta. |
| `/me/partner` | `src/app/(app)/me/partner/page.tsx` | Full partner profile edit. |
| `/me/kids` | `src/app/(app)/me/kids/page.tsx` | Add / edit / delete kids. |
| `/me/survey` | `src/app/(app)/me/survey/page.tsx` | List of Partner Connection Surveys with composite + delta. |
| `/me/survey/[id]` | `src/app/(app)/me/survey/[id]/page.tsx` | Read-only view of a completed survey. |
| `/me/survey/take` | `src/app/(app)/me/survey/take/page.tsx` | Take a new survey — 15 questions, score 1–5 + partner's verbatim note per question. |
| `/design` | `src/app/design/page.tsx` | Component library. Public in dev; requires `ALLOW_DESIGN_ROUTE=1` in production. |

### 3.4 Community leader (route group `(leader)`)
| Path | Purpose |
|------|---------|
| `/leader` | Dashboard: active count, disengaged buckets (3/7/14+ days), avg weekly Daily Living, mission completion rate, pending invites. |
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
| `/admin/users` | User list with subscription status; create invites. |
| `/admin/users/[id]` | Edit a user; manually set `subscription_status` and `subscription_source`; view audit log entries for the user. |
| `/admin/invites` | Create / list / resend invites. |
| `/admin/disengagement` | Platform-wide disengagement view. |
| `/admin/coach-flags` | Review queue for messages flagged by the safety classifier (severity ≥ medium, per 2026-08-27 update). Filterable by severity + status via `?severity=` + `?status=` query params. Notes + mark reviewed. |
| `/admin/audit` | Platform-wide audit log, searchable by actor / action / target. |
| `/admin/jobs` | Manual trigger for daily jobs with recent run history. |

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
| `/itc` | `src/app/itc/page.tsx` | Landing — pick a BRAVE MAN pillar to start a new map, or resume any in-progress / prior map. |
| `/itc/[mapId]` | `src/app/itc/[mapId]/page.tsx` | Full-width single-column ITC canvas. Stage-by-stage sections (goal → behaviors → worries → commitments → assumptions → immune-system walkthrough → prioritize → test-design → test-running → results → done). Each active section owns its own form; the coach's output renders inline in one of four surfaces (stage note, entry thread, focus, dock). A floating "Ask the coach" dock in the bottom-right is a free-form back-channel. |
| `/itc/admin` | `src/app/itc/admin/page.tsx` | Coach-facing map index (admins only). Lists in-progress maps only by default (`status === "in_progress"`); completed maps are hidden to keep the facilitator's watchlist tight. |
| `/itc/admin/[mapId]` | `src/app/itc/admin/[mapId]/page.tsx` | Per-map viewer with full transcript + turn events (`itc_turn_events`) for coach debugging. |
| `/itc/login` | `src/app/itc/login/page.tsx` | Separate email/password auth for Boardroom coachees (distinct from the member-app session). Demo login uses password `1111` behind an `itcDemoAuthEnabled()` flag; production will migrate to full auth (see §17). |
| `/itc/logout` | `src/app/itc/logout/route.ts` | Clears the ITC session cookie, redirects to `/itc/login`. |

---

## 4. Data Model

Migrations live in `supabase/migrations/`. Schema highlights below.

### Core
- **`users`** — id (PK, mirrors `auth.users.id`), email (unique), first/last name, phone, timezone (default `America/Chicago`), `is_platform_admin`, `subscription_status` (`trialing` / `active` / `past_due` / `canceled` / `comped`), `subscription_source` (`manual` / `stripe`), `stripe_customer_id`, `canceled_at`, `onboarding_step` (0–7), `why_yes`, `occupation`, `employment_type`. Auto-populated by `handle_new_auth_user()` trigger.
- **`communities`** — name, unique slug, accent color, timezone, `leaderboard_enabled`, `missions_visible`, status (`active` / `archived`), `week_lock_days` (default 3).
- **`memberships`** — one row per (user, community). Role (`member` / `leader`), status (`active` / `inactive` / `removed`), `joined_at`, `deactivated_at`, `canceled_visible_until` (= `deactivated_at + 30 days`).
- **`weeks`** — per community, Monday `start_date`, `is_intensive`, `locked_at`. Unique (community, start_date).
- **`pillar_framework_versions`** — versioned JSONB definition of pillars + `weekly_max`.
- **`daily_checkins`** — one row per (user, date, pillar). `value` is `0` or `1`. Absence of a row is meaningfully different from `value=0`.
- **`quarterly_goals`** — user + quarter_start + focus_area (pillar) + `desired_end_state` (renamed from `description` in migration `20260826000002`; both user and ITC goals use this column) + `current_state` (start line, user goals only) + `source` (`user`/`itc`, from migration `20260826000001`) + `status` (`active`/`completed`/`abandoned`/`needs_review`) + `midpoint_check_at` + `midpoint_check_answer` + `retrospective_what_happened` + `retrospective_what_learned`. DB trigger `enforce_active_goals_cap_trg` enforces a split cap: 2 user-authored active goals + 1 ITC-mirrored (3 total) per user per quarter. See §6 for the review flow that transitions goals into `needs_review`.
- **`missions`** — user, community, optional `quarterly_goal_id`, description (≥ 8 chars, DB CHECK), pillar, target_date, status (`planned` / `completed` / `missed` / `rolled_over`), `rolled_over_from_mission_id`, `created_by` (`user` / `coach_suggested`), `completed_at`, `completed_late`, `legacy_import`, `is_exemplar`. Trigger `enforce_mission_weekly_cap_trg` enforces cap of 15/week total, 5/goal-bucket, 5/other; rolled-over missions excluded from count.
- **`daily_reflections`** — one row per (user, date) with optional `wins` + `learnings`. Self-only RLS; coach reads via service role.

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
- **`invites`** — community, email, name, invited_by, redeemed_by/at. Unique (community, email).

### Row Level Security
- Member data (checkins, missions, goals) scoped to self + community-mates (active + canceled-within-win-back).
- Family layer + coach data + reflections: self-only. Coach reads via service role for context.
- Coach flag queue, audit log, score corrections: platform admin only.
- Helpers: `shares_active_community()`, `is_leader_of_target()`, `is_platform_admin()`.
- Consolidated in `supabase/migrations/20260713000006_row_level_security.sql`.

---

## 5. Authentication & Access

**Sign-in.** Magic link via Supabase Auth. First-time sign-in triggers app-side row creation.

**Roles.**
- **Member** — self data + community read + coach.
- **Community leader** — everything a member has, plus invites, member deactivation, nudges, past-week corrections, digest visibility.
- **Platform admin** — full access; coach flag review; audit log; manual cron triggers. Bypasses RLS with the service role for admin flows.

**Entitlement gate** — `canAccess(user)` in `src/lib/entitlement.ts`:
- `subscription_status ∈ {active, trialing, comped, past_due}` → `access: "full"`.
- `canceled` and `now - canceled_at < WIN_BACK_DAYS (30)` → `access: "read_only"`. User keeps history read + shows on scorecard with "INACTIVE" badge; write actions rejected.
- `canceled` past 30 days → `access: "none"`; redirected to `/inactive`.

**Session helpers** (`src/lib/session.ts`):
- `requireUser()` — auth check + redirect.
- `requireAccess()` — entitlement check; returns `{ user, readOnly }`.
- `requirePlatformAdmin()` — admin check + redirect.
- `resolveLeaderCommunity()` — community-scoping for `/leader/*`.

---

## 6. Business Logic & Scoring

### Daily Living total (weekly)
- Sum of `daily_checkins.value=1` across 8 pillars for 7 days. Range 0–56.
- `src/lib/scoring/week.ts` → `dailyLivingWeekTotal()`.
- NULL (no row) ≠ 0 (logged but not done).

### Mission scoring
- `completed` on or before target_date = full credit.
- `completed` after target_date with `completed_late=true` = full credit + "Completed · late" badge.
- `missed` = 0 credit.
- `planned` in the future doesn't affect rate.
- Weekly rate = `completed / (completed + missed)`; excludes `rolled_over` and future `planned`.
- **A2 (Action) pillar** derived daily as "had at least one mission completed today."

### Leaderboard composite (DECISION #1)
```
composite = round((dailyTotal / 56) * 100 * 0.7 + missionRate * 100 * 0.3)
```
- 70% habit consistency, 30% follow-through. Range 0–100. Resets weekly.
- `src/lib/scoring/composite.ts`.

### Engagement streak
- Consecutive days ending today with **any** check-in row (any value). Used on `/today`, leaderboard, Streaks tab.
- `src/lib/scoring/streaks.ts`.

### Week lock
- Daily cron marks a week's `locked_at` when `now - week.end_date >= community.week_lock_days` (default 3). Post-lock edits require the admin `score_corrections` flow.

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

### Concreteness validator (`src/lib/validation/mission.ts`)
1. Description length ≥ 8 chars.
2. Target date must be an ISO `YYYY-MM-DD` real date.
3. Description must not match vague-only patterns ("be more present", "improve", "be less…", "focus on…", "get better", "show up", "intentional", "mindful").
4. First three words must include a verb from the `CONCRETE_VERBS` set ("call", "take", "book", "meet", "run", "lift", "cook", "read", "travel", etc.).

Applied client-side for real-time UX and server-side (server action + `/api/missions/quality` + DB CHECK) as the source of truth.

### Disengagement classification
- Buckets by last check-in date: 3 / 7 / 14 / 14+ days inactive. `src/lib/scoring/disengagement.ts`.
- Copy escalates: gentle at day 3, direct at day 7, leader notification at day 14.

---

## 7. User Flows

### New member onboarding
Invite → magic link → identity → why → optional partner → optional kids → first quarterly goal → first mission (concreteness-gated) → first check-in → `/today`.

### Daily check-in
Open `/today` → see week total + streak → tap each pillar (cycle null → 1 → 0 → null) with optimistic UI → optionally fill Wins/Learnings for the coach.

### Mission workflow
Create at `/missions` with description, target date, pillar, optional goal → validator gates concreteness → capped at 15/week (5/bucket, 5/other) → mark complete (optionally flag as late) → contributes to A2, mission rate, and leaderboard composite.

### Coach conversation
Start conversation from `/coach` (general or mission mode) → user types → Haiku safety classification → context builder pulls 4-week history + streaks + missions + goals + family layer + reflections → router picks Sonnet or Haiku → reply streams back with optional mission suggestion card → accept creates a mission → both turns persisted → flagged messages go to admin queue → allowance ticks down.

### Partner Connection Survey
Open `/me/survey` → start new survey → sit with partner → for each of 15 questions record her score (1–5) and verbatim note → save → delta computed vs. prior survey → coach reads latest survey + delta as context.

### Community leaderboard
`/community` scorecard shows all active members (plus canceled-within-win-back with badge). `/community/leaderboard` ranks by composite (Weekly), 4-week composite (Monthly), or raw streak (Streaks). Top 3 get medal UI; delta arrow vs. prior week.

### Leader disengagement
`/leader/disengagement` shows 3/7/14+ day buckets with pre-filled nudge copy → send nudge (email in Phase 2+, console in Phase 1) → day 14 escalates to leader outreach.

### Admin community setup
`/admin/communities` → create community → `/admin/invites` → invite by email → member signs in and joins automatically.

---

## 8. Integrations

**Supabase** — DB + Auth + RLS + (reserved) realtime. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Three clients: browser (`src/lib/supabase/browser.ts`), server request-scoped (`src/lib/supabase/server.ts`), service-role (`src/lib/supabase/service.ts`); middleware refreshes session per request.

**Anthropic Claude** — Sonnet for substantive coach turns; Haiku for routing, safety classification, nudge copy, digest summarization. Prompt caching used for stable context across turns. Env: `ANTHROPIC_API_KEY`. Files: `src/lib/coach/{client,prompts,safety,send-message}.ts`.

**Resend** — Magic links (once wired), reminders, nudges, disengagement ladder, weekly digests. Phase 1 logs to console. Env: `RESEND_API_KEY`, `RESEND_FROM`. `src/lib/email.ts`.

**Stripe** — Phase 3. Not yet integrated; subscription status is set manually via `/admin/users/[id]`. Planned webhooks: `customer.subscription.updated/deleted`, `invoice.payment_failed`. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

**Vercel Cron** — hits `/api/cron/daily` with `CRON_SECRET` bearer. `vercel.json` holds the schedule.

**PostHog + Sentry** — configured, not yet active.

---

## 9. Scripts

- `npm run seed` (`scripts/seed.ts`) — idempotent seed of one community ("The Basecamp", slug `basecamp`, `America/Chicago`) with 6 members (distinct behavior profiles: grinder, steady, cyclic, slipping, returning), Steve W as leader, 28 days of check-ins, one quarterly goal per member, one mission template per pillar.
- `npm run seed:boardroom` (`scripts/seed-boardroom.ts`) — stub for Boardroom-specific seed.
- `npm run brand:sync` (`scripts/sync-brand-assets.ts`) — reserved for auto-syncing brand assets to `/public/brand/`.

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
- `NEXT_PUBLIC_APP_URL` — for magic-link redirects.
- `ALLOW_DESIGN_ROUTE` — set to `1` to expose `/design` in production.

Cron (required in prod)
- `CRON_SECRET`

Coach (required for Phase 2+)
- `ANTHROPIC_API_KEY`

Email (Phase 2+)
- `RESEND_API_KEY`
- `RESEND_FROM`

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

**Phase 2 — The Coach** (partially scaffolded)
- [ ] Context injection pipeline (4-week trends, streaks, missions, goals, family layer, reflections).
- [ ] Mission mode with concreteness gate at coach layer.
- [ ] General mode (five dimensions: marriage, kids, business, finance, health).
- [ ] Safety classifier + flag queue end-to-end.
- [ ] Model routing + allowance metering (150/month).
- [ ] Weekly digest generation.
- [ ] Resend email delivery.

**Phase 3 — Stripe Billing**
- [ ] Checkout, customer portal, webhooks, dunning, win-back mechanics.

**Phase 4 — Polish & Expand**
- [ ] Push notifications (PWA first).
- [ ] Cohort/retention analytics.
- [ ] Basecamp / Ascent funnel integrations.

**Intentionally out of scope (Phase 1)**
- In-app messaging.
- Custom pillar frameworks per community.
- Light mode.
- Member-to-member communication.
- Third-party job queue.

**Code hygiene** — no TODO/FIXME markers found in `src/`.

---

## 14. Route → Permission Matrix

| Route | Auth | Role | Notes |
|-------|------|------|-------|
| `/login` | none | any | Magic link |
| `/onboarding/*` | user | member | Sequential, gated by `onboarding_step` |
| `/today` | user | member | Check-ins + reflections |
| `/missions` | user | member | Weekly planner |
| `/goals` | user | member | Quarterly goals |
| `/community` | user | member | Scorecard |
| `/community/leaderboard` | user | member | Weekly / Monthly / Streaks |
| `/coach`, `/coach/[id]` | user | member | Coach hub + thread |
| `/me`, `/me/partner`, `/me/kids`, `/me/survey*` | user | member (self-only data) | Family layer |
| `/leader/*` | user | leader | Community tools |
| `/admin/*` | user | platform admin | Platform ops + audit + flags |
| `/design` | public in dev; `ALLOW_DESIGN_ROUTE=1` in prod | any | Component library |
| `/api/coach/messages` | user | member | Send coach turn |
| `/api/coach/accept-mission` | user | member | Accept coach suggestion |
| `/api/missions/quality` | user | member | Server-side concreteness |
| `/api/missions/examples` | user | member | Exemplar library |
| `/api/cron/*` | `CRON_SECRET` bearer | system | Vercel cron |
| `/itc`, `/itc/[mapId]` | itc participant | boardroom coachee | ITC coaching workspace |
| `/itc/admin` | itc participant + admin | boardroom coach | Read all maps + per-turn events |

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

### Four coach surfaces

Coach output renders in one of four surfaces, distinguished by the `surface` column on `itc_messages`:

1. **`stage_note`** — persistent, pinned at the top of a stage section. Examples: the immune-system walkthrough, the prioritize recommendation, the done closing summary. Some (walkthrough / prioritize / done) stay visible on their section forever; most filter to the current stage.
2. **`entry_thread`** — anchored to a specific map entry via `entry_ref_table` + `entry_ref_id`. Coach reactions to a saved worry / commitment / test land here, rendered inline beneath the entry.
3. **`dock`** — messages in the floating "Ask the coach" drawer (bottom-right). Never render on the main canvas.
4. **`focus`** — reserved for future set-piece flows.

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

### Coach Dock

`src/app/itc/[mapId]/coach-dock.tsx` is the floating "Ask the coach" drawer. Free-form Q&A back-channel — never writes map state (Layout Amendment §4). Every dock message calls `loadCoachContext(mapId)` first, so the LLM sees the full map (stage, goal, all four columns, tests, results) and the entire transcript before answering. Context-aware Q&A, not a generic chatbot.

### Data model

- `itc_participants` — separate identity table for Boardroom coachees. Email unique, normalized. See §17 for migration path to full auth.
- `itc_maps` — one per (participant, pillar). `current_stage`, `improvement_goal`, `reveal_delivered`, `walkthrough_delivered`, `status`.
- `itc_messages` — chat transcript. `surface` (`stage_note` | `entry_thread` | `dock` | `focus`), `stage_at_creation`, optional `entry_ref_table` + `entry_ref_id` for thread anchoring. System messages (e.g., `[coachee advanced map via Run the Test: test_design → test_running]`) never render to the coachee but stay in the coach's next-turn context.
- `itc_behaviors`, `itc_worries`, `itc_worry_attempts`, `itc_commitments`, `itc_commitment_attempts`, `itc_assumptions`, `itc_assumption_commitments` — the four columns plus attempt logs plus the many-to-many link between assumptions and commitments.
- `itc_commitment_drafts`, `itc_assumption_drafts` — server-generated draft metadata rows (from the on-advance draft hooks) that the coachee turns into real entries via save actions. Not first-class map content; wiped or filtered out once the coachee acts.
- `itc_tests`, `itc_test_results` — designed and completed tests. Test status: `designed | run | abandoned`. Result verdict: three-way (`held | partially_challenged | challenged`).
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

The ITC map isn't an isolated coaching artifact — an ITC improvement goal mirrors to the main-app `quarterly_goals`, and every ITC test mirrors to `missions`. Coaching work counts against the same weekly caps, composite score, and A2 pillar as the rest of the app; the man has one integrated accountability record.

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

## 18. ITC Auth Migration Path

Current ITC login (`src/app/itc/login/`) is email + `1111` demo password. Sets a session cookie tied to `itc_participants.id`. Deliberately isolated from the main app auth (see `src/lib/itc/participant.ts:13-15`: "Never touches public.users").

Migration to full auth (`/login` + Supabase Auth + entitlements) is non-destructive because:
- All ITC data FKs to `itc_participants.id`, a stable UUID that never changes.
- `email` is normalized (trim + lowercase, unique) — a reliable join key.

Recommended migration:
1. Ship full auth (magic link via Supabase Auth is already used by the member app).
2. Add nullable `user_id` column to `itc_participants` FK'd to `auth.users`.
3. One-time backfill: for each ITC participant, find the auth user with matching normalized email; set `user_id`.
4. Update `requireItcParticipant()` to resolve via `user_id = current_auth_user.id` instead of the demo session cookie.
5. Retire `/itc/login` and the `1111` shortcut.

Watch-outs: email typos in current ITC rows (needs admin cleanup or a "claim my ITC data" flow), users who sign up with a different email than they used for ITC (same claim flow), canonical form for case + plus-tags.
