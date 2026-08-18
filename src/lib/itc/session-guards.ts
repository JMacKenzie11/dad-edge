import { redirect } from "next/navigation";
import { getParticipantById, type ItcParticipant } from "./participant";
import { readItcSession } from "./session";

/**
 * Read the ITC session cookie and load the participant. Redirects to
 * /itc/login if the session is missing / expired / points at a deleted row.
 * ONLY safe to call from /itc/* server code — main-app routes must never
 * consult ITC sessions (see docs/itc-isolation.md).
 */
export async function requireItcParticipant(): Promise<ItcParticipant> {
  // Test seam. The persona harness in tests/itc-sessions runs outside
  // a request context and has no cookie jar. When
  // ITC_TEST_PARTICIPANT_ID is set, look up the participant directly
  // and skip the cookie read. Production code paths never set this.
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

  const session = await readItcSession();
  if (!session) {
    console.warn("[itc] requireItcParticipant: no valid session cookie");
    redirect("/itc/login?error=session_missing");
  }

  const participant = await getParticipantById(session.pid);
  if (!participant) {
    console.warn("[itc] requireItcParticipant: participant not found pid=%s", session.pid);
    redirect("/itc/login?error=participant_missing");
  }
  return participant;
}
