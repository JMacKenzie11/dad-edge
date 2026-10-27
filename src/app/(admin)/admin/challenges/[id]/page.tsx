import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CHALLENGE_COLUMNS, type Challenge } from "@/lib/challenges/rules";
import { ChallengeForm } from "@/app/(leader)/leader/challenges/challenge-form";
import { updateChallenge } from "@/app/(leader)/leader/challenges/actions";
import { DeleteChallenge } from "@/app/(leader)/leader/challenges/[id]/delete-challenge";

export const dynamic = "force-dynamic";

export default async function AdminEditChallengePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePlatformAdmin();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("challenges").select(CHALLENGE_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const challenge = data as Challenge;

  const [{ data: parts }, { data: community }] = await Promise.all([
    supabase.from("challenge_participants").select("status, joined_at").eq("challenge_id", id),
    supabase.from("communities").select("name").eq("id", challenge.community_id).maybeSingle(),
  ]);
  const rows = (parts ?? []) as { status: string; joined_at: string | null }[];
  // Matches guard_challenge_update(): anyone who ever joined locks the schedule.
  const locked = rows.some((p) => p.joined_at !== null);
  const inNow = rows.filter((p) => p.status === "in").length;

  return (
    <div className="space-y-6 max-w-xl">
      <header className="space-y-1">
        <Link
          href="/admin/challenges"
          className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
        >
          ← CHALLENGES
        </Link>
        <h1 className="font-heading text-2xl">{challenge.name}</h1>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          {community?.name ?? "Archived community"} · {inNow} {inNow === 1 ? "member is" : "members are"} in.
        </p>
      </header>

      <section className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
        <ChallengeForm
          action={updateChallenge}
          challenge={challenge}
          locked={locked}
          returnTo="admin"
          defaultStart={challenge.starts_on}
          submitLabel="SAVE CHANGES"
        />
      </section>

      <section className="p-4 rounded-[var(--radius-card)] border border-[color:var(--color-danger)]/40 space-y-2">
        <h2 className="font-heading text-sm">Delete this challenge</h2>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Everyone&rsquo;s upcoming challenge missions are removed. Missions from past weeks stay as regular missions, and the challenge comes off the board.
        </p>
        <DeleteChallenge challengeId={challenge.id} name={challenge.name} returnTo="admin" />
      </section>
    </div>
  );
}
