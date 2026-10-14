import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseForm } from "@/lib/validation/form-error";
import { requireAccess } from "@/lib/session";
import { sendCoachMessage } from "@/lib/coach/send-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  conversation_id: z.string().uuid(),
  text: z
    .string()
    .min(1, "Write something first.")
    .max(4000, "Keep your message under 4,000 characters."),
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
  const parsed = parseForm(BodySchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
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
