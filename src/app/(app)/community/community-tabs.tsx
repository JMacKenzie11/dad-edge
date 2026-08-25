import Link from "next/link";

/**
 * Two-tab strip for /community. Rendered as server-side links, not
 * client state — each tab is a distinct query on the server and
 * doesn't need to preserve any client-side selection.
 *
 * Leaderboard = the existing weekly ranking view. People = the
 * roster with 6-week aggregates + Message buttons. Kept as ?tab=
 * params on the same route (rather than /community/people as a
 * separate page) so the nav item + browser history stay simple.
 */
export function CommunityTabs({
  active,
}: {
  active: "leaderboard" | "people";
}) {
  return (
    <div className="flex gap-1 border-b border-[color:var(--color-border)]">
      <Tab href="/community?tab=leaderboard" label="Leaderboard" active={active === "leaderboard"} />
      <Tab href="/community?tab=people" label="People" active={active === "people"} />
    </div>
  );
}

function Tab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        "px-4 py-2 -mb-px font-heading text-xs tracking-widest border-b-2 transition-colors " +
        (active
          ? "border-[color:var(--color-accent)] text-white"
          : "border-transparent text-[color:var(--color-text-muted)] hover:text-white")
      }
    >
      {label.toUpperCase()}
    </Link>
  );
}
