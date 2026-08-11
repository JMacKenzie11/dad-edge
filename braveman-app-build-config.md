# BRAVEMAN Operating System App: Build Configuration

**Version 1.0 | July 2026**

A multi-community accountability platform for men running the BRAVE MAN Operating System: daily living check-ins, day-anchored missions, community leaderboards, and an AI coach grounded in each man's actual data. Positioned as a lower ticket offer beneath the full Dad Edge memberships.

---

## 1. Guiding Decisions (locked from requirements discussions)

1. **Two systems, never blurred.** Daily Living measures consistency of behavior across the eight pillars. Mission Planning is pre-planned, time-bound, day-anchored commitments. They are scored and displayed separately. The spreadsheet's habit of folding mission points into the Action row is not carried forward.
2. **Multi-tenant from day one.** Communities are the core organizing unit. Men see the missions and daily scorecards of everyone in their community.
3. **Two admin tiers.** Platform Admin (Jason) and Community Leader (facilitators). Built into the role model now even if one person holds both hats initially.
4. **Entitlements before billing.** Every user has a subscription status field and one gate function. Phase 1 sets status manually; Stripe later becomes just another writer to that field.
5. **One coach, two modes.** The general life coach (marriage, fatherhood, business, health, money) and the mission coach are the same brain. Every coaching conversation is grounded in the man's pillar scores, streaks, missions, and quarterly goals, and closes the loop toward a concrete behavior tied to a specific day.
6. **Disable access, never delete data.** Canceled men become inactive but remain visible to their group for a win-back window, and their history is intact if they return.

---

## 2. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | One codebase for member app, leader tools, and admin panel. Server components keep data access on the server. |
| UI | **Tailwind CSS + shadcn/ui** | Fast to build, easy to skin to Dad Edge brand tokens. |
| Database | **PostgreSQL via Supabase** | Relational model fits the data cleanly. Row Level Security enforces community boundaries at the database layer, not just in app code. |
| Auth | **Supabase Auth, magic links** | No password friction for this audience. Email is the identity anchor Stripe will later match on. |
| AI | **Anthropic API (Claude)** | Sonnet for coaching conversations, Haiku for routine turns, classification, and nudge copy. Model tiering is the cost lever. |
| Payments (Phase 3) | **Stripe Billing + webhooks** | Subscriptions, dunning/retry logic, customer portal for self-serve card updates and cancellation. |
| Email | **Resend** | Magic links, nudges, weekly digests. React Email templates. |
| Jobs/Scheduling | **Inngest** (or Supabase cron to start) | Nightly streak calculation, week close/lock, disengagement scans, digest generation. |
| Hosting | **Vercel** | Zero-ops deploys, preview environments, cron support. |
| Analytics | **PostHog** | Feature usage, retention curves, funnel from invite to first check-in. |
| Errors | **Sentry** | Because a broken check-in flow is silent churn. |

**Repository layout:** single Next.js app with route groups: `(app)` for members, `(leader)` for community leaders, `(admin)` for platform admin, `api/` for webhooks and coach endpoints. One deploy target. Split later only if needed.

**Branding assets live in the repo at `/branding`** (see Section 9). This directory is the source of truth for logos, textures, and the brand guidelines PDF. The design system must be generated from it, not from generic defaults.

**The live 2026 tracker workbook also ships in the repo root** as `DAD_EDGE_BRAVEMAN_TRACKING_2026-2.xlsx`. It is the source file for the Phase 1 history importer (Appendix A) and the reference for validating that the app's scoring reproduces what the men already know.

---

## 3. Data Model (core tables)

```
users
  id, email, first_name, last_name, phone, timezone
  is_platform_admin (bool)
  subscription_status  ENUM: trialing | active | past_due | canceled | comped
  subscription_source  ENUM: manual | stripe
  stripe_customer_id (nullable until Phase 3)
  created_at, last_seen_at

communities
  id, name, slug, accent_color, timezone
  leaderboard_enabled (bool), missions_visible (bool)
  status ENUM: active | archived
  created_at

memberships
  id, user_id, community_id
  role ENUM: member | leader
  status ENUM: active | inactive | removed
  joined_at, deactivated_at
  -- a man can belong to more than one community (Basecamp to Ascent moves)

pillar_framework_versions
  id, version, effective_date, definition JSONB
  -- pillars: B, R, A, V, E, M, A2 (Action), N with labels and point rules.
  -- Versioned so the framework can evolve without corrupting history.

weeks
  id, community_id, start_date (Monday), is_intensive (bool)
  locked_at (nullable)
  -- generated per community calendar; lock rules configurable

daily_checkins
  id, user_id, date, pillar_code, value (0/1)
  logged_at, edited_at
  UNIQUE (user_id, date, pillar_code)
  -- explicit zero vs. absent row distinguishes "didn't do it" from "didn't log"

quarterly_goals
  id, user_id, quarter_start, focus_area (pillar_code), description
  status ENUM: active | completed | abandoned

partner_profiles
  id, user_id (UNIQUE), partner_name
  relationship_label  ENUM: wife | husband | partner | girlfriend | boyfriend | fiancee
  partner_birthdate (nullable), relationship_date (nullable)  -- wedding/anniversary
  things_loved TEXT[]   -- "a few things he loves most about her"
  created_at, updated_at
  -- entire record optional; onboarding never blocks on it

children
  id, user_id, name, birthdate (nullable), things_loved TEXT[]
  created_at

survey_question_sets
  id, version, effective_date
  -- seeded with the 15-question Partner Connection Survey; versioned so
  -- wording can evolve without breaking historical comparability

survey_questions
  id, question_set_id, sort_order, text

partner_surveys
  id, user_id, question_set_id, taken_at, context_note
  -- repeatable; a man takes it quarterly (suggested cadence) to track deltas

partner_survey_responses
  id, survey_id, question_id, score SMALLINT CHECK (1..5), note TEXT
  -- one row per question; note field is required by the UI to sit beside each score

missions
  id, user_id, quarterly_goal_id (nullable), community_id
  description, pillar_code
  target_date (DATE, required: the specific day)
  status ENUM: planned | completed | missed | rolled_over
  rolled_over_from_mission_id (nullable)  -- rollover chain is coach fuel
  created_by ENUM: user | coach_suggested
  completed_at

coach_conversations
  id, user_id, mode ENUM: general | mission
  started_at, last_message_at

coach_messages
  id, conversation_id, role, content, model_used, tokens_in, tokens_out
  flagged (bool), flag_reason

coach_flags_queue
  id, message_id, severity, status ENUM: open | reviewed, reviewed_by, notes

score_corrections
  id, admin_user_id, target_user_id, date, pillar_code, old_value, new_value, reason

audit_log
  id, actor_user_id, action, target_type, target_id, metadata JSONB, created_at
  -- includes admin "view as member" events

nudge_settings (per community)   |   digests (generated weekly per community)
```

**Row Level Security posture:** members read their own data plus check-ins, missions, and leaderboard rows for active members of their communities. Leaders get management reads/writes scoped to their community. Platform admin bypasses via service role, always audit-logged.

---

## 4. Scoring Model

**Daily Living score (per week):** sum of 0/1 check-ins across the eight pillars for seven days. Max 56. Displayed per pillar and as a weekly total, mirroring the tracker men already know.

**Mission score (per week):** missions completed on or before their target date. Completed after target date counts as completed-late (visible, worth less or flagged, decision below). Missions are capped per week (suggest 3 to 5) to force prioritization; fifteen slots in the spreadsheet produced padding, not focus.

**Streaks:** consecutive days with at least one check-in logged (engagement streak) and per-pillar streaks (behavior streaks). Calculated nightly per user timezone.

**Leaderboard (per community, weekly):** ranks on a composite of Daily Living total and mission completion rate, with tabs for weekly, monthly, and streak views. Weekly reset keeps a bad week from burying anyone; the man who fell off can be back on top in seven days, which is the whole retention psychology.

**Week lock:** weeks lock N days after they end (default 3, configurable per community). Post-lock edits go through admin correction with an audit trail.

---

## 5. Access and Entitlement Gate

One function, called everywhere:

```
canAccess(user) =>
  status in (active, trialing, comped)      -> full access
  status == past_due                        -> full access during Stripe retry window
  status == canceled                        -> read-only own history; hidden from
                                               leaderboard; shown as "inactive" to
                                               community for win-back window (30 days),
                                               then hidden
```

Phase 1: admin panel writes `subscription_status` manually. Phase 3: Stripe webhooks (`customer.subscription.updated`, `deleted`, `invoice.payment_failed`) write the same field. Nothing else in the app changes when billing arrives.

---

## 6. AI Coach Architecture

**One brain, two modes,** deployed from the existing five-dimension agent IP (marriage, kids, business/career, finances, health).

**Context injection on every conversation:** a compact, server-built context block containing current pillar scores and 4-week trend, active streaks and recent breaks, this week's missions with status and rollover chains, quarterly goals, community membership, and the family layer where it exists: partner name and label, upcoming birthdays and anniversary, things he loves about her and the kids, and the latest Partner Connection Survey scores with deltas from prior surveys. This is the differentiator: the coach opens from the man's actual data and his actual family, not from zero.

**Mission mode contract:** the coach must land on the format *behavior + specific day* ("I will take my wife on a date night on Thursday"). A server-side concreteness check rejects vague output ("be more present") before a mission can be saved. Coach-suggested missions are marked as such and require the man's acceptance.

**General mode contract:** appreciative inquiry underneath, plain and direct on the surface, Dad Edge voice. Every substantive conversation closes toward a mission: "So what's the mission? Give me the behavior and the day." Prompts are versioned per community tier so a Basecamp man and a Summit man get different levels of challenge.

**Safety and escalation:** clear coach-not-therapist positioning at onboarding and in-product. A lightweight classifier (Haiku) screens messages for crisis signals; flagged conversations enter the admin review queue and the coach responds with appropriate care and resource direction. Non-negotiable before general mode ships.

**Cost controls:**
- Haiku for routine turns, intent classification, nudge copy, digest drafts; Sonnet reserved for substantive coaching turns (router decides).
- Monthly message allowance per member (e.g., 150 coach messages), soft-capped with a friendly ceiling rather than a hard wall, tracked via `tokens_in/out` on `coach_messages`.
- Rough math at a $29 to $49/month price point: a heavy user at 150 Sonnet-class exchanges costs low single digit dollars per month in inference; the allowance plus routing keeps worst-case margin safe. Recheck against current API pricing before setting the final price.

---

## 7. Admin Functions (summary of agreed scope)

**Platform Admin:** create/archive communities, assign leaders, move men between communities, manage entitlements manually (Phase 1), cross-community analytics, framework/content management, coach prompt versioning, data export, full audit log.

**Community Leader:** invite/deactivate members, per-member status view (last check-in, streak, missions set), disengagement dashboard (3/7/14-day inactive), configure nudges, receive/send weekly digest, review coach flags for their community, week lock overrides via correction flow.

**Deliberately excluded early:** in-app member-to-member messaging (existing channels do this; moderation is a job to avoid) and custom pillar frameworks per community (BRAVEMAN is the product).

---

## 8. Notifications and Retention Machinery

1. **Daily check-in reminder** (push later, email first), per-user time preference, per-user timezone.
2. **Mission day-of nudge:** "Date night is tonight. Report back."
3. **Disengagement ladder:** day 3 gentle, day 7 direct, day 14 leader is notified to reach out personally. The leaderboard is the retention mechanic; the disengagement report is the save mechanic.
4. **Weekly community digest** (the braveman-report skill, productized): rankings, streaks, mission analysis per man, delivered to leaders and optionally to the group.
5. **Week close notice:** "Your week locks Wednesday. Two days unlogged."

---

## 9. Design System and Brand Application

The branding system ships in the repository at `/branding`. Treat it as the single source of truth. Before building any UI, read `/branding/uploads/DAD Edge Brand Guidelines/DAD_Edge_Guidelines_1.0.pdf` and inventory `/branding/assets/`.

### 9.1 Asset inventory (in repo)

```
/branding/assets/
  logo-black.png            Master logo, black (light backgrounds only)
  logo-white.png            Master logo, white (dark backgrounds; primary use in this app)
  logo-tagline-white.png    Master logo with tagline, white (marketing/auth pages only)
  mark-black.png            Centurion mark, black
  mark-white.png            Centurion mark, white (favicon, app icon, loading states, avatars fallback)
  texture.png / texture-light.png / texture-dark.png
                            Master brand texture (blueprint-style background treatment)
```

Copy web-optimized versions into `/public/brand/` at build time; never hotlink into `/branding` from pages.

### 9.2 Hard brand rules (from the guidelines, non-negotiable)

1. Logos and the Centurion mark appear in **black or white only**. Never recolored, never stretched, never placed over busy imagery without the texture or a solid field behind them.
2. Clear space around the logo equals the height of the logo text. Do not crowd it with UI elements.
3. Only the approved palette below is used. No additional hues invented for the UI.
4. Black is the primary color. This is a **dark-first application**.

### 9.3 Design tokens (implement as CSS variables + Tailwind theme)

```css
/* globals.css @theme (Tailwind v4) or tailwind.config extension */
--color-bg:            #000000;   /* page base */
--color-surface:       #0b0f14;   /* cards, panels: near-black, not gray */
--color-surface-2:     #12181f;   /* elevated: modals, popovers */
--color-border:        #1e2630;   /* hairline borders */
--color-text:          #ffffff;
--color-text-muted:    #9aa7b4;

--color-primary:       #0075c9;   /* Blue: buttons, links, focus rings, active states */
--color-accent:        #6fcfeb;   /* Cyan: headings on dark, data highlights, streaks */
--color-success:       #0075c9;   /* Blue: completed missions, positive deltas */
--color-warning:       #ff5f00;   /* Orange: nudges, at-risk states, rollover flags */
--color-danger:        #fe3b1f;   /* Red: missed missions, destructive actions */
--color-coach:         #8347ad;   /* Purple: reserved exclusively for the AI coach surface */

--font-heading: "Trade Gothic Bold", "Archivo", "Oswald", sans-serif;
--font-body:    "Proxima Nova", "Inter", sans-serif;
```

Reserving purple for the coach gives the differentiator its own visual identity: the moment a man sees purple, he knows the coach is talking. Semantic mapping (green complete, red missed, orange at-risk) must be consistent across scorecards, missions, leaderboards, and digests.

**Pillar accents for data visualization:** assign each pillar a consistent color drawn only from the approved palette (rotate blue, cyan, green, orange, purple, red across B/R/A/V/E/M/A/N, with tints of the same hue where eight distinct values are needed). Same pillar, same color, everywhere: charts, streak chips, check-in grid.

**Fonts:** Trade Gothic and Proxima Nova are licensed fonts (Adobe Fonts carries both). If licensing is confirmed, load via Adobe Fonts; otherwise ship the fallbacks (Archivo for headings, Inter for body) and swap later. Headings render uppercase with slight letter-spacing to match the logo and slide language (see the "BRAVE MAN OPERATING SYSTEM" slide treatment).

### 9.4 Look and feel direction: "command center, not wellness app"

The reference aesthetic is the existing Boardroom slides: dark navy-black field, blueprint texture, bold condensed uppercase cyan headings, high contrast. The app should feel like a mission briefing room. Specific directives for the build:

1. **Dark-first, always.** No light mode in Phase 1. Backgrounds are true black to near-black, with `texture-dark.png` applied at 4 to 8 percent opacity as a fixed background layer on shell/header/hero surfaces only, never behind dense data tables.
2. **Typography does the heavy lifting.** Big condensed uppercase headings in white or cyan, generous size contrast between heading and body, muted gray for secondary text. Numbers (scores, streaks) are display-sized: the weekly score should read from across the room.
3. **Cards with hairline borders, subtle depth.** `--color-surface` panels, 1px `--color-border`, large radius (12 to 16px), no drop-shadow soup. Depth comes from layered surface tones, not shadows.
4. **Motion, restrained and purposeful.** Framer Motion for: check-in toggle satisfaction (scale/spring on tap), streak flame count-up, leaderboard rank-change slide, mission completion sweep. Nothing decorative, everything under 300ms, respects `prefers-reduced-motion`.
5. **Mobile-first check-in.** The daily log screen is the most-used screen in the product: eight large tap targets, one thumb, under 15 seconds. Optimistic UI (toggle updates instantly, syncs in background).
6. **Gamification surfaces get the premium treatment.** Leaderboard rows with rank medals for top 3, streak chips with the flame count, week-over-week delta arrows in green/red. This screen is the retention mechanic; it should be the best-looking screen in the app.
7. **The coach surface is distinct.** Purple accent, the Centurion mark as the coach avatar, conversation UI that feels like texting a mentor, with mission-commit cards ("Date night. Thursday.") rendered as structured cards the man taps to accept, not walls of text.
8. **Empty states and loading states are designed, not default.** Centurion mark pulse for loading, direct copy for empty states ("No missions set. That's the mission.").

### 9.5 Instructions to the coding agent

- Generate the token file and Tailwind theme from Section 9.3 **first**, before any component work, and build every component against tokens. No hex values in component code.
- Build a `/design` route (dev-only) that renders the full component library against the tokens: buttons, cards, check-in grid, leaderboard row, mission card, coach bubble. Use it to verify brand application before assembling pages.
- Every page renders the white logo or white mark on the dark shell per the clear space rule. Favicon and PWA icons are generated from `mark-white.png` on black.
- Copy tone in all UI strings: plain, direct, blue-collar. "Log today," "Set the mission," "Report back." No wellness-speak, no exclamation-mark cheerleading.

### 9.6 Tone in-product

Plain, direct, blue-collar. Buttons say "Log today" and "Set the mission," not "Update your wellness journey." Notifications challenge rather than coddle: "Date night is tonight. Report back."

---

## 10. Build Phases

**Phase 1: Core Tracker (the product)**
- Design system first: tokens, fonts, dark shell, `/design` component library route (Section 9)
- Onboarding flow with family layer: partner profile, kids, Partner Connection Survey with delta tracking (Section 12)
- Auth (magic links), users, communities, memberships, roles
- Daily check-in flow (mobile-first, under 15 seconds to log a day)
- Quarterly goals and missions with target dates and rollover
- Community visibility: see your brothers' scorecards and missions
- Leaderboard (weekly/monthly/streaks)
- Admin panel v1: communities, invites, manual entitlements, disengagement dashboard
- Week close and lock, nightly streak jobs, email reminders
- Seed migration: importer for the 2026 spreadsheet (`DAD_EDGE_BRAVEMAN_TRACKING_2026-2.xlsx` in repo root) so the Brotherhood starts with history intact. Full parsing specification in Appendix A, including handling for the four structurally drifted sheets.

**Phase 2: The Coach (the differentiator)**
- Context injection pipeline
- Mission mode with concreteness gate
- General mode across the five dimensions, Dad Edge voice, per-tier prompt versions
- Safety classifier + flag queue
- Model routing + message allowance metering
- Weekly digest generation

**Phase 3: Stripe (the business)**
- Checkout, customer portal, webhook handlers writing `subscription_status`
- Dunning/grace period behavior, win-back window mechanics
- Comp/trial management moves from fully manual to Stripe-aware

**Phase 4: Polish and expand**
- Push notifications (PWA first, native later only if demanded)
- Deeper analytics, cohort retention views
- Basecamp/Ascent funnel integrations (upgrade paths into full membership)

---

## 11. Open Decisions (need your call, none block Phase 1 start)

1. Composite leaderboard formula: weighting between Daily Living total and mission completion rate.
2. Completed-late missions: partial credit or full credit with a "late" marker.
3. Missions-per-week cap: 3 or 5.
4. Win-back window length for canceled members (proposed 30 days).
5. Price point, which sets the coach message allowance math.
6. Whether community leaders can read coach conversation flags or only platform admin (privacy question worth deciding deliberately).

---

## 12. Onboarding Flow and the Family Layer

### 12.1 Onboarding sequence

Onboarding is the first Bond exercise, not a settings form. Sequence, mobile-first, each step skippable except the first two:

1. **Identity:** name, timezone, community join confirmation (via invite link).
2. **Why you're here:** one question, one text field: "What made you say yes to this?" (feeds the coach's first conversation).
3. **Your partner (optional):** partner's name, relationship label (wife, husband, partner, girlfriend, boyfriend, fiancee), her birthdate, your wedding or anniversary date, and "a few things you love most about her" (3 prompted free-text entries). Copy adapts to the chosen label throughout the app. A man who skips this can add it anytime from his profile, and the coach will eventually ask.
4. **Your kids (optional):** name, date of birth, and a few things you love most about each, repeatable per child.
5. **First quarterly goal:** pick a pillar, write the goal.
6. **First mission:** behavior plus day, with the coach's concreteness gate active from minute one.
7. **First check-in:** log today before leaving onboarding, so day one is never a zero.

Steps 3 and 4 are deliberately framed as reflection, not data entry: "What do you love most about her?" is the same generative move used in session design. The answers are stored verbatim and become coach material.

### 12.2 Why the family layer matters mechanically

Partner and child birthdates plus the anniversary date convert directly into the mission engine: "Sarah's birthday is in three weeks. What's the mission?" and day-of nudges ("Anniversary is Thursday. You knew this."). The things-he-loves lists give the coach specific, personal material so its Bond and Raise coaching is never generic. This data is the difference between a coach that says "plan something for your wife" and one that says "you wrote that you love how she makes strangers feel welcome. Build the date around that."

### 12.3 The Partner Connection Survey

A repeatable 15-question survey the man completes **with** his partner: he asks, she answers, he records her score and her words. This is by design a structured conversation, not a link she fills out alone; the sit-down is itself the intervention, consistent with conversation-as-meaning-making. (A send-her-a-link mode can come later if demand appears, but Phase 1 ships the guided conversation only.)

Mechanics:

- Each question scored 1 to 5 (5 best), with a **notes field beside every question** for her words verbatim.
- Repeatable without limit; suggested cadence quarterly, surfaced by the coach ("It's been 90 days since the last survey. Time to sit down with her.").
- **Delta view is the product's ROI proof:** per-question trend lines and a composite score over time. "Trust moved from 3 to 5 in six months" is the testimonial engine and the retention argument for the whole subscription. The composite delta appears on the man's own dashboard, never on any community surface.
- Question set is versioned (`survey_question_sets`) so wording can be refined without corrupting historical comparability.

Seed question set (v1), with light grammatical cleanup from the source list (edits marked):

1. How well do I truly know you?
2. How respected do you feel by me?
3. How vulnerable do you think I am with you?
4. How safe do you feel being vulnerable with me?
5. How much trust do you have in me?
6. How well do I receive constructive criticism from you? *(edited from "How able am I able to hear constructive criticism for you")*
7. How well do I express empathy toward you?
8. How well do I prioritize being kind to you? *(edited from "How do I prioritize")*
9. How well do I respect your boundaries?
10. How committed do you believe I am to you? *(edited from "How committed to you believe I am to you")*
11. How thoughtful am I toward you?
12. How well do I express my appreciation for you?
13. How well do I understand all the unseen work you do for our family?
14. How well do I support you when you need it most?
15. How good am I at following through on my commitments?

### 12.4 Privacy rules for the family layer (hard requirements)

1. Partner profiles, children, and all survey data are **never visible to the community, the leaderboard, or community leaders**. Row Level Security scopes these tables to the owning user only. This is a woman's candid assessment of her husband recorded in his app; anything less than full privacy would poison the survey's honesty and the product's trust.
2. The **coach may read** partner/child profiles and survey scores and notes for context; this is disclosed plainly in onboarding ("Your coach sees what you save here. Your group never does.").
3. Survey data is excluded from community digests, admin dashboards, and any identifiable reporting. Platform-level reporting may use fully anonymized aggregates only (e.g., average composite delta across the platform, for marketing claims), and this use is disclosed.
4. Data export and deletion: a man can export or delete his family-layer data independently of his tracking data.

---

## Appendix A: Spreadsheet Importer Specification

Source file: `DAD_EDGE_BRAVEMAN_TRACKING_2026-2.xlsx` (repo root). The workbook has already been structurally analyzed; the parsing map below is verified against the actual file, so the importer should be built to this spec rather than rediscovered.

### A.1 Workbook layout

- One `SCORECARD` sheet (formulas only, all values derived from daily sheets: **do not import from it except the roster block below**).
- One `Daily - {name}` sheet per man (roughly 55 sheets).
- One `Blank Template to Duplicate` sheet: **skip**.

### A.2 Roster (from SCORECARD)

Columns C onward: row 3 = first name, row 4 = last name, row 6 = **exact daily sheet name** (the join key), row 7 = phone. Build the user list from this block, matching each entry to its `Daily - {sheet name}` tab. Emails are not in the workbook; import creates users in a pending state and emails are attached at invite time.

### A.3 Daily sheet structure (standard 20 to 21 column sheets)

Weekly blocks repeat every **19 rows**, first block starting at row 3. Read with `openpyxl` `data_only=True` (cached values are present).

For a block starting at row `r` (r = 3, 22, 41, ...):

| Content | Location |
|---|---|
| Week start date | `B{r}` (first block is a literal date, Monday 2026-01-05; later blocks are `=+7` formulas, so **compute** week dates as `start + 7 * blockIndex` rather than trusting cached values) |
| Intensive week flag | text "INTENSIVE WEEK" near `C{r}` (block 1 only in current file) |
| Pillar day grid | rows `r+3` (B), `r+4` (R), `r+5` (A), `r+6` (V), `r+7` (E), then a 3-row gap, `r+11` (M), `r+12` (Action), `r+13` (N); days Monday to Sunday in columns B through H |
| Quarterly goals | `K{r+2}`, `K{r+7}`, `K{r+12}` in the first block (text); later blocks carry them forward via formulas, so parse goals from the first block where the text literally appears |
| Mission rows | 15 rows, `r+2` through `r+16`: description col M, Completed? (Yes/No) col S, computed point col T. Goal grouping: first 5 rows belong to goal 1, next 5 to goal 2, last 5 to goal 3 |

### A.4 Import rules

1. **Blank vs. zero is preserved.** A blank pillar cell imports as no row (not logged); an explicit 0 imports as a check-in with value 0. This distinction is a core fix over the spreadsheet and must not be flattened at import time.
2. **Do not import the Action row as check-ins.** In the source, Action is partly derived from mission points (`H` cell is `=SUM(T...)`). Missions import separately; the app computes mission scoring from mission records. Manually entered Monday-to-Saturday Action cells, where present, are imported as check-ins; the Sunday formula cell is skipped.
3. **Missions import as week-scoped legacy records.** The spreadsheet has no target day, so imported missions get `target_date` = the Sunday of their week and a `legacy_import` flag. Completed = Yes maps to `completed`; No on a past week maps to `missed`. Rollover chains cannot be reconstructed from text reliably; do not attempt.
4. **Empty mission rows (no description) are skipped** even though the source shows "No" in the Completed column; the No is just the dropdown default.
5. **Idempotent by natural key** (`user + date + pillar`, `user + week + mission description`). Re-running the importer must not duplicate.
6. **Dry-run mode first**: produce a per-sheet report (weeks found, check-ins, missions, goals, warnings) for human review before writing.
7. **Post-import validation**: recompute each man's weekly totals from imported data and diff against the SCORECARD's cached values; report mismatches instead of silently accepting them.

### A.5 Drifted sheets (must be handled explicitly)

Four sheets deviate from the template because the mission block was duplicated or shifted sideways:

- `Daily - Steve W` (32 columns): a second full mission block lives at columns W through AF (goal col W, mission # col X, description col Y, Completed col AE, point col AF), including a goal category ("Anchor") that does not exist in the standard framework and at least one hand-typed lowercase formula.
- `Daily - Tim C`, `Daily - John Y`, `Daily - Parker B` (26 columns): mission block shifted or extended into columns beyond U.

**Rule:** the importer must locate mission blocks by header text ("Mission Description", "Completed? (Y/N)") scanned across each sheet's columns, not by fixed column positions. Nonstandard goal categories import as goal text verbatim. Each drifted sheet gets an individual line in the dry-run report for manual review before commit.
