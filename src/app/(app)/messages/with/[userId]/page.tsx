import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { findOrCreateThread } from "@/lib/messages/threads";

/**
 * "Message this brother" entry point from /community?tab=people.
 * Server-resolves or creates the 1-on-1 thread with the requested
 * user, then redirects into it. User sees one navigation from card
 * click → thread; no intermediate "creating…" screen.
 *
 * If the pair aren't allowed to message (no shared community or the
 * target isn't a real user), redirects to /messages with a small
 * error banner instead.
 */
export const dynamic = "force-dynamic";

export default async function OpenThreadWithPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { user } = await requireAccess();
  const { userId: otherUserId } = await params;

  const result = await findOrCreateThread(user.id, otherUserId);
  if ("error" in result) {
    redirect(`/messages?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/messages/${result.threadId}`);
}
