# BRAVE MAN OS

Multi-community accountability app for the BRAVE MAN framework: daily check-ins, weekly missions, quarterly goals, a coach, the ITC improvement-map tool, and the Resource Library. Next.js 15 (App Router) + TypeScript, Supabase (Postgres with row-level security), deployed on Vercel from `main`.

## Where things are written down

- `PRODUCT_SPEC.md`: what the app IS today (routes, data model, rules). Update it in the same PR as the behaviour.
- `DECISIONS.md`: judgment calls and why.
- `docs/coach-voice-and-tone.md` and `docs/app-voice-adaptation.md`: voice rules for every user-facing string. Check the banned lists before shipping copy.
- `docs/failure-modes.md`: one entry per incident and the check it produced. Comments cite entries as `FM-n`.

## Ground rules

- **"Gates green" means CI, and the run is linked.** A local typecheck, lint or test run is "local green": useful while working, never evidence.
- **Every report and PR description carries three lines:**
  ```
  Gates: CI green, <run link>
  Probes: <n> pass, <n> fail (<which probe was red first>)
  Docs:  <which doc and section updated>, or "exempt: <reason>"
  ```
- **A test that has only ever been green proves little.** For a new regression test or probe, show it failing against the old code first, then passing, and say so in the report.
- **Never write to a production database from a test, script or seed.** Any script that can write somewhere real refuses unless the target is the dev or test database, checked by project id or host (`assertDevTarget()` in `scripts/lib/target.ts`), never by a flag. The one approved exception: `npm run help:generate` writes unreviewed rows to the production help review queue (Jason, 2026-10-15). Production data fixes ship as migrations.

## Documentation

- **A PR that changes behaviour, permissions or operational procedure updates the docs in the same PR.** The docs gate (`.github/workflows/docs.yml`) fails a PR that changes `src/` with no doc change and no `Docs-exempt: <reason>` line in its description.
- `PRODUCT_SPEC.md` describes what IS, not plans. Judgment calls go in `DECISIONS.md`; incidents in `docs/failure-modes.md`.
- User help covers only what a member does on screen, never how it works underneath. It's generated from the page's controls (`npm run help:extract`, then `help:check-stale`), not written by hand.

## Databases

- Localhost and every script use the dev project ("Brave Man OS Dev") through `.env.local`. Production keys live only in Vercel and in `.env.prod.local` (gitignored, never loaded by Next).
- Run the dev server in UTC to match Vercel: `TZ=UTC npm run dev` (FM-4).

## Permissions

- The app's access rules are Postgres row-level security. `npm run rls:hazards` runs them as real members on the dev database inside one transaction that always rolls back (local only; needs `supabase login` and the CLI linked to dev).
- **A permission widening ships with its policy change and a probe in `scripts/rls-hazards.ts` in the same PR, shown red before the fix.** Probe an unlanded migration with `npm run rls:hazards -- --pending supabase/migrations/<file>.sql`.

## Migrations

- **Migrations reach a database only through `npm run db:migrate`,** never raw SQL, the SQL editor, or `supabase db push`. It keeps a ledger and applies only what's missing, each file in its own transaction.
- Dev first: `npm run db:migrate -- --target dev --dry-run`, then without `--dry-run`. Check the permission probes with `--pending` before that.
- **Any run against production is Jason's to approve, every run, even after a clean dry run.** It needs the CLI linked to production and the production project id typed (or `MIGRATE_PROD_CONFIRM` set only after his approval in chat). Relink the CLI to dev afterwards.

## Commands

| | |
|---|---|
| `npm run typecheck` / `npm run lint` | TypeScript; ESLint (errors fail, warnings print) |
| `npm test` | Unit tests: no database, no model calls. What CI runs. |
| `npm run test:live` | Integration tests (dev database) and live LLM regressions. Local only. |
| `npm run build` | Production build. CI's last and required step. |
| `npm run help:check-manifests` | Fails if a page's controls changed without re-extracting its help manifest. |
| `npm run rls:hazards` | Permission probes on dev (local only). |
| `npm run db:migrate -- --target dev [--dry-run]` | Apply pending migrations with a ledger. |
| `npm run seed:e2e` / `npm run e2e` | Browser-test accounts on dev; Playwright (local only, see `docs/e2e.md`). |

## Tests

- Vitest, Node environment. New tests go beside the code they cover (`foo.test.ts` next to `foo.ts`); the older suites live in `__tests__/` folders and stay there.
- Rules that span files are source guards (`src/source-guards.test.ts`): read the source, assert with a regex. If one fails, fix the code, not the regex.
- Every script runs `main()` only inside `if (isEntryPoint(import.meta.url))` and reads its environment inside `main()`, so importing a script never runs it (`scripts/entry-points.test.ts`, FM-8).
