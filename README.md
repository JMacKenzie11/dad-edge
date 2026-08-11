# BRAVE MAN OS

Multi-community accountability platform. Phase 1 build in progress.

Spec: [`braveman-app-build-config.md`](./braveman-app-build-config.md) — authoritative.
Decisions log: [`DECISIONS.md`](./DECISIONS.md).

## Quick start

```bash
npm install
cp .env.example .env.local
# fill in Supabase URL + anon key (see Migrations below)
npm run dev
# open http://localhost:3000/design to see the brand component library
```

## Migrations

Migrations live in [`supabase/migrations/`](./supabase/migrations) as timestamped SQL files.
They implement the full §3 data model, RLS per §12.4, DB-level mission cap trigger,
and seed the pillar framework + Partner Connection Survey v1 questions.

Apply against a **local** Supabase (requires Docker):

```bash
npx supabase start
npx supabase db reset   # runs every migration + seed
# copy the printed anon key + URL into .env.local
```

Apply against a **hosted** Supabase project:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

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
