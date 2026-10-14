/**
 * Where a script or test is allowed to write.
 *
 * Ground rule (CLAUDE.md): nothing writes to the production database from a
 * test, script or seed. The check is by Supabase project id (or a local
 * host), never by a flag, so a stray `--force` or a copied .env can't talk
 * a seed into production.
 *
 * Allowlist, not denylist: anything that isn't the dev project or a local
 * Supabase is refused, so a brand-new project can't slip through until it
 * has been added here on purpose.
 *
 * The one approved exception is help generation (`help:generate`), which
 * writes unreviewed rows to the production help_content review queue by
 * design (Jason, 2026-10-15). It doesn't call this guard.
 */

/** Production. Only this module may name it (source-guard test). */
export const PROD_PROJECT_REF = "tybupnroikeqbqdfjaql";
/** "Brave Man OS Dev". Add a test project here when one exists. */
export const DEV_PROJECT_REFS: readonly string[] = ["smajfcsctkwwrmsshzjz"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type Target = { kind: "dev"; ref: string } | { kind: "local"; host: string };

/** "https://<ref>.supabase.co" → "<ref>". Null for anything else. */
export function projectRefFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function classifyTarget(url: string | undefined | null): Target | { kind: "refused"; reason: string } {
  if (!url) return { kind: "refused", reason: "NEXT_PUBLIC_SUPABASE_URL is not set." };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { kind: "refused", reason: `"${url}" isn't a URL.` };
  }
  if (LOCAL_HOSTS.has(host)) return { kind: "local", host };
  const ref = projectRefFromUrl(url);
  if (ref === PROD_PROJECT_REF) return { kind: "refused", reason: "That's the production database." };
  if (ref && DEV_PROJECT_REFS.includes(ref)) return { kind: "dev", ref };
  return { kind: "refused", reason: `Project ${ref ?? host} isn't a known dev or test database.` };
}

/** Throws unless the URL is the dev project or a local Supabase. */
export function assertDevTarget(url: string | undefined | null = process.env.NEXT_PUBLIC_SUPABASE_URL): Target {
  const t = classifyTarget(url);
  if (t.kind === "refused") {
    throw new Error(
      `Refusing to write: ${t.reason} This only runs against the dev database (see scripts/lib/target.ts and CLAUDE.md).`,
    );
  }
  return t;
}
