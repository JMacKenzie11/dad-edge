import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateMissionConcreteness } from "@/lib/validation/mission";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  assistant_message_id: z.string().uuid(),
  description: z.string().min(1).max(280),
  pillar_code: z.enum(["B", "R", "A", "V", "E", "M", "A2", "N"]),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quarterly_goal_id: z.string().uuid().nullable().optional(),
});

/**
 * User-accepts a coach-suggested mission. §6: coach suggestions require
 * explicit acceptance and are marked as coach_suggested. We re-validate the
 * concreteness gate server-side (never trust the client's pre-baked suggestion).
 */
export async function POST(req: NextRequest) {
  const { user, readOnly } = await requireAccess();
  if (readOnly) return NextResponse.json({ error: "Read-only account." }, { status: 403 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON." }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Bad input." }, { status: 400 });

  const gate = validateMissionConcreteness({
    description: parsed.data.description,
    target_date: parsed.data.target_date,
  });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 400 });

  const supabase = await createSupabaseServerClient();

  // Confirm the assistant message belongs to a conversation owned by this user.
  const { data: msg } = await supabase
    .from("coach_messages")
    .select("id, conversation:conversation_id(user_id)")
    .eq("id", parsed.data.assistant_message_id)
    .maybeSingle();
  const msgRow = msg as
    | { conversation: { user_id: string } | { user_id: string }[] | null }
    | null;
  const convo = msgRow?.conversation
    ? Array.isArray(msgRow.conversation)
      ? (msgRow.conversation[0] ?? null)
      : msgRow.conversation
    : null;
  if (!convo || convo.user_id !== user.id) {
    return NextResponse.json({ error: "Not your message." }, { status: 403 });
  }

  const { data: membership } = await supabase
    .from("memberships")
    .select("community_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "No active community." }, { status: 400 });
  }
  const communityId = (membership as { community_id: string }).community_id;

  const { data: inserted, error } = await supabase
    .from("missions")
    .insert({
      user_id: user.id,
      community_id: communityId,
      pillar_code: parsed.data.pillar_code,
      description: parsed.data.description.trim(),
      target_date: parsed.data.target_date,
      quarterly_goal_id: parsed.data.quarterly_goal_id ?? null,
      created_by: "coach_suggested",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  revalidatePath("/missions");
  revalidatePath("/today");
  return NextResponse.json({ id: (inserted as { id: string }).id });
}
