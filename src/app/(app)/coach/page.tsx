import Link from "next/link";
import { format } from "date-fns";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAllowance } from "@/lib/coach/allowance";
import { createConversation, archiveConversation } from "./actions";

export const dynamic = "force-dynamic";

type ConvoRow = {
  id: string;
  mode: "general" | "mission";
  title: string | null;
  last_message_at: string | null;
  started_at: string;
};

export default async function CoachHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireAccess();
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("coach_conversations")
    .select("id, mode, title, last_message_at, started_at")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("started_at", { ascending: false });

  const rows = (data ?? []) as ConvoRow[];
  const general = rows.filter((r) => r.mode === "general");
  const mission = rows.filter((r) => r.mode === "mission");
  const allowance = await readAllowance(user.id);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
          COACH LARRY
        </p>
        <h1 className="font-heading text-3xl">Your conversations</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Start a new conversation any time. Larry knows you, your
          family, and your history.
        </p>
        {sp.error ? (
          <p className="mt-2 text-xs text-[color:var(--color-danger)]">{sp.error}</p>
        ) : null}
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <NewConversationCard
          mode="general"
          title="Talk to Larry"
          hint="Marriage, kids, work, business, health, money."
        />
        <NewConversationCard
          mode="mission"
          title="Set the mission"
          hint="One behavior. One day."
        />
      </div>

      <AllowanceBanner state={allowance} />

      <Section title="General" mode="general" rows={general} />
      <Section title="Mission" mode="mission" rows={mission} />
    </div>
  );
}

function NewConversationCard({
  mode,
  title,
  hint,
}: {
  mode: "general" | "mission";
  title: string;
  hint: string;
}) {
  return (
    <form action={createConversation}>
      <input type="hidden" name="mode" value={mode} />
      <button
        type="submit"
        className="w-full text-left p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)] transition-colors"
      >
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
          + NEW {mode.toUpperCase()} CONVERSATION
        </p>
        <p className="font-heading text-base mt-1">{title}</p>
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">{hint}</p>
      </button>
    </form>
  );
}

function Section({
  title,
  mode: _mode,
  rows,
}: {
  title: string;
  mode: "general" | "mission";
  rows: ConvoRow[];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2 className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mb-2">
        {title.toUpperCase()}
      </h2>
      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
        {rows.map((r) => {
          const when = r.last_message_at ?? r.started_at;
          return (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <Link href={`/coach/${r.id}`} className="flex-1 min-w-0">
                <p className="text-sm truncate">
                  {r.title ?? (r.mode === "mission" ? "New mission" : "New conversation")}
                </p>
                <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] mt-1">
                  {format(new Date(when), "MMM d · h:mm a")}
                </p>
              </Link>
              <form action={archiveConversation}>
                <input type="hidden" name="conversation_id" value={r.id} />
                <button
                  type="submit"
                  className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
                  title="Archive"
                >
                  ARCHIVE
                </button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AllowanceBanner({
  state,
}: {
  state: {
    used: number;
    softCap: number;
    noticeThreshold: number;
    hardCap: number;
    remaining: number;
    bucket: "ok" | "notice" | "over" | "block";
  };
}) {
  if (state.bucket === "ok") return null;
  const color =
    state.bucket === "block"
      ? "var(--color-danger)"
      : state.bucket === "over"
        ? "var(--color-warning)"
        : "var(--color-text-muted)";
  const msg =
    state.bucket === "block"
      ? `Coach paused for the month at ${state.used} messages. Resets on the 1st.`
      : state.bucket === "over"
        ? `Over your monthly allowance (${state.used} of ${state.softCap}). Coach is still on. Resets on the 1st.`
        : `${state.used} of ${state.softCap} coach messages used this month.`;
  return (
    <p className="text-xs font-heading tracking-widest" style={{ color }}>
      {msg}
    </p>
  );
}
