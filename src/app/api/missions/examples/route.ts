import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getExamplesForPillar } from "@/lib/mission-examples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
});

/**
 * Returns curated seed examples + any real missions promoted to exemplar for
 * this pillar. RLS lets the requester see exemplars from members of their own
 * community; platform admins see all exemplars via the shares_active_community
 * policy that already covers missions.
 */
export async function GET(req: NextRequest) {
  await requireAccess();
  const url = req.nextUrl;
  const parsed = Query.safeParse({ pillar_code: url.searchParams.get("pillar_code") });
  if (!parsed.success) return NextResponse.json({ error: "Bad input." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: real } = await supabase
    .from("missions")
    .select("id, description, exemplar_text")
    .eq("pillar_code", parsed.data.pillar_code)
    .eq("is_exemplar", true)
    .limit(20);

  const seed = getExamplesForPillar(parsed.data.pillar_code);
  const promotedAll = ((real ?? []) as {
    id: string;
    description: string;
    exemplar_text: string | null;
  }[]).map((r) => (r.exemplar_text && r.exemplar_text.trim()) || r.description);

  // Dedupe: collapse near-duplicates by their first-4 significant words.
  // Prefer keeping the SHORTER version of any cluster. Applies across the
  // combined seed + promoted list so we don't show near-clones side by side.
  const seen = new Map<string, string>(); // signature → chosen text
  const keep = (list: string[]) => {
    for (const t of list) {
      const sig = signature(t);
      const prior = seen.get(sig);
      if (!prior || t.length < prior.length) seen.set(sig, t);
    }
  };
  keep(seed);
  keep(promotedAll);
  const promotedSet = new Set(promotedAll);
  const seedSet = new Set(seed);
  const chosen = Array.from(seen.values());
  const promoted = chosen.filter((t) => promotedSet.has(t));
  const seedFinal = chosen.filter((t) => seedSet.has(t) && !promotedSet.has(t));
  return NextResponse.json({ seed: seedFinal, promoted });
}

const STOPWORDS = new Set([
  "the", "a", "an", "my", "your", "our", "his", "her", "their",
  "of", "to", "in", "on", "at", "for", "by", "with", "and", "or", "no", "not",
]);

function signature(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .slice(0, 4)
    .join(" ");
}
