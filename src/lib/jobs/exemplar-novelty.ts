import { z } from "zod";
import { generateObject } from "ai";
import { haikuModel } from "@/lib/coach/client";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PILLARS } from "@/lib/pillars";
import type { JobResult } from "@/lib/jobs/utils";

/**
 * Weekly novelty pass over the exemplar library.
 *
 * For each pillar, ask Haiku to identify near-duplicate exemplars and return
 * the mission IDs to demote (is_exemplar = false). Keeps the "See examples"
 * drawer diverse without capping arbitrarily. Also enforces a soft cap of 20
 * exemplars per pillar — oldest reviewed rows get demoted first once we're
 * over that.
 *
 * Runs on Mondays inside the daily cron so we only spend LLM tokens once/week.
 */

const OutSchema = z.object({
  demote_ids: z.array(z.string()),
  keep_ids: z.array(z.string()),
  reasoning: z.string().max(400),
});

const SYSTEM = `You curate a library of example missions shown to men in a coaching app. The library must stay diverse — near-duplicate examples waste the reader's time.

You'll receive a list of exemplar missions for one pillar. Return:
- demote_ids: IDs of missions that are near-duplicates or noticeably weaker versions of a kept one. Be strict — same behavior + same day + same context is a duplicate.
- keep_ids: everything else.
- reasoning: one short sentence naming what patterns you saw.

Prefer keeping the shortest, most concrete version of any duplicate cluster. If in doubt, keep it.`;

const CAP_PER_PILLAR = 20;

export async function runExemplarNovelty(now: Date = new Date()): Promise<JobResult> {
  // Only run on Mondays (UTC) so we don't spend on this daily.
  if (now.getUTCDay() !== 1) {
    return { job: "exemplar-novelty", ok: true, processed: 0, detail: { skipped: "not Monday" } };
  }

  const svc = createSupabaseServiceClient();
  const errors: string[] = [];
  let demoted = 0;
  let reviewed = 0;

  for (const p of PILLARS) {
    if (p.code === "A2") continue;

    const { data: rows } = await svc
      .from("missions")
      .select("id, exemplar_text, description, created_at")
      .eq("pillar_code", p.code)
      .eq("is_exemplar", true)
      .order("created_at", { ascending: false });

    const list = ((rows ?? []) as {
      id: string;
      exemplar_text: string | null;
      description: string;
      created_at: string;
    }[]).map((r) => ({
      id: r.id,
      text: (r.exemplar_text ?? r.description).trim(),
      created_at: r.created_at,
    }));

    if (list.length < 3) continue;
    reviewed += list.length;

    // Ask Haiku to identify near-duplicates.
    let demoteIds: string[] = [];
    try {
      const { object } = await generateObject({
        model: haikuModel(),
        schema: OutSchema,
        system: SYSTEM,
        prompt: `Pillar: ${p.label}\n\nExemplars:\n${list
          .map((r) => `- [${r.id}] ${r.text}`)
          .join("\n")}\n\nReturn JSON only.`,
        maxOutputTokens: 800,
      });
      const idSet = new Set(list.map((r) => r.id));
      demoteIds = object.demote_ids.filter((id) => idSet.has(id));
    } catch (err) {
      errors.push(`novelty:${p.code}:${(err as Error).message}`);
      continue;
    }

    // Enforce soft cap — demote oldest until we're under CAP_PER_PILLAR.
    const keptCount = list.length - demoteIds.length;
    if (keptCount > CAP_PER_PILLAR) {
      const stillKept = list
        .filter((r) => !demoteIds.includes(r.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const overflow = keptCount - CAP_PER_PILLAR;
      for (let i = 0; i < overflow && i < stillKept.length; i++) {
        demoteIds.push(stillKept[i].id);
      }
    }

    if (demoteIds.length > 0) {
      const { error } = await svc
        .from("missions")
        .update({
          is_exemplar: false,
          exemplar_last_review_at: new Date().toISOString(),
        })
        .in("id", demoteIds);
      if (error) errors.push(`update:${p.code}:${error.message}`);
      else demoted += demoteIds.length;
    }

    // Stamp reviewed-at on the kept ones too so we can skip them if we want later.
    const keepIds = list.map((r) => r.id).filter((id) => !demoteIds.includes(id));
    if (keepIds.length > 0) {
      await svc
        .from("missions")
        .update({ exemplar_last_review_at: new Date().toISOString() })
        .in("id", keepIds);
    }
  }

  return {
    job: "exemplar-novelty",
    ok: errors.length === 0,
    processed: reviewed,
    detail: { demoted },
    errors,
  };
}
