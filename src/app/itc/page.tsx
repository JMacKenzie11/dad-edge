import Link from "next/link";
import { redirect } from "next/navigation";
import { CHOOSABLE_PILLARS } from "@/lib/pillars";
import { findInProgressMap } from "@/lib/itc/maps";
import { requireItcParticipant } from "@/lib/itc/session-guards";
import { startMap } from "./actions";

const ERROR_COPY: Record<string, string> = {
  pillar: "Pick a pillar to start.",
};

export default async function ItcLandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const participant = await requireItcParticipant();
  const existing = await findInProgressMap(participant.id);
  if (existing) redirect(`/itc/${existing.id}`);

  const params = await searchParams;
  const errorMessage = params.error ? ERROR_COPY[params.error] : null;

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-6">
      <div className="w-full max-w-lg bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">ITC Map Builder</h1>
          <p className="text-sm text-[color:var(--color-muted)]">
            Signed in as <span className="text-white">{participant.email}</span>.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Start a new map</h2>
            <p className="text-xs text-[color:var(--color-muted)]">
              Pick the BRAVEMAN pillar this map is about. You can only work on one map at a time.
            </p>
          </div>
          <form action={startMap} className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CHOOSABLE_PILLARS.map((p) => (
                <label
                  key={p.code}
                  className="flex flex-col items-center gap-1 rounded-md border border-[color:var(--color-border)] bg-black/20 px-2 py-3 text-xs cursor-pointer has-[:checked]:border-[color:var(--color-primary)] has-[:checked]:bg-[color:var(--color-primary)]/20"
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
            <button
              type="submit"
              className="w-full rounded-md bg-[color:var(--color-primary)] px-4 py-2 text-sm font-semibold"
            >
              Start map
            </button>
          </form>
        </div>

        <Link
          href="/itc/logout"
          className="inline-block text-sm underline text-[color:var(--color-muted)] border-t border-[color:var(--color-border)] pt-3 w-full"
        >
          Sign out
        </Link>
      </div>
    </main>
  );
}
