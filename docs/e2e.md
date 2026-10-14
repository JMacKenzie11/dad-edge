# Browser tests (Playwright)

Local only for now, against the **dev** database. They aren't in CI yet because browser tests are the flakiest gate; once they've been green across a few PRs they get their own CI job, separate from typecheck, lint and units.

## Run them

```bash
npm run seed:e2e   # once, and after any dev database refresh
npm run e2e        # starts the dev server on :3300 in UTC if it isn't running
```

`playwright.config.ts` loads `.env.local` itself and refuses to run unless it points at the dev database. Only Chromium is installed (`npx playwright install chromium`). A failed run leaves a trace and a screenshot in `test-results/`; `npx playwright show-report` opens the HTML report.

## Fixture accounts

`npm run seed:e2e` creates (or resets) these on dev. All use `@braveman.test` addresses, so no mail reaches anyone.

| Role | Email | What it's for |
|---|---|---|
| member | `e2e-member@braveman.test` | An ordinary member of "E2E Basecamp" with one Vitality goal and exactly two Bond missions this week, so the "no third Bond slot" check has something to check. |
| leader | `e2e-leader@braveman.test` | Leader of the same community: the `/leader` surfaces. |
| admin | `e2e-admin@braveman.test` | Platform admin: `/admin`, course editing, preview-as-member. Admins are auto-added to every community. |
| coachee | `e2e-coachee@braveman.test` | Member with improvement-map (ITC) access and no map yet: `/itc`. |

The specs sign in through `e2e/fixtures.ts`, which reads `E2E_<ROLE>_EMAIL` and `E2E_<ROLE>_PASSWORD` from `.env.local`. If one is missing, the test fails naming the variable. The seed prints those lines whenever it has to make up a password; copy them into `.env.local`.

The seed also makes sure a published "E2E Course" exists, visible to all communities.

## After a database refresh

If dev is rebuilt (see CLAUDE.md, Databases), the accounts are gone. Run `npm run seed:e2e` again. It reuses the passwords already in `.env.local`, so nothing else changes.

## What counts as a clean run

Zero failures. Or, for each failure, a short note showing it's unrelated to the change (for example a Vimeo embed that didn't load), and Jason approves that note. "It passed on retry" is not a clean run; the config doesn't retry on purpose.

## Writing a new spec

- Use the role fixtures (`asMember`, `asLeader`, `asAdmin`, `asCoachee`), not a fresh sign-in.
- A "can't see it" check needs a control beside it (the Bond check counts the Raise row's buttons first), so a zero can't pass because the selector found nothing.
- Show the spec failing once before it counts (CLAUDE.md, Ground rules).
- Anything new a spec needs goes in `scripts/seed-e2e.ts`, which must stay safe to rerun.
