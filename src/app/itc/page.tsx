import Link from "next/link";
import { redirect } from "next/navigation";
import { CHOOSABLE_PILLARS, PILLAR_BY_CODE } from "@/lib/pillars";
import { isItcAdmin } from "@/lib/itc/admin";
import { listMapsForParticipant } from "@/lib/itc/maps";
import { STAGE_LABELS } from "@/lib/itc/stage";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { startMap } from "./actions";
import { StartMapButton } from "./start-map-button";

const ERROR_COPY: Record<string, string> = {
  pillar: "Pick a pillar to start.",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const nowMs = Date.now();
  const seconds = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function ItcLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const participant = await requireItcParticipant();
  const maps = await listMapsForParticipant(participant.id);

  const inProgress = maps.filter((m) => m.status === "in_progress");
  const completed = maps.filter((m) => m.status !== "in_progress");

  // First-login redirect per auth-phase spec Section 7. If the coachee
  // has exactly one in-progress map, land them on it directly — no
  // reason to make them click through the landing page every visit.
  // (The one-map-per-participant DB constraint from migration
  // 20260828000001 means "more than one in-progress" shouldn't occur;
  // if it does, we still fall through to the landing page's chooser.)
  if (inProgress.length === 1) {
    redirect(`/itc/${inProgress[0].id}`);
  }

  // Product decision 2026-08-28: one active map per participant. If any
  // map is in progress, the "Start a new map" section is hidden entirely
  // rather than shown-with-restrictions — otherwise the coachee sees an
  // inviting form, picks a pillar, and gets silently redirected back to
  // his existing map, which reads as a bug.
  const canStartNewMap = inProgress.length === 0;

  const params = await searchParams;
  const errorMessage = params.error ? ERROR_COPY[params.error] : null;
  const isAdmin = isItcAdmin(participant.email);

  return (
    <main className="min-h-screen flex flex-col px-6 py-8 gap-6 max-w-3xl mx-auto w-full">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            Dad Edge Goal Clarifier
          </h1>
          <p className="text-xs text-[color:var(--color-muted)]">
            Signed in as <span className="text-white">{participant.email}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin ? (
            <Link
              href="/itc/admin"
              className="text-xs underline text-[color:var(--color-muted)] hover:text-white"
            >
              Admin
            </Link>
          ) : null}
          <form action="/itc/logout" method="POST">
            <button
              type="submit"
              className="text-xs underline text-[color:var(--color-muted)] hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {inProgress.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[color:var(--color-muted)] uppercase tracking-wide">
            In progress ({inProgress.length})
          </h2>
          <ul className="space-y-2">
            {inProgress.map((m) => {
              const pillar = PILLAR_BY_CODE[m.pillar_code];
              return (
                <li key={m.id}>
                  <Link
                    href={`/itc/${m.id}`}
                    className="block rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 px-4 py-3 hover:border-[color:var(--color-primary)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: pillar.colorVar }}
                          >
                            {pillar.label}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
                            {STAGE_LABELS[m.current_stage]}
                          </span>
                        </div>
                        <div className="text-xs text-[color:var(--color-muted)] truncate">
                          {m.improvement_goal ?? "Goal not yet locked"}
                        </div>
                      </div>
                      <div className="text-[10px] text-[color:var(--color-muted)] shrink-0">
                        {relativeTime(m.updated_at)}
                      </div>
                      <div className="text-sm text-[color:var(--color-primary)] shrink-0">
                        Continue →
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {canStartNewMap ? (
        <section className="space-y-3 bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Start a new map</h2>
            <p className="text-xs text-[color:var(--color-muted)]">
              Pick the BRAVEMAN pillar this map is about.
            </p>
          </div>
          <form action={startMap} className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CHOOSABLE_PILLARS.map((p) => (
                <label
                  key={p.code}
                  className="flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs border-[color:var(--color-border)] bg-black/20 cursor-pointer has-[:checked]:border-[color:var(--color-primary)] has-[:checked]:bg-[color:var(--color-primary)]/20"
                >
                  <input
                    type="radio"
                    name="pillar_code"
                    value={p.code}
                    required
                    className="sr-only"
                  />
                  <span
                    className="text-lg font-semibold"
                    style={{ color: p.colorVar }}
                  >
                    {p.code}
                  </span>
                  <span className="uppercase tracking-wide text-[color:var(--color-muted)]">
                    {p.short}
                  </span>
                </label>
              ))}
            </div>
            {errorMessage ? (
              <p className="text-xs text-[color:var(--color-danger)]">{errorMessage}</p>
            ) : null}
            <StartMapButton />
          </form>
        </section>
      ) : (
        <p className="text-xs text-[color:var(--color-muted)] italic">
          Finish or close your current map before starting a new one. One at a time keeps the work honest.
        </p>
      )}

      {completed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-[color:var(--color-muted)] uppercase tracking-wide">
            History ({completed.length})
          </h2>
          <ul className="space-y-2">
            {completed.map((m) => {
              const pillar = PILLAR_BY_CODE[m.pillar_code];
              return (
                <li key={m.id}>
                  <Link
                    href={`/itc/${m.id}`}
                    className="block rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 hover:border-[color:var(--color-muted)] transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-xs font-semibold"
                            style={{ color: pillar.colorVar }}
                          >
                            {pillar.label}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide text-[color:var(--color-muted)]">
                            {m.status === "complete" ? "Complete" : m.status}
                          </span>
                        </div>
                        <div className="text-xs text-[color:var(--color-muted)] truncate">
                          {m.improvement_goal ?? "Goal not locked"}
                        </div>
                      </div>
                      <div className="text-[10px] text-[color:var(--color-muted)] shrink-0">
                        {relativeTime(m.updated_at)}
                      </div>
                      <div className="text-xs text-[color:var(--color-muted)] shrink-0">
                        View →
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {maps.length === 0 ? (
        <p className="text-xs text-[color:var(--color-muted)] italic text-center py-4">
          No maps yet. Pick a pillar above to start your first one.
        </p>
      ) : null}
    </main>
  );
}
