import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Behavior tests hit the Anthropic API — slower than unit tests but
    // still bounded. State-machine tests are fast because they mock the LLM.
    testTimeout: 60_000,
    hookTimeout: 30_000,
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
