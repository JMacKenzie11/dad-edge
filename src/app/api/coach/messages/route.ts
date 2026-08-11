import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { sendCoachMessage } from "@/lib/coach/send-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z.string().min(1).max(4000),
});

export async function POST(req: NextRequest) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) {
    return NextResponse.json({ error: "Read-only account." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad input." }, { status: 400 });
  }

  try {
    const result = await sendCoachMessage({
      user,
      conversationId: parsed.data.conversation_id,
      userText: parsed.data.text,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
