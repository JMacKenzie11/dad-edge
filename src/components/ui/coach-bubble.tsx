import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Coach surface: purple accent, Centurion mark as avatar.
 * Reserved exclusively for the AI coach per §9.3.
 */
export function CoachBubble({
  children,
  className,
  from = "coach",
}: {
  children: React.ReactNode;
  className?: string;
  from?: "coach" | "user";
}) {
  const isCoach = from === "coach";
  return (
    <div className={cn("flex gap-3", isCoach ? "" : "flex-row-reverse", className)}>
      {isCoach ? (
        <div
          className="h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--color-coach)" }}
        >
          <Image src="/brand/mark-white.png" alt="" width={22} height={22} />
        </div>
      ) : (
        <div className="h-9 w-9 rounded-full bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] flex-shrink-0" />
      )}
      <div
        className={cn(
          "max-w-[80%] px-4 py-3 rounded-[var(--radius-card)] text-sm leading-relaxed",
          isCoach
            ? "text-white"
            : "bg-[color:var(--color-surface-2)] border border-[color:var(--color-border)] text-[color:var(--color-text)]",
        )}
        style={isCoach ? { background: "var(--color-coach)" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export function MissionCommitCard({
  behavior,
  day,
  onAccept,
}: {
  behavior: string;
  day: string;
  onAccept?: () => void;
}) {
  return (
    <div
      className="mt-2 p-4 rounded-[var(--radius-card)] border-2"
      style={{ borderColor: "var(--color-coach)", background: "var(--color-surface-2)" }}
    >
      <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-coach)]">
        MISSION
      </p>
      <p className="mt-1 text-base font-heading">{behavior}</p>
      <p className="text-xs text-[color:var(--color-text-muted)]">{day}</p>
      <button
        type="button"
        onClick={onAccept}
        className="mt-3 h-9 px-4 rounded-md font-heading text-xs tracking-wide"
        style={{ background: "var(--color-coach)", color: "white" }}
      >
        Accept mission
      </button>
    </div>
  );
}
