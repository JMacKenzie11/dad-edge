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
  const session = await readItcSession();
  if (!session) redirect("/itc/login");

  const participant = await getParticipantById(session.pid);
  if (!participant) redirect("/itc/login");
  return participant;
}
