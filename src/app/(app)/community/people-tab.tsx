"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { BadgeTier, CommunityMember } from "@/lib/community/people-directory";

type SortKey = "activity" | "streak" | "missions" | "newest" | "az";

/**
 * People tab client shell. Server hands over the fully-computed roster
 * (aggregates, badges, thread ids) so the client only handles filter
 * + sort + render — no data fetching on the wire.
 */
export function PeopleTab({
  members,
  viewerId,
}: {
  members: CommunityMember[];
  viewerId: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("activity");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? members.filter((m) => m.name.toLowerCase().includes(q))
      : members;
    return sortMembers(filtered, sort);
  }, [members, query, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="flex-1 h-10 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm placeholder:text-[color:var(--color-text-muted)] focus:outline-none focus:border-[color:var(--color-accent)]"
        />
        <label className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
            SORT
          </span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-10 px-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-xs cursor-pointer"
          >
            <option value="activity">Most active</option>
            <option value="streak">Longest streak</option>
            <option value="missions">Missions %</option>
            <option value="newest">Newest member</option>
            <option value="az">A → Z</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)] italic py-6 text-center">
          {query
            ? `No brothers matching "${query}".`
            : "No brothers in your community yet."}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <MemberCard key={m.userId} member={m} viewerId={viewerId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MemberCard({
  member,
  viewerId,
}: {
  member: CommunityMember;
  viewerId: string;
}) {
  void viewerId; // reserved for future "you" annotations
  const messageHref = member.threadIdWithMe
    ? `/messages/${member.threadIdWithMe}`
    : `/messages/with/${member.userId}`;

  return (
    <li className="p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] hover:border-[color:var(--color-primary)]/60 transition-colors">
      <div className="flex items-start gap-3">
        <UserAvatar
          url={member.avatarUrl}
          firstName={member.firstName}
          lastName={member.lastName}
          email={member.email}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-heading text-base truncate">{member.name}</p>
            {member.role === "leader" ? (
              <span className="text-[9px] font-heading tracking-widest px-1.5 py-0.5 rounded border border-[color:var(--color-accent)]/50 text-[color:var(--color-accent)]">
                LEADER
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-[color:var(--color-text-muted)]">
            {[
              member.city,
              member.isNewMember
                ? `${member.tenureWeeks} week${member.tenureWeeks === 1 ? "" : "s"} in`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || "\u00A0"}
          </p>

          {member.goals.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 mt-2">
              {member.goals.map((g, i) => (
                <li
                  key={i}
                  title={g.text}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-heading tracking-widest"
                  style={{
                    borderColor: g.colorVar,
                    color: g.colorVar,
                    background: `color-mix(in oklab, ${g.colorVar} 12%, transparent)`,
                  }}
                >
                  {g.pillarLabel.toUpperCase()}
                  {g.isItc ? (
                    <span className="text-[8px] opacity-70">IMPROVEMENT</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex items-center gap-4 text-xs flex-wrap">
            <Metric
              label="DAILY"
              value={`${member.dailyLivingAvg.toFixed(1)}`}
              suffix="/49 avg"
              badge={member.badges.dailyLiving}
            />
            <Metric
              label="MISSIONS"
              value={
                member.missionPct === null
                  ? "—"
                  : `${Math.round(member.missionPct)}%`
              }
              suffix={member.missionPct === null ? "no plans" : ""}
              badge={member.badges.missions}
            />
            <Metric
              label="STREAK"
              value={`${member.streak}d`}
              suffix=""
              badge={member.badges.streak}
            />
          </div>
        </div>

        <Link
          href={messageHref}
          aria-label="Message this brother"
          title={`Message ${member.name}`}
          className="shrink-0 h-9 w-9 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)]/10 flex items-center justify-center text-[color:var(--color-text-muted)] hover:text-white transition-colors cursor-pointer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </Link>
      </div>
    </li>
  );
}

function Metric({
  label,
  value,
  suffix,
  badge,
}: {
  label: string;
  value: string;
  suffix?: string;
  badge: BadgeTier | null;
}) {
  return (
    <div className="flex items-baseline gap-1">
      {badge ? <BadgePip tier={badge} /> : null}
      <span className="text-[9px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
        {label}
      </span>
      <span className="font-heading text-sm">{value}</span>
      {suffix ? (
        <span className="text-[10px] text-[color:var(--color-text-muted)]">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

function BadgePip({ tier }: { tier: BadgeTier }) {
  const color =
    tier === "gold"
      ? "#f5c542"
      : tier === "silver"
        ? "#c8ccd1"
        : "#c8752e";
  const label =
    tier === "gold" ? "Top of the community" : tier === "silver" ? "Top 2" : "Top 3";
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ background: color }}
    />
  );
}

function sortMembers(members: CommunityMember[], sort: SortKey): CommunityMember[] {
  const arr = [...members];
  switch (sort) {
    case "streak":
      return arr.sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));
    case "missions":
      return arr.sort((a, b) => {
        const av = a.missionPct ?? -1;
        const bv = b.missionPct ?? -1;
        return bv - av || a.name.localeCompare(b.name);
      });
    case "newest":
      return arr.sort((a, b) => a.tenureWeeks - b.tenureWeeks || a.name.localeCompare(b.name));
    case "az":
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case "activity":
    default:
      return arr.sort(
        (a, b) => b.dailyLivingAvg - a.dailyLivingAvg || a.name.localeCompare(b.name),
      );
  }
}
