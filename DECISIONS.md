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
