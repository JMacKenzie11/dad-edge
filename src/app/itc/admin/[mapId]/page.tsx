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
  listTestResults,
  listTests,
  listWorries,
} from "@/lib/itc/maps";
import { getParticipantById } from "@/lib/itc/participant";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { ITC_STAGES, STAGE_LABELS, type ItcStage } from "@/lib/itc/stage";
import { getAdvanceGateAdmin } from "../../actions";
import { StageProgress } from "../../[mapId]/stage-progress";
import { AuditPreview } from "./audit-preview";

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
    tests,
    testResults,
    gate,
  ] = await Promise.all([
    getParticipantById(map.participant_id),
    listMessages(map.id),
    listBehaviors(map.id),
    listWorries(map.id),
    listCommitments(map.id),
    listAssumptions(map.id),
    listAssumptionLinks(map.id),
    listTests(map.id),
    listTestResults(map.id),
    getAdvanceGateAdmin(map.id),
  ]);

  // Index → "A1"/"A2"/"A3" tag so a test can reference which assumption
  // it's testing without duplicating the (often long) assumption text.
  const assumptionTag = new Map<string, string>();
  assumptions.forEach((a, i) => assumptionTag.set(a.id, `A${i + 1}`));
  const resultsByTestId = new Map<string, typeof testResults[number]>();
  for (const r of testResults) resultsByTestId.set(r.test_id, r);

  const displayMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // Group messages by stage_at_creation so the transcript reads as a
  // sectioned coaching arc rather than a wall.
  const messagesByStage = new Map<ItcStage, typeof displayMessages>();
  for (const m of displayMessages) {
    const arr = messagesByStage.get(m.stage_at_creation) ?? [];
    arr.push(m);
    messagesByStage.set(m.stage_at_creation, arr);
  }
  const stagesWithMessages = ITC_STAGES.filter((s) =>
    messagesByStage.has(s),
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
            Viewing {owner?.email ?? "(unknown)"} · admin read-only ·
            stage: <span className="text-white">{STAGE_LABELS[map.current_stage]}</span>
          </div>
        </div>
      </header>

      <div className="px-4 py-3 border-b border-[color:var(--color-border)]">
        <StageProgress current={map.current_stage} />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:min-h-0">
        <section className="border-b md:border-b-0 md:border-r border-[color:var(--color-border)] p-4 min-h-[420px] md:min-h-0 overflow-y-auto">
          {stagesWithMessages.length === 0 ? (
            <p className="text-sm italic text-[color:var(--color-muted)]">
              No conversation yet.
            </p>
          ) : (
            <div className="space-y-6">
              {stagesWithMessages.map((stage) => {
                const stageMessages = messagesByStage.get(stage) ?? [];
                return (
                  <section key={stage}>
                    <h3 className="sticky top-0 -mx-4 -mt-4 mb-2 px-4 py-2 text-[11px] uppercase tracking-widest text-[color:var(--color-primary)] bg-[color:var(--color-surface)]/95 backdrop-blur border-b border-[color:var(--color-border)] z-10">
                      {STAGE_LABELS[stage]}
                    </h3>
                    <ol className="space-y-3 pr-1">
                      {stageMessages.map((m) => (
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
                );
              })}
            </div>
          )}
        </section>
        <section className="p-4 md:min-h-0 md:overflow-y-auto text-xs space-y-3">
          {/* Advance gate — what's blocking the coachee right now. */}
          <div className="rounded-md border border-[color:var(--color-border)] bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)] mb-1">
              Advance gate
            </div>
            {gate.to ? (
              <div>
                <span
                  className={
                    "font-medium " +
                    (gate.enabled ? "text-emerald-300" : "text-amber-300")
                  }
                >
                  {gate.enabled ? "READY" : "BLOCKED"}
                </span>
                <span className="text-[color:var(--color-muted)]">
                  {" "}→ {STAGE_LABELS[gate.to]}
                </span>
                {gate.reason ? (
                  <div className="text-[color:var(--color-muted)] mt-1 italic">
                    {gate.reason}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-[color:var(--color-muted)]">
                No further advance.
              </div>
            )}
          </div>

          <AuditPreview mapId={map.id} />

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
            <ul className="list-decimal ml-4 space-y-1">
              {worries.map((w) => (
                <li key={w.id}>
                  {w.text}
                  <span className="text-[color:var(--color-muted)]/80 ml-1">
                    (depth {w.depth_score ?? "—"}, {w.attempts} attempt{w.attempts === 1 ? "" : "s"})
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Competing Commitments ({commitments.length})
            </div>
            <ul className="list-decimal ml-4 space-y-1">
              {commitments.map((c) => (
                <li key={c.id}>
                  {c.text}
                  <span className="text-[color:var(--color-muted)]/80 ml-1">
                    (depth {c.depth_score ?? "—"}, {c.attempts} attempt{c.attempts === 1 ? "" : "s"})
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
              Big Assumptions ({assumptions.length})
            </div>
            <ul className="list-decimal ml-4 space-y-1">
              {assumptions.map((a) => {
                const links = assumptionLinks
                  .filter((l) => l.assumption_id === a.id)
                  .map((l) => l.commitment_id);
                const tag = assumptionTag.get(a.id);
                return (
                  <li key={a.id}>
                    {tag ? (
                      <span className="text-[color:var(--color-primary)] font-semibold mr-1">
                        {tag}.
                      </span>
                    ) : null}
                    {a.text}
                    <span className="text-[color:var(--color-muted)]/80 ml-1">
                      (depth {a.depth_score ?? "—"}, {a.attempts} attempt{a.attempts === 1 ? "" : "s"}, links {links.length})
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {tests.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
                Tests ({tests.length})
              </div>
              <ol className="list-decimal ml-4 space-y-2">
                {tests.map((t) => {
                  const tag = assumptionTag.get(t.assumption_id) ?? "?";
                  const result = resultsByTestId.get(t.id);
                  return (
                    <li key={t.id} className="space-y-0.5">
                      <div>
                        <span className="text-[color:var(--color-primary)] font-semibold mr-1">
                          {tag}
                        </span>
                        <span className="uppercase tracking-wide text-[color:var(--color-muted)] text-[10px]">
                          {t.test_type.replace("_", " ")}
                        </span>
                        <span className="text-[color:var(--color-muted)]/80 ml-1">
                          · {t.status}
                          {t.target_date ? ` · due ${t.target_date}` : ""}
                          {result?.assumption_verdict
                            ? ` · verdict: ${result.assumption_verdict}`
                            : ""}
                        </span>
                      </div>
                      {t.behavior_change ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">So I will: </span>
                          {t.behavior_change}
                        </div>
                      ) : null}
                      {t.data_to_collect ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">Collect: </span>
                          {t.data_to_collect}
                        </div>
                      ) : null}
                      {t.in_order_to_find_out ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">Find out whether: </span>
                          {t.in_order_to_find_out}
                        </div>
                      ) : null}
                      {result?.what_i_did ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">What he did: </span>
                          {result.what_i_did}
                        </div>
                      ) : null}
                      {result?.data_collected ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">Data: </span>
                          {result.data_collected}
                        </div>
                      ) : null}
                      {result?.what_it_says_about_assumption ? (
                        <div>
                          <span className="text-[color:var(--color-muted)]">Says about assumption: </span>
                          {result.what_it_says_about_assumption}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
