import { requireAccess } from "@/lib/session";
import { loadInbox, markAllMessagesReadForViewer } from "@/lib/messages/threads";
import { InboxPane } from "./inbox-pane";

/**
 * Two-pane layout for /messages. On desktop: inbox permanently on the
 * left, thread on the right (`children`). On mobile: inbox becomes
 * the full page at /messages, thread page /messages/[threadId] takes
 * over — the inbox hides via `hidden md:block` and the thread's own
 * back button (in its own header) returns them.
 *
 * Inbox data is fetched once at the layout level so navigating
 * between threads doesn't re-query it.
 */
export const dynamic = "force-dynamic";

export default async function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireAccess();
  // Visiting the inbox counts as consuming the unread notification.
  // Run before loadInbox so the per-thread unread counts reflect zero
  // and match the header badge on this render.
  await markAllMessagesReadForViewer(user.id);
  const inbox = await loadInbox(user.id);

  return (
    <div className="max-w-5xl mx-auto min-h-[70vh] md:grid md:grid-cols-[300px_1fr] md:gap-4">
      <InboxPane inbox={inbox} />
      <section className="md:min-h-[70vh]">{children}</section>
    </div>
  );
}
