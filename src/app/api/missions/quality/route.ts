import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseForm } from "@/lib/validation/form-error";
import { requireAccess } from "@/lib/session";
import { scoreMissionDraft } from "@/lib/coach/mission-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The scorer judges the wording of the mission and the day it's set
// for. It is not told which pillar or goal the mission sits under, so
// it has nothing to form an opinion about beyond the writing itself.
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// `target_dates` is every day picked on the row. `target_date` (the last
// day only) is what tabs loaded before 2026-10-16 still send (FM-14).
const BodySchema = z.object({
  description: z.string().min(1).max(400),
  target_dates: z.array(Day).max(7).optional(),
  target_date: Day.nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { readOnly } = await requireAccess();
  if (readOnly) {
    return NextResponse.json({ error: "Read-only account." }, { status: 403 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = parseForm(BodySchema, raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { description, target_dates, target_date } = parsed.data;
  const score = await scoreMissionDraft({
    description,
    target_dates: target_dates ?? (target_date ? [target_date] : []),
  });
  return NextResponse.json(score);
}
