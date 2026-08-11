import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { resolveFlag } from "./actions";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function CoachFlagsPage() {
  await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();

  const { data: flags } = await svc
    .from("coach_flags_queue")
    .select("id, severity, status, notes, created_at, message_id, coach_messages:message_id(content, role, created_at, conversation_id, coach_conversations:conversation_id(user_id, users:user_id(email, first_name, last_name)))")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl">Coach flags</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Messages flagged by the safety classifier. Platform admin only (DECISION #6).
        </p>
      </header>

      <ul className="space-y-3">
        {(flags ?? []).map((f) => {
          const raw = f as unknown as {
            id: string;
            severity: string;
            status: "open" | "reviewed";
            notes: string | null;
            created_at: string;
            coach_messages:
              | {
                  content: string;
                  role: string;
                  coach_conversations:
                    | {
                        user_id: string;
                        users:
                          | { email: string; first_name: string | null; last_name: string | null }
                          | { email: string; first_name: string | null; last_name: string | null }[]
                          | null;
                      }
                    | { user_id: string; users: unknown }[]
                    | null;
                }
              | { content: string; role: string; coach_conversations: unknown }[]
              | null;
          };
          const msgRaw = Array.isArray(raw.coach_messages)
            ? raw.coach_messages[0]
            : raw.coach_messages;
          const msg = msgRaw as
            | { content: string; role: string; coach_conversations: unknown }
            | null;
          const convoRaw = msg
            ? Array.isArray(msg.coach_conversations)
              ? (msg.coach_conversations as unknown[])[0]
              : msg.coach_conversations
            : null;
          const convo = convoRaw as
            | { user_id: string; users: unknown }
            | null;
          const usersRaw = convo
            ? Array.isArray(convo.users)
              ? (convo.users as unknown[])[0]
              : convo.users
            : null;
          const u = usersRaw as
            | { email: string; first_name: string | null; last_name: string | null }
            | null;
          return (
            <li
              key={raw.id}
              className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
            >
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <p className="font-heading text-sm">
                    {u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email : "—"}
                  </p>
                  <p className="text-xs text-[color:var(--color-text-muted)]">
                    {u?.email ?? ""} · {format(new Date(raw.created_at), "MMM d HH:mm")}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className="font-heading tracking-widest"
                    style={{
                      color:
                        raw.severity === "high" || raw.severity === "critical"
                          ? "var(--color-danger)"
                          : "var(--color-warning)",
                    }}
                  >
                    {raw.severity.toUpperCase()}
                  </span>
                  <span
                    className="font-heading tracking-widest"
                    style={{
                      color: raw.status === "open" ? "var(--color-warning)" : "var(--color-text-muted)",
                    }}
                  >
                    {raw.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <p className="text-sm text-[color:var(--color-text-muted)] whitespace-pre-wrap">
                {msg?.content ?? "(message deleted)"}
              </p>
              {raw.status === "open" ? (
                <form action={resolveFlag} className="mt-3 flex gap-2">
                  <input type="hidden" name="flag_id" value={raw.id} />
                  <input
                    name="notes"
                    placeholder="Notes"
                    maxLength={400}
                    className="flex-1 h-9 px-3 text-sm rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]"
                  />
                  <button className="h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
                    RESOLVE
                  </button>
                </form>
              ) : (
                <p className="mt-2 text-xs text-[color:var(--color-text-muted)]">
                  {raw.notes ?? ""}
                </p>
              )}
            </li>
          );
        })}
        {(flags ?? []).length === 0 ? (
          <li className="p-8 text-center text-sm text-[color:var(--color-text-muted)] border border-[color:var(--color-border)] rounded-[var(--radius-card)]">
            No flags. The coach is behaving.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
