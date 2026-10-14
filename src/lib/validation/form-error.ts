import type { ZodErrorMap, ZodTypeAny, output } from "zod";

/**
 * Shown when a check fails that the man can't fix by rewording —
 * a missing or malformed id, a bad date string. In practice that
 * means the page he's looking at no longer matches the database.
 */
export const STALE_PAGE = "This page is out of date. Refresh and try again.";

// Messages written on the schema (`.min(4, "...")`) win over this
// map, so it only catches the checks we didn't write copy for.
const staleErrorMap: ZodErrorMap = () => ({ message: STALE_PAGE });

/**
 * safeParse that returns the first failing check's message, ready to
 * show on screen. Schemas carry the copy for anything a man types;
 * everything else falls back to STALE_PAGE.
 */
export function parseForm<S extends ZodTypeAny>(
  schema: S,
  input: unknown,
): { ok: true; data: output<S> } | { ok: false; error: string } {
  const parsed = schema.safeParse(input, { errorMap: staleErrorMap });
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? STALE_PAGE };
}
