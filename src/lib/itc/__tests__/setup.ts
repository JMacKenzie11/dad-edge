// Load .env.local so ANTHROPIC_API_KEY is available in tests.
// Behavior tests hit the real API; state-machine tests don't need this
// but the load is idempotent + cheap so it's fine to run for all suites.
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

if (!process.env.ANTHROPIC_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[test setup] ANTHROPIC_API_KEY not set — behavior tests will fail. " +
      "Add it to .env.local to run coach tests.",
  );
}
