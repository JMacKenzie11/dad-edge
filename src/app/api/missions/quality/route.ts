import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { scoreMissionDraft } from "@/lib/coach/mission-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  description: z.string().min(1).max(400),
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "N"]),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  goal_description: z.string().max(400).nullable(),
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
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Bad input." }, { status: 400 });
  const score = await scoreMissionDraft(parsed.data);
  return NextResponse.json(score);
}
