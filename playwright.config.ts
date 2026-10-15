import { defineConfig, devices } from "@playwright/test";
import { classifyTarget } from "./scripts/lib/target";

/**
 * Browser tests. LOCAL ONLY for now, against the dev database.
 *
 * Why not in CI yet: browser tests are the flakiest gate (timing, the dev
 * server's first compile, a third-party embed). In the same job as
 * typecheck, lint and units, one flake would block all of them. Once these
 * have been green across a few PRs, they get their own CI job (with a dev
 * database and the E2E_* accounts as secrets), so a flake there can't hold
 * up the other gates.
 *
 * Run: npm run e2e        Setup and accounts: docs/e2e.md
 */

// Load .env.local ourselves so `npx playwright test` works without a wrapper.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the fixtures say which variable is missing.
}

// The specs sign in as fixture accounts that exist only on dev; pointed at
// anything else they'd fail confusingly, or worse, touch real data.
const target = classifyTarget(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (target.kind === "refused") {
  throw new Error(`Browser tests run against the dev database only. ${target.reason} See docs/e2e.md.`);
}

const PORT = 3300;

export default defineConfig({
  testDir: "e2e",
  // One worker: the specs share fixture accounts and the dev server.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // UTC to match Vercel; in Eastern time week dates shift a day (FM-4).
    command: "TZ=UTC npm run dev",
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
