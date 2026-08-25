import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: [
      "src/**/__tests__/**/*.test.ts",
      // Form-First regression tests live here.
      "tests/form-first/**/*.test.ts",
      // Coach context pipeline unit tests.
      "tests/coach/**/*.test.ts",
      // Integration tests — hit real dev Supabase to verify RLS +
      // boundary behavior. Slower than units; skip if the required
      // env vars aren't present (see helpers/supabase.ts).
      "tests/integration/**/*.test.ts",
    ],
    // Behavior tests hit the Anthropic API — slower than unit tests but
    // still bounded. State-machine tests are fast because they mock the LLM.
    testTimeout: 180_000,
    hookTimeout: 30_000,
    // Retry LLM-backed tests up to 2 extra times on failure. Coach
    // behavior is stochastic at temperature 1; a single flake shouldn't
    // fail the suite. If a scenario fails all 3 attempts it's a real
    // regression, not variance.
    retry: 2,
    // Load .env.local so ANTHROPIC_API_KEY etc. are available in tests
    // without requiring a separate test env file.
    setupFiles: ["src/lib/itc/__tests__/setup.ts"],
    // Vitest reporter — verbose so scenario-level pass/fail is visible.
    reporters: ["verbose"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
