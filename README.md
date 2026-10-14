# BRAVE MAN OS

Multi-community accountability platform. Phase 1 build in progress.

Spec: [`braveman-app-build-config.md`](./braveman-app-build-config.md) — authoritative.
Decisions log: [`DECISIONS.md`](./DECISIONS.md).

## Quick start

```bash
npm install
cp .env.example .env.local
# fill in the DEV Supabase URL + keys (see CLAUDE.md, Databases)
TZ=UTC npm run dev
# open http://localhost:3300/design to see the brand component library
```

## Migrations

Migrations live in [`supabase/migrations/`](./supabase/migrations) as timestamped SQL files. They reach a database only through the migration command, which keeps a ledger of what ran:

```bash
npm run db:migrate -- --target dev --dry-run   # list what's pending, apply nothing
npm run db:migrate -- --target dev             # apply it to the dev database
```

Production runs are approved by Jason every time; see `CLAUDE.md`, Migrations. Don't use `supabase db push`: these databases were migrated by hand before the ledger existed, so `db push` would try to rerun everything (`docs/failure-modes.md`, FM-5).

## Repository layout

```
src/
  app/
    (app)/                     member surfaces
    (leader)/                  community leader tools
    (admin)/                   platform admin
    api/                       webhooks + coach endpoints (Phase 2+)
    design/                    dev-only component library
    layout.tsx, page.tsx, globals.css
  components/ui/               brand-tokened primitives
  lib/
    supabase/{server,browser,service}.ts
    entitlement.ts             the single access gate (§5)
    pillars.ts                 pillar framework v1
    fonts.ts                   Archivo/Inter fallbacks; swap for Adobe Fonts later
    cn.ts
supabase/
  migrations/                  timestamped SQL files
  config.toml
public/brand/                  web-optimized brand assets
scripts/                       seed + spreadsheet importer (Checkpoint D)
```

## Checkpoint status

- [x] **A.** Migrations authored, brand tokens live, `/design` route renders the branded component library.
- [x] **B.** Auth (magic link) + dark shell + `/today` check-in + `/missions` with concreteness gate + `/goals` + seed script.
- [x] **C.** `/community` scorecards + `/community/leaderboard` (Weekly/Monthly/Streaks tabs) + 7-step onboarding + Partner Connection Survey with delta view + Me / partner / kids management.
- [ ] **D.** Admin panel + importer dry-run against the real tracker workbook.

## Seeding

Once migrations are applied and `.env.local` has `SUPABASE_SERVICE_ROLE_KEY`:

```bash
npm run seed
```

Creates one community (`basecamp`), six members (comped subscription so the gate lets them in), and 28 days of check-ins + missions + one quarterly goal each. Six member profiles cover the common patterns:

| Member  | Profile   | Behavior                             |
| ------- | --------- | ------------------------------------ |
| Steve W | grinder   | ~85% hit rate, leader role           |
| Tim C   | steady    | ~65% hit rate                        |
| John Y  | cyclic    | alternating strong/off weeks         |
| Parker B| steady    | ~65% hit rate                        |
| Mike R  | slipping  | declining trajectory                 |
| Dave K  | returning | improving week over week             |

Idempotent: safe to re-run.
