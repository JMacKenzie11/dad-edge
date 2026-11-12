/**
 * Match the community a prompt names ("the Austin group", "austin")
 * to one community. Exact slug or name first, then a unique partial
 * match. Never guesses between two: the caller gets the choices back.
 */

export type CommunityChoice = { id: string; name: string; slug: string };

export type Resolution =
  | { kind: "match"; community: CommunityChoice }
  | { kind: "ambiguous"; choices: CommunityChoice[] }
  | { kind: "none"; choices: CommunityChoice[] };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(the|community|group|brotherhood)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveCommunity(query: string, communities: CommunityChoice[]): Resolution {
  const q = query.trim().toLowerCase();
  const exact = communities.filter((c) => c.slug.toLowerCase() === q || c.name.toLowerCase() === q);
  if (exact.length === 1) return { kind: "match", community: exact[0] };

  const nq = norm(query);
  if (!nq) return { kind: "none", choices: communities };
  const loose = communities.filter((c) => norm(c.name) === nq || norm(c.slug) === nq);
  if (loose.length === 1) return { kind: "match", community: loose[0] };
  if (loose.length > 1) return { kind: "ambiguous", choices: loose };

  const partial = communities.filter((c) => norm(c.name).includes(nq) || norm(c.slug).includes(nq));
  if (partial.length === 1) return { kind: "match", community: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", choices: partial };
  return { kind: "none", choices: communities };
}

export type KeyResolution = Resolution | { kind: "not_allowed"; community: CommunityChoice; choices: CommunityChoice[] };

/**
 * Resolve for an API key that may cover only some communities. The name
 * is matched against EVERY community first, so asking for one the key
 * can't read is refused rather than landing on a lookalike it can read
 * ("basecamp" must never return "E2E Basecamp"'s men). Choices offered
 * back are only the ones the key covers.
 */
export function resolveForKey(query: string, all: CommunityChoice[], allowed: (id: string) => boolean): KeyResolution {
  const covered = all.filter((c) => allowed(c.id));
  const r = resolveCommunity(query, all);
  if (r.kind === "match") {
    return allowed(r.community.id) ? r : { kind: "not_allowed", community: r.community, choices: covered };
  }
  if (r.kind === "ambiguous") {
    const mine = r.choices.filter((c) => allowed(c.id));
    return mine.length > 0 ? { kind: "ambiguous", choices: mine } : { kind: "none", choices: covered };
  }
  return { kind: "none", choices: covered };
}
