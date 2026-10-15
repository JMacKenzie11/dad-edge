import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

// Next's standard rules (core web vitals + TypeScript). CI fails on
// errors only; warnings print so they stay visible without blocking.
// See docs/failure-modes.md FM-7: before this file existed, `next lint`
// only prompted for setup, so lint had never run.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".claude/**",
      "next-env.d.ts",
      "scripts/help/manifests/**",
      // Vendored brand and reference material, not app code.
      "Dad Edge Branding Guidelines/**",
      "Assets/**",
      "Phase 1 Build Config/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default config;
