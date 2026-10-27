# Failure modes

One short entry per incident: what happened, why the gates missed it, and the rule or check it produced. Code comments cite entries by id (`FM-n`). Add new entries at the bottom; never renumber.

---

## FM-1: Missions saved as Bond without anyone choosing Bond

- **What happened:** the weekly planner shipped 2026-08-31 with a "BRAVE MAN MISSIONS" section that never asked for a pillar and stamped every mission Bond. 67 missions from 4 men carried a placeholder pillar for six weeks. Found by the restructure dry run, 2026-10-14.
- **Why the gates missed it:** no gate existed. The value was valid (`B` is a real pillar), so nothing downstream failed; only a human reading the data would notice.
- **What it produced:** a read-only dry-run report before any data restructure (`npm run migrate:mission-structure`), and the "Earlier missions" list so the placeholders never fill the Bond row.

## FM-2: A refused action that said nothing

- **What happened:** → NEXT WEEK on a mission discarded the server's error, so a refused carry-forward did nothing visible. Separately, mission write paths returned raw Postgres messages.
- **Why the gates missed it:** no test exercised a refusal path, and the trigger's messages weren't designed to be read by a member.
- **What it produced:** the trigger raises a machine-readable DETAIL code and `friendlyMissionError()` writes the words; the source guard "every file that inserts missions translates refusals" (`src/source-guards.test.ts`).

## FM-3: Vimeo showcase links picked the wrong video

- **What happened:** `parseVimeoUrl` took the first number in the path, which for `/showcase/<id>/video/<id>` is the showcase.
- **Why the gates missed it:** it didn't; the unit test caught it before the code shipped. Kept here as the example of a table-driven URL test earning its place.
- **What it produced:** the showcase case in `src/lib/resources/__tests__/resources.test.ts`.

## FM-4: Week dates a day early on a Mac in Eastern time

- **What happened:** `weekDates()` builds dates at UTC midnight and formats them in the server's local zone. On Vercel (UTC) that's correct; on a Mac in Eastern time every date shifts back a day, so the missions page dropped Sunday and showed "Oct 12 – Oct 17".
- **Why the gates missed it:** production and CI both run in UTC, so only local runs show it, and it looks like a real bug when you see it.
- **What it produced:** the dev server runs as `TZ=UTC npm run dev` (CLAUDE.md), and Playwright starts it the same way.

## FM-5: README told you to `db push` with no migration ledger

- **What happened:** migrations were applied by hand, so neither database records which ran. The README's `supabase db push` would have tried to rerun all 64 migrations against whatever project was linked.
- **Why the gates missed it:** nothing ever ran the documented command.
- **What it produced:** `npm run db:migrate` with a ledger in `supabase_migrations.schema_migrations`, `--dry-run`, and `--baseline` to record what was applied by hand; the README now points there; production runs are approved every time (CLAUDE.md, Migrations).

## FM-6: Members could open message threads across communities

- **What happened:** the `message_threads` insert policy checked shared community membership with an inline subquery that ran under the caller's own row-level security, so it could never see the other member's rows and the check didn't do what it said (fixed in `20260828000002`).
- **Why the gates missed it:** no test ran the policy as a real member against a member of another community.
- **What it produced:** the SECURITY DEFINER rule in PRODUCT_SPEC §4, the messaging integration test, and the permission probes (`npm run rls:hazards`, probe T2), with the rule that a widening ships with a probe shown red first.

## FM-7: Lint had never run

- **What happened:** `npm run lint` was `next lint`, which with no ESLint config only prompts for setup. 42 errors had accumulated (mostly unescaped apostrophes, plus `require()` in tests and an `<a>` that should have been a `<Link>`).
- **Why the gates missed it:** there was no CI, and the command "worked" locally by printing a prompt.
- **What it produced:** `eslint.config.mjs` with Next's rules and the lint step in `.github/workflows/checks.yml`.

## FM-8: Importing a script ran it

- **What happened:** all 16 scripts called `main()` at the bottom of the file, and 9 read the environment, exited, or opened a database client at import time. A test importing one for a helper would have run a seed or a backfill.
- **Why the gates missed it:** no test imported a script.
- **What it produced:** `isEntryPoint(import.meta.url)` in `scripts/lib/entry.ts`, environment reads moved into `main()`, and `scripts/entry-points.test.ts` (shown red against the old scripts: 16 unguarded calls, 9 import-time side effects).

## FM-9: Help manifests could drift from the UI unnoticed

- **What happened:** manifests recorded absolute paths from one Mac and depended on filesystem order, so they couldn't be compared across machines, and nothing checked that a UI change re-extracted them. Help could describe buttons that no longer exist.
- **Why the gates missed it:** staleness was only checked by hand, against the database, after shipping.
- **What it produced:** repo-relative paths and sorted directory reads in the extractor, and `npm run help:check-manifests` in CI.

## FM-10: A browser test that passed because its selector found nothing

- **What happened:** the first version of "a member with two Bond missions isn't offered a third" asserted zero buttons named "+ ADD A BOND MISSION". The buttons' accessible name is different ("add a bond mission, slot 1"), so the check found zero whether or not the buttons were there.
- **Why the gates missed it:** a "find nothing" assertion is green by default; it only went red when its partner check (two Raise buttons) failed for the same reason.
- **What it produced:** every "can't see it" check in a spec or a probe has a control beside it that must find something (docs/e2e.md; `judge()` in scripts/rls-hazards.ts fails a zero whose control is also zero).

## FM-11: The build downloads fonts from Google, and that download can fail

- **What happened:** a CI build failed in `src/lib/fonts.ts` with `next/font` "Cannot read properties of null (reading '1')": `next/font/google` fetches Archivo and Inter from Google Fonts at build time, and the response it got wasn't the CSS it expected. A rerun of the same commit passed (PR #3, 2026-10-15).
- **Why the gates missed it:** they didn't; the build step caught it. It's here because it's a flake that isn't about the code, and a red build should first be checked against this entry before anyone debugs the diff.
- **What it produced:** so far, this entry and a rerun. The lasting fix is to self-host the two fonts (`next/font/local`), which `src/lib/fonts.ts` already anticipates for the Adobe fonts. Open for Jason.

## FM-12: The permission probes refused any migration that defines a function

- **What happened:** `npm run rls:hazards -- --pending` refuses a migration that commits its own transaction, by looking for a line that is just `commit;` or `end;`. The course sections migration defines a PL/pgSQL function, whose body ends with `end;`, so the probes refused to run it at all (2026-10-16).
- **Why the gates missed it:** no earlier migration probed with `--pending` had a function body ending on its own line.
- **What it produced:** `commitsOwnTransaction()` in `scripts/rls-hazards.ts` ignores dollar-quoted bodies and comments before looking, with a test in `scripts/rls-hazards.test.ts` (red against the old check, then green) that still refuses a real top-level `commit;`.

## FM-13: Regenerating help added a copy instead of replacing the row

- **What happened:** `help:generate` writes with "insert, or update on conflict with (route_pattern, view_key, role)". Almost every page has `view_key` null, and a plain `UNIQUE` treats two nulls as different, so the conflict never fired and each run added another row. Production had 78 rows for 65 pages, with duplicates on 12 of them; six pages had two approved copies, and the help widget (`reviewed = true`, `limit 1`, no order) could show either. Found 2026-10-16 when regenerated course help still showed as stale.
- **Why the gates missed it:** nothing checked the database after a generate run; the script reported "ok" because the insert succeeded.
- **What it produced:** migration `20261016000002_help_content_one_row_per_page.sql` (keep the newest row per page, then `UNIQUE NULLS NOT DISTINCT`), and `tests/integration/help-content-upsert.test.ts`, which writes the same page twice through the generator's own `upsertHelpContent()` and expects one row (red on dev before the migration, green after). Rule of thumb: a unique key over a nullable column needs `NULLS NOT DISTINCT` or it isn't unique.

## FM-14: A tab left open across a deploy crashed after a save

- **What happened:** Jason added JT Edgren to a community from a tab he'd loaded at 9:10 am, four deploys earlier (2026-10-15, 15:30 UTC). Vercel's skew protection sent the save to that older deploy, which saved the membership and logged it in about a second. The page's follow-up request was answered by the current deploy, and the old code in the tab couldn't render it, so the tab crashed into Next's bare "Application error" screen. No server error was logged; the membership was there all along. The same logs showed `/icon` and `/apple-icon` throwing ENOENT on every regeneration, because they read `public/brand/mark-white.png` at runtime and Vercel doesn't ship `public/` to server functions. Browsers kept getting a cached copy, so nobody saw a broken icon.
- **Why the gates missed it:** every test loads the page and acts on the same build, so a version mix never happens in CI or on dev. The icon routes work locally, where `public/` is on disk.
- **What it produced:** an error screen (`src/components/app-error.tsx`, wired through `src/app/error.tsx` and `src/app/global-error.tsx`) that reloads the tab once by itself before showing "This page didn't load." with a RELOAD button. Its reload-once rule has a test in `src/lib/errors/reload-once.test.ts`. The app icons are now static PNGs in `src/app/`, and a source guard in `src/source-guards.test.ts` fails any `src/app` file that reads `public/` with `fs` (red against the old icon routes, then green). Rule of thumb: on Vercel, a file a server route needs at runtime must be imported, traced (`outputFileTracingIncludes`), or served statically, never read from `public/`.

## FM-15: Coach Larry ignored his own rules on address and on "the business"

- **What happened:** on the first day of the Larry voice (2026-10-27), Larry called Jason "brother" or "man" in three replies in a row and asked whether it was "home, the business, or everything". The voice guide already said "at most once per reply, and plenty of replies without any"; nothing told it to say "business", and the profile's "Business owner" did. Sampling showed 15 of 16 first replies addressing him, and 3 of 8 saying "the business" with "Business owner" on file. Adding a written rule to the voice guide only moved that to 2 of 8 (4 of 6 in the full conversation).
- **Why the gates missed it:** the unit tests check what the prompt says, not what the model does, and the comparison set's member had a W2 job on file and no run looked at address terms across turns.
- **What it produced:** `src/lib/coach/address.ts`, which decides each turn how Larry addresses him and whether to say "work", and puts that in the system prompt, with tests in `src/lib/coach/address.test.ts` (red before the module existed). Re-running Jason's conversation six times: "Jason" in every first reply, no name, "brother" or "man" in the next three, "business" in 0 of 24 replies. The comparison set gained a "struggling, no work on file" situation and flags any mention of a business. Rule of thumb: a "sparingly" or "only when" rule for an LLM belongs to the server, which can count.
