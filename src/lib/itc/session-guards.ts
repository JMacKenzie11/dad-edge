import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ONBOARDING_STEPS_TOTAL, onboardingRouteFor } from "@/lib/session";
import {
  getParticipantById,
  upsertParticipantByEmail,
  type ItcParticipant,
} from "./participant";
import { readItcSession } from "./session";

/**
 * Resolve the current ITC participant for a /itc/* request. Two auth
 * paths, tried in order:
 *
 *   1. Main-app session (Supabase auth). If a user is signed in AND
 *      has users.itc_access = true, that's the primary path. We upsert
 *      an itc_participants row for their email (matching the migrated
 *      row if it exists) and return it. This is the path new users
 *      take post-Checkpoint F.
 *
 *   2. Legacy ITC cookie (ITC_DEMO_AUTH / /itc/login). Kept for
 *      backwards compat until Section 8 of the auth-phase spec fires
 *      and Jason explicitly retires the demo path. Every existing ITC
 *      tester keeps logging in with 1111 exactly as before, no
 *      disruption.
 *
 * When neither path resolves, redirect to /login (main auth) — that's
 * the front door going forward. /itc/login stays reachable via a
 * direct URL for anyone who hasn't been migrated yet.
 *
 * ONLY safe to call from /itc/* server code.
 */
export async function requireItcParticipant(): Promise<ItcParticipant> {
  // Test seam. The persona harness in tests/itc-sessions runs outside
  // a request context and has no cookie jar. When
  // ITC_TEST_PARTICIPANT_ID is set, look up the participant directly
  // and skip everything else. Production code paths never set this.
  const testPid = process.env.ITC_TEST_PARTICIPANT_ID?.trim();
  if (testPid) {
    const participant = await getParticipantById(testPid);
    if (!participant) {
      throw new Error(
        `[itc test seam] ITC_TEST_PARTICIPANT_ID=${testPid} does not resolve to a participant row`,
      );
    }
    return participant;
  }

  // Path 1: main-app session.
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: userRow } = await supabase
        .from("users")
        .select("id, email, itc_access, onboarding_step, is_platform_admin")
        .eq("id", user.id)
        .maybeSingle();
      const row = userRow as
        | {
            id: string;
            email: string;
            itc_access: boolean;
            onboarding_step: number | null;
            is_platform_admin: boolean;
          }
        | null;
      if (row?.itc_access) {
        // ITC users go through the same onboarding wizard as main-app
        // users before landing on /itc. Platform admins bypass so
        // testing/preview stays frictionless. When onboarding
        // completes, saveFirstCheckin routes ITC users back to /itc
        // via currentUserHasItcAccess.
        const step = row.onboarding_step ?? 0;
        if (!row.is_platform_admin && step < ONBOARDING_STEPS_TOTAL) {
          redirect(onboardingRouteFor(step));
        }
        // Main-app user with ITC access. Upsert the participant row
        // by email so /itc/* code that resolves via participant_id
        // continues to work. The migration script (F apply) already
        // linked itc_maps.user_id → users.id for existing participants;
        // this upsert makes sure the participant record exists (or
        // resolves) for the current session.
        return await upsertParticipantByEmail(row.email);
      }
      if (row) {
        // Authenticated but no ITC access — the friendly deny page
        // per spec Section 7.
        redirect("/itc/no-access");
      }
    }
  } catch (err) {
    // If the main-app session lookup itself throws (rare, e.g., cookie
    // issue), fall through to the legacy cookie path rather than
    // hard-erroring — we don't want a transient main-app auth glitch
    // to lock a currently-active ITC-demo user out.
    console.warn(
      "[itc] requireItcParticipant: main-app session read failed, falling back to legacy cookie: %s",
      err instanceof Error ? err.message : String(err),
    );
  }

  // Path 2: legacy ITC cookie session (still supported).
  const session = await readItcSession();
  if (!session) {
    // No session on either path → main-app login is the front door.
    redirect("/login?next=/itc");
  }
  const participant = await getParticipantById(session.pid);
  if (!participant) {
    console.warn(
      "[itc] requireItcParticipant: participant not found pid=%s",
      session.pid,
    );
    redirect("/login?next=/itc");
  }
  return participant;
}
