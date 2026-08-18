# BRAVE MAN OS — Product Specification

_Snapshot of current app behavior as of 2026-08-11. Reverse-engineered from the codebase at `/Users/jasonmackenzie/Custom Applications/Dad Edge Brave Man OS/`._

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
| `/admin/coach-flags` | Review queue for messages flagged by the safety classifier (severity ≥ high). Notes + mark reviewed. |
| `/admin/audit` | Platform-wide audit log, searchable by actor / action / target. |
| `/admin/jobs` | Manual trigger for daily jobs with recent run history. |

### 3.6 API routes
Coach
- `POST /api/coach/messages` — send a user turn; runs safety classification (Haiku), builds context, routes to Sonnet or Haiku, validates any mission suggestion, persists both turns to `coach_messages`, enqueues flags. Returns `{ conversationId, userMessageId, assistantMessageId, reply, missionSuggestion, allowance, crisis }`.
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
| `/itc/[mapId]` | `src/app/itc/[mapId]/page.tsx` | Two-pane workspace: chat with the coach on the left, live 4-column ITC map on the right. Chat resets to the current stage's turns; the map shows all state. |
| `/itc/admin` | `src/app/itc/admin/page.tsx` | Coach-facing map viewer (admins only). Read all maps + per-turn diagnostic events (`itc_turn_events`). |
| `/itc/login`, `/itc/logout` | `src/app/itc/login/`, `src/app/itc/logout/` | Separate email/password auth for Boardroom coachees (distinct from the member-app session). |

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
- **`quarterly_goals`** — user + quarter_start + focus_area (pillar) + description + status (`active` / `completed` / `abandoned`). DB trigger `enforce_active_goals_cap_trg` caps active goals at 2 per user per quarter.
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
- **`coach_messages`** — conversation, role (`user` / `assistant` / `system`), content, `model_used`, `tokens_in`, `tokens_out`, `flagged`, `flag_reason`.
- **`coach_flags_queue`** — message ref, severity, status (`open` / `reviewed`), reviewed_by, notes. Admin-only RLS (per DECISION #6).

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

### Win-back window (DECISION #4)
- 30 days after `canceled_at`. Shown on scorecard as "INACTIVE," read-only. After 30 days, hidden and redirected to `/inactive`. Constant `WIN_BACK_DAYS` in `src/lib/entitlement.ts`.

### Coach allowance (DECISION #5)
- Soft cap: 150 messages/member/month. Metering via `tokens_in`/`tokens_out` on `coach_messages`. Enforcement wiring is Phase 2.

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

### Stage machine (12 stages)

`goal → behaviors → worries → commitments → assumptions → review → immune_system → prioritize → test_design → test_running → results → done`

Defined in `src/lib/itc/stage.ts`. Forward transitions are gated (`advanceStage()` in `maps.ts`) — e.g. can't move to `worries` without at least one selected behavior; can't reach `prioritize` until `walkthrough_delivered = true`. Backward transitions are always allowed so the coach can hone earlier entries.

### Two-model pipeline

Every user turn runs through `runCoachTurnForMap()` in `src/app/itc/actions.ts`:

1. **Coach LLM** (Anthropic Sonnet via `@ai-sdk/anthropic`) — sees a static preamble + the current-stage prompt + prior turns + current map state; writes natural prose to the coachee. When it wants to change map state, it emits inline marker tags inside its prose.
2. **Extractor LLM** (Anthropic Haiku via `generateObject`) — runs after the coach reply; reads the turn transcript and current map state, emits structured `CoachAction`s for any state change the coach's markers missed. Safety net for the coach forgetting to fire a marker.

Both models are behind an `ITC_PROMPT_CACHE` flag that marks the static preamble as `cacheControl: ephemeral` for Anthropic's 5-minute prompt cache.

### Marker syntax (coach → state change)

The coach embeds tags in its prose. Server strips them from the visible reply and routes them. Parser is `src/lib/itc/marker-parser.ts`; markers validate against `CoachActionSchema` (a discriminated Zod union in `src/lib/itc/coach.ts`).

- **Content markers** (become UI cards, coachee must accept/edit/reject):
  `<<propose_goal>>…<</propose_goal>>`, `<<propose_behavior>>…<</propose_behavior>>`,
  `<<propose_worry behavior=N>>…<</propose_worry>>`, `<<propose_commitments_batch>>…<</propose_commitments_batch>>`,
  `<<propose_assumption commits=1,4>>…<</propose_assumption>>`, `<<save_test_design type=… target=YYYY-MM-DD>>…<</save_test_design>>`,
  `<<record_test_results verdict=… next=…>>…<</record_test_results>>`, `<<recommend_assumption index=N reason="…">>`,
  `<<replace_behavior index=N>>…<</replace_behavior>>`, `<<remove_behavior index=N>>`.
- **Immediate markers** (apply server-side, no card):
  `<<advance stage=X>>`, `<<mark_walkthrough_delivered>>`, `<<mark_reveal_delivered>>`, `<<select_assumption index=N>>`.

Unknown or malformed tags are stripped from visible text but not applied (logged to `errors[]`).

### Action-proposal cards (the deterministic lock-in path)

Content markers produce `itc_action_proposals` rows tied to the assistant message that emitted them. The UI (`src/app/itc/[mapId]/proposal-cards.tsx`) renders each pending proposal as an inline card below its message. States: `pending → locked | edited_locked | rejected | stale`. Cards call three server actions in `src/app/itc/actions.ts`:

- `acceptProposal` — runs the underlying `CoachAction` through `applyCoachAction()` (same rubric / dedup / stage-guard path as marker-immediate applies). Marks the proposal `locked`.
- `editAndAcceptProposal` — validates the coachee-edited payload against `CoachActionSchema`, guards `action_type` match, applies. Marks `edited_locked` and stores both original + edited payloads for audit.
- `rejectProposal` — marks `rejected` and appends a system message (`[coachee passed on X proposal] — keep probing / offer alternatives / take a different angle`) so the coach's next turn sees the rejection and adjusts.

This card layer replaced an earlier pure-inference path where the extractor guessed whether the coachee's affirmation counted as a "lock." The old path lost state routinely; the card path makes lock-in explicit.

### Action application

`applyCoachAction()` in `actions.ts` is the single entry point for every state change (marker-immediate, extractor, proposal-accept). It:

- Enforces stage guards via `ACTION_ALLOWED_STAGES` + `autoCascadeToActionStage()` (walks the stage machine forward one legal step at a time to reach the action's required stage before applying).
- Runs the depth rubrics (`src/lib/itc/rubric.ts`) for worry/commitment/assumption content — rejects entries that don't meet the "identity-level" bar.
- Dedups on normalized text (`normalizeMapText()` in `maps.ts`) — refuses second exact-text rows and surfaces a `[dedup]` system message so the coach doesn't re-fire.
- Records diagnostic events to `itc_turn_events` via `TurnEventLog` (flushed in one bulk insert per turn).

### Data model

- `itc_maps` — one per (participant, pillar). Holds `current_stage`, `improvement_goal`, `reveal_delivered`, `walkthrough_delivered`, `status`.
- `itc_messages` — chat transcript. `stage_at_creation` tags each message so the UI can filter to the current stage only.
- `itc_behaviors`, `itc_worries`, `itc_worry_attempts`, `itc_commitments`, `itc_assumptions`, `itc_assumption_commitments` — the 4-column map plus the many-to-many link table between assumptions and commitments.
- `itc_tests`, `itc_test_results` — designed and completed tests, one active at a time; verdict is three-way (`held | partially_challenged | challenged`) per ITC's non-binary framing.
- `itc_action_proposals` — pending / resolved cards (see above). `payload` is a validated `CoachAction`.
- `itc_turn_events` — per-turn structured diagnostic log (LLM attempts, dedup skips, action applies, timing summary).

All tables enforce RLS; server writes go through `createSupabaseServiceClient()` (service role only, bypasses RLS with participant-scoping enforced in application code — see `getMapForParticipant`, `loadProposalForParticipant`).

### Voice and tone

`docs/coach-voice-and-tone.md` is loaded once at module init (`src/lib/itc/prompts/preamble.ts`) and prepended to every coach turn. It's the single source of truth for language rules (no em dashes, no markdown in coach output, every reply ends with a question or CTA, etc.). Update the file to change coach voice; `next.config.mjs` traces it into the serverless bundle.
