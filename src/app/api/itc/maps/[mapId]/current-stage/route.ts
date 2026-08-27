import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMapForParticipant } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Small read-only endpoint that powers the client-side ItcStageNav.
 *
 * Kept HTTP rather than piggybacking on a server component because the
 * stage nav lives in the shell (`/itc/layout.tsx`) — a client-side
 * switcher there can't accept server props keyed on `/itc/[mapId]`
 * segment params. Cheap query (one row by id), no join.
 *
 * Auth: main-app session required. Legacy cookie coachees don't hit
 * this — they get the fallback bare-children path in the layout and
 * never see the ItcStageNav rail.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const { mapId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Resolve the participant row for this main-app user by email.
  // Reuse upsertParticipantByEmail so we mirror requireItcParticipant's
  // email normalization (lowercased + trimmed) — a case-differing
  // lookup would silently miss the participant record even though the
  // /itc/[mapId] page found it, and the nav would look stuck.
  const { data: userRow } = await supabase
    .from("users")
    .select("email")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!userRow) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const participant = await upsertParticipantByEmail(
    (userRow as { email: string }).email,
  );

  const map = await getMapForParticipant(mapId, participant.id);
  if (!map) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ stage: map.current_stage });
}
