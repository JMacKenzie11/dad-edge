import Link from "next/link";
import { notFound } from "next/navigation";
import { isItcAdmin } from "@/lib/itc/admin";
import {
  getMapById,
  listAssumptionLinks,
  listAssumptions,
  listBehaviors,
  listCommitments,
  listMessages,
  listWorries,
} from "@/lib/itc/maps";
import { getParticipantById } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { StageProgress } from "../../[mapId]/stage-progress";

export default async function ItcAdminMapPage({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const viewer = await requireItcParticipant();
  if (!isItcAdmin(viewer.email)) notFound();

  const { mapId } = await params;
  const map = await getMapById(mapId);
  if (!map) notFound();

  const [
    owner,
    messages,
    behaviors,
    worries,
    commitments,
    assumptions,
    assumptionLinks,
  ] = await Promise.all([
    getParticipantById(map.participant_id),
    listMessages(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
    listCommitments(map.id),
    listAssumptions(map.id),
    listAssumptionLinks(map.id),
  ]);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  return (
    <main className="min-h-screen md:h-screen flex flex-col md:overflow-hidden">
      <header className="border-b border-[color:var(--color-border)] px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/itc/admin"
            className="text-xs text-[color:var(--color-muted)] hover:text-white whitespace-nowrap"
          >
            ← All maps
          </Link>
          <div className="text-xs text-[color:var(--color-muted)] truncate">
            Viewing {owner?.email ?? "(unknown)"} · admin read-only
          </div>
        </div>
      </header>

      <div className="px-4 py-3 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:min-h-0">
        <section className="border-b md:border-b-0 md:border-r border-[color:var(--color-border)] p-4 min-h-[420px] md:min-h-0 overflow-y-auto">
          <ol className="space-y-3 pr-1">
            {displayMessages.length === 0 ? (
              <li className="text-sm italic text-[color:var(--color-muted)]">
                No conversation yet.
              </li>
            ) : null}
            {displayMessages.map((m) => (
              <li
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[color:var(--color-primary)]/25 px-3 py-2 text-sm"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.content}
              </li>
            ))}
          </ol>
        </section>
        <section className="p-4 md:min-h-0 md:overflow-y-auto text-xs space-y-3">
          {/* Full admin view (linear + threaded) rebuilds in Layout
              Amendment Checkpoint D. For now: raw state dump so
              admins can inspect the map behind the transcript. */}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Goal
            </div>
            <div>{map.improvement_goal ?? "(not set)"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Behaviors ({behaviors.filter((b) => b.selected).length})
            </div>
            <ul className="list-decimal ml-4">
              {behaviors
                .filter((b) => b.selected)
                .map((b) => (
                  <li key={b.id}>{b.text}</li>
                ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Worries ({worries.length})
            </div>
            <ul className="list-decimal ml-4">
              {worries.map((w) => (
                <li key={w.id}>{w.text}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Commitments ({commitments.length})
            </div>
            <ul className="list-decimal ml-4">
              {commitments.map((c) => (
                <li key={c.id}>{c.text}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Assumptions ({assumptions.length})
            </div>
            <ul className="list-decimal ml-4">
              {assumptions.map((a) => {
                const links = assumptionLinks
                  .filter((l) => l.assumption_id === a.id)
                  .map((l) => l.commitment_id);
                return (
                  <li key={a.id}>
                    {a.text}
                    <span className="text-[color:var(--color-muted)]">
                      {" "}
                      (links {links.length})
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
