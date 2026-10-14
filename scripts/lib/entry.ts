import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * True only when this module is the file being executed (`tsx scripts/x.ts`),
 * not when a test or another script imports it. Every script wraps its
 * `main()` call in this, so importing a script never runs it; that is
 * what lets tests import a script's pure helpers safely.
 *
 * Compares realpaths, so a symlinked checkout or a relative argv still
 * matches. Under Vitest, argv[1] is the Vitest binary, so this is false.
 */
export function isEntryPoint(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}
