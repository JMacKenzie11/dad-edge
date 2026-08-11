import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAllowance } from "@/lib/coach/allowance";
import { CoachConversation, type UITurn } from "../conversation";
import { archiveConversation } from "../actions";
import type { PillarCode } from "@/lib/pillars";

export const dynamic = "force-dynamic";

type StoredAssistantContent = {
  text: string;
  mission_suggestion: {
    description: string;
    pillar_code: PillarCode;
    target_date: string;
  } | null;
  prompt_version?: string;
};

export default async function CoachConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, readOnly } = await requireAccess();
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coach_conversations")
    .select("id, mode, title, archived_at, started_at, user_id")
    .eq("id", id)
    .maybeSingle();
  const c = convo as
    | {
        id: string;
        mode: "general" | "mission";
        title: string | null;
        archived_at: string | null;
        started_at: string;
        user_id: string;
      }
    | null;
  if (!c) notFound();
  if (c.user_id !== user.id) redirect("/coach");
  if (c.archived_at) redirect("/coach");

  const { data: rows } = await supabase
    .from("coach_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", c.id)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(200);

  const turns: UITurn[] = ((rows ?? []) as {
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
  }[]).map((r) => {
    if (r.role === "user") {
      return {
        id: r.id,
        role: "user",
        text: r.content,
        missionSuggestion: null,
        createdAt: r.created_at,
      };
    }
    let parsed: StoredAssistantContent | null = null;
    try {
      parsed = JSON.parse(r.content) as StoredAssistantContent;
    } catch {
      parsed = null;
    }
    return {
      id: r.id,
      role: "assistant",
      text: parsed?.text ?? r.content,
      missionSuggestion: parsed?.mission_suggestion ?? null,
      createdAt: r.created_at,
    };
  });

  const allowance = await readAllowance(user.id);
  const displayTitle =
    c.title ?? (c.mode === "mission" ? "New mission" : "New conversation");

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-primary)]">
            {c.mode === "mission" ? "MISSION" : "GENERAL"} · STARTED{" "}
            {format(new Date(c.started_at), "MMM d")}
          </p>
          <h1 className="font-heading text-2xl truncate">{displayTitle}</h1>
        </div>
        <div className="flex items-baseline gap-3 shrink-0">
          <Link
            href="/coach"
            className="text-[10px] font-heading tracking-widest leading-none text-[color:var(--color-text-muted)] hover:text-[color:var(--color-primary)]"
          >
            ← ALL
          </Link>
          <form action={archiveConversation} className="leading-none">
            <input type="hidden" name="conversation_id" value={c.id} />
            <button
              type="submit"
              className="p-0 m-0 bg-transparent border-0 text-[10px] font-heading tracking-widest leading-none text-[color:var(--color-text-muted)] hover:text-[color:var(--color-danger)]"
              title="Archive"
            >
              ARCHIVE
            </button>
          </form>
        </div>
      </header>

      <CoachConversation
        conversationId={c.id}
        mode={c.mode}
        initialTurns={turns}
        readOnly={readOnly}
        remaining={allowance.remaining}
        firstName={user.first_name}
      />
    </div>
  );
}
