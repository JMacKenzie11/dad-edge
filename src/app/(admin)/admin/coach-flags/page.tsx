import Link from "next/link";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { resolveFlag } from "./actions";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const SEVERITY_OPTIONS = ["all", "medium", "high", "critical"] as const;
const STATUS_OPTIONS = ["open", "reviewed", "all"] as const;
type Severity = (typeof SEVERITY_OPTIONS)[number];
type Status = (typeof STATUS_OPTIONS)[number];

function isSeverity(v: string | undefined): v is Severity {
  return !!v && (SEVERITY_OPTIONS as readonly string[]).includes(v);
}
function isStatus(v: string | undefined): v is Status {
  return !!v && (STATUS_OPTIONS as readonly string[]).includes(v);
}

export default async function CoachFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string }>;
}) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const severityFilter: Severity = isSeverity(params.severity)
    ? params.severity
    : "all";
  const statusFilter: Status = isStatus(params.status) ? params.status : "open";

  const svc = createSupabaseServiceClient();
  let query = svc
    .from("coach_flags_queue")
    .select(
      "id, severity, status, notes, created_at, message_id, coach_messages:message_id(content, role, flag_reason, created_at, conversation_id, coach_conversations:conversation_id(user_id, mode, users:user_id(email, first_name, last_name)))",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (severityFilter !== "all") {
    query = query.eq("severity", severityFilter);
  }
  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }
  const { data: flags } = await query;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-heading text-2xl">Coach flags</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          Messages flagged by the safety classifier. Platform admin only (DECISION #6).
        </p>
      </header>

      <div className="flex flex-wrap gap-4">
        <FilterGroup
          label="Severity"
          options={SEVERITY_OPTIONS}
          current={severityFilter}
          paramName="severity"
          otherParam={{ status: statusFilter }}
        />
        <FilterGroup
          label="Status"
          options={STATUS_OPTIONS}
          current={statusFilter}
          paramName="status"
          otherParam={{ severity: severityFilter }}
        />
      </div>

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
                  flag_reason: string | null;
                  coach_conversations:
                    | {
                        user_id: string;
                        mode: "general" | "mission";
                        users:
                          | {
                              email: string;
                              first_name: string | null;
                              last_name: string | null;
                            }
                          | Array<{
                              email: string;
                              first_name: string | null;
                              last_name: string | null;
                            }>
                          | null;
                      }
                    | Array<{
                        user_id: string;
                        mode: "general" | "mission";
                        users: unknown;
                      }>
                    | null;
                }
              | Array<{
                  content: string;
                  role: string;
                  flag_reason: string | null;
                  coach_conversations: unknown;
                }>
              | null;
          };
          const msgRaw = Array.isArray(raw.coach_messages)
            ? raw.coach_messages[0]
            : raw.coach_messages;
          const msg = msgRaw as
            | {
                content: string;
                role: string;
                flag_reason: string | null;
                coach_conversations: unknown;
              }
            | null;
          const convoRaw = msg
            ? Array.isArray(msg.coach_conversations)
              ? (msg.coach_conversations as unknown[])[0]
              : msg.coach_conversations
            : null;
          const convo = convoRaw as
            | {
                user_id: string;
                mode: "general" | "mission";
                users: unknown;
              }
            | null;
          const usersRaw = convo
            ? Array.isArray(convo.users)
              ? (convo.users as unknown[])[0]
              : convo.users
            : null;
          const u = usersRaw as
            | {
                email: string;
                first_name: string | null;
                last_name: string | null;
              }
            | null;
          return (
            <li
              key={raw.id}
              className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
            >
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <p className="font-heading text-sm">
                    {u
                      ? [u.first_name, u.last_name].filter(Boolean).join(" ") ||
                        u.email
                      : "—"}
                  </p>
                  <p className="text-xs text-[color:var(--color-text-muted)]">
                    {u?.email ?? ""} ·{" "}
                    {format(new Date(raw.created_at), "MMM d HH:mm")}
                    {convo?.mode ? ` · ${convo.mode} mode` : ""}
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
                      color:
                        raw.status === "open"
                          ? "var(--color-warning)"
                          : "var(--color-text-muted)",
                    }}
                  >
                    {raw.status.toUpperCase()}
                  </span>
                </div>
              </div>
              <p className="text-sm text-[color:var(--color-text-muted)] whitespace-pre-wrap">
                {msg?.content ?? "(message deleted)"}
              </p>
              {msg?.flag_reason ? (
                <p className="mt-2 text-[11px] text-[color:var(--color-text-muted)] italic">
                  Classifier: {msg.flag_reason}
                </p>
              ) : null}
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
            {statusFilter === "open" && severityFilter === "all"
              ? "No open flags. The coach is behaving."
              : "No flags match this filter."}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function FilterGroup({
  label,
  options,
  current,
  paramName,
  otherParam,
}: {
  label: string;
  options: readonly string[];
  current: string;
  paramName: string;
  otherParam: Record<string, string>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {label.toUpperCase()}
      </span>
      <div className="flex gap-1">
        {options.map((opt) => {
          const params = new URLSearchParams({ ...otherParam, [paramName]: opt });
          const href = `/admin/coach-flags?${params.toString()}`;
          const active = opt === current;
          return (
            <Link
              key={opt}
              href={href}
              className={`h-7 px-2.5 rounded-md text-[11px] font-heading tracking-widest flex items-center ${
                active
                  ? "bg-[color:var(--color-primary)] text-white"
                  : "border border-[color:var(--color-border)] text-[color:var(--color-text-muted)] hover:text-white"
              }`}
            >
              {opt.toUpperCase()}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
