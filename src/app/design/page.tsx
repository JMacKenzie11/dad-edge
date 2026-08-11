import Image from "next/image";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { StreakChip } from "@/components/ui/streak-chip";
import { MissionCard } from "@/components/ui/mission-card";
import { LeaderboardRow } from "@/components/ui/leaderboard-row";
import { CoachBubble, MissionCommitCard } from "@/components/ui/coach-bubble";
import { EmptyState, LoadingMark } from "@/components/ui/empty-state";
import { CheckinGrid } from "@/components/ui/checkin-grid";
import { PILLARS } from "@/lib/pillars";

export const dynamic = "force-static";

export default function DesignSystemPage() {
  // Dev-only route; block in production unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESIGN_ROUTE !== "1") {
    notFound();
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-12 space-y-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Image src="/brand/mark-white.png" alt="Centurion" width={40} height={40} />
          <div>
            <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
              BRAVE MAN OS
            </p>
            <h1 className="font-heading text-3xl">Design system</h1>
          </div>
        </div>
        <Image src="/brand/logo-white.png" alt="The Dad Edge" width={160} height={44} />
      </header>

      <Section title="Color tokens" note="No hex in components — swatches read from CSS vars.">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {[
            ["bg", "--color-bg"],
            ["surface", "--color-surface"],
            ["surface-2", "--color-surface-2"],
            ["border", "--color-border"],
            ["text", "--color-text"],
            ["text-muted", "--color-text-muted"],
            ["primary", "--color-primary"],
            ["accent", "--color-accent"],
            ["success", "--color-success"],
            ["warning", "--color-warning"],
            ["danger", "--color-danger"],
            ["coach", "--color-coach"],
          ].map(([name, v]) => (
            <div key={name} className="rounded-[var(--radius-card)] overflow-hidden border border-[color:var(--color-border)]">
              <div className="h-16" style={{ background: `var(${v})` }} />
              <div className="px-3 py-2 text-xs">
                <p className="font-heading">{name}</p>
                <p className="text-[color:var(--color-text-muted)]">{v}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-3">
          <h1 className="font-heading text-5xl">Live Legendary</h1>
          <h2 className="font-heading text-3xl text-[color:var(--color-accent)]">Log the day</h2>
          <p className="text-base">
            Body copy uses the fallback Inter until Proxima Nova is loaded from Adobe Fonts.
            Headings use Archivo until Trade Gothic Bold is licensed.
          </p>
          <p className="text-sm text-[color:var(--color-text-muted)]">Muted secondary text.</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Log today</Button>
          <Button variant="secondary">Set the mission</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger">Deactivate</Button>
          <Button variant="coach">Ask coach</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large tap</Button>
          <Button disabled>Locked</Button>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>This week</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="font-heading text-5xl">42<span className="text-2xl text-[color:var(--color-text-muted)]">/56</span></p>
              <p className="text-sm text-[color:var(--color-text-muted)] mt-2">
                Weekly Daily Living. Locks Wednesday.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Streaks</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-wrap gap-2">
              <StreakChip days={14} label="engagement" />
              <StreakChip days={9} label="Bond" />
              <StreakChip days={5} label="Vitality" />
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Check-in grid (mobile-first)">
        <div className="max-w-md mx-auto bg-[color:var(--color-surface)] p-5 rounded-[var(--radius-card)] border border-[color:var(--color-border)]">
          <CheckinGrid initial={{ B: 1, R: 1, A: 1, V: 0, E: null, M: 1, A2: null, N: null }} />
        </div>
      </Section>

      <Section title="Pillar palette">
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {PILLARS.map((p) => (
            <div
              key={p.code}
              className="h-16 rounded-[var(--radius-card)] flex items-end justify-center pb-1 font-heading text-xs"
              style={{ background: p.colorVar }}
            >
              {p.code === "A2" ? "A" : p.code}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Mission cards">
        <div className="space-y-3">
          <MissionCard
            description="Take Sarah on a date night."
            pillar="B"
            targetDate="Thu 2026-07-16"
            status="planned"
          />
          <MissionCard
            description="Deadlift PR: 405×3."
            pillar="V"
            targetDate="Sat 2026-07-11"
            status="completed"
          />
          <MissionCard
            description="Weekly finance review with Sarah."
            pillar="A"
            targetDate="Fri 2026-07-10"
            status="completed"
            late
          />
          <MissionCard
            description="Call Dad."
            pillar="R"
            targetDate="Wed 2026-07-08"
            status="missed"
          />
          <MissionCard
            description="Rewrite Q3 goals."
            pillar="M"
            targetDate="Mon 2026-07-13"
            status="rolled_over"
          />
        </div>
      </Section>

      <Section title="Leaderboard">
        <div className="space-y-2">
          <LeaderboardRow rank={1} name="Steve W" dailyTotal={52} missionRate={0.8} composite={60} streakDays={31} delta={2} />
          <LeaderboardRow rank={2} name="Tim C" dailyTotal={49} missionRate={0.75} composite={57} streakDays={22} delta={-1} />
          <LeaderboardRow rank={3} name="John Y" dailyTotal={44} missionRate={0.6} composite={49} streakDays={14} delta={0} />
          <LeaderboardRow rank={4} name="Parker B" dailyTotal={38} missionRate={0.5} composite={42} streakDays={7} delta={1} />
        </div>
      </Section>

      <Section title="Coach surface (reserved purple)">
        <div className="max-w-md space-y-3">
          <CoachBubble>
            You logged Bond four days running but haven&apos;t set a mission for Sarah&apos;s
            birthday in three weeks. What&apos;s the mission?
          </CoachBubble>
          <CoachBubble from="user">Take her hiking Saturday.</CoachBubble>
          <CoachBubble>
            Locked. Behavior plus day.
            <MissionCommitCard behavior="Take Sarah hiking." day="Sat 2026-08-01" />
          </CoachBubble>
        </div>
      </Section>

      <Section title="Empty and loading states">
        <div className="grid md:grid-cols-2 gap-4">
          <EmptyState
            title="No missions set."
            body="That's the mission."
            action={<Button className="mt-2">Set the mission</Button>}
          />
          <Card>
            <CardBody>
              <LoadingMark label="Loading week" />
            </CardBody>
          </Card>
        </div>
      </Section>

      <footer className="pt-8 border-t border-[color:var(--color-border)] text-xs text-[color:var(--color-text-muted)]">
        <p>Dev route — gated in production by ALLOW_DESIGN_ROUTE env var.</p>
      </footer>
    </main>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="font-heading text-xl text-[color:var(--color-accent)]">{title}</h2>
        {note ? <p className="text-xs text-[color:var(--color-text-muted)] mt-1">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
