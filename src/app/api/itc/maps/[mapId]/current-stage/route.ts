import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getMapForParticipant } from "@/lib/itc/maps";

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
  const { data: userRow } = await supabase
    .from("users")
    .select("email")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!userRow) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: participant } = await supabase
    .from("itc_participants")
    .select("id")
    .eq("email", (userRow as { email: string }).email)
    .maybeSingle();
  if (!participant) {
    return NextResponse.json({ error: "no_participant" }, { status: 404 });
  }

  const map = await getMapForParticipant(mapId, (participant as { id: string }).id);
  if (!map) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ stage: map.current_stage });
}
