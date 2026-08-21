import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { localDate } from "@/lib/scoring/week";
import { differenceInCalendarDays, format } from "date-fns";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

type PartnerRow = {
  partner_name: string | null;
  relationship_label: string | null;
  partner_birthdate: string | null;
  relationship_date: string | null;
  things_loved: string[] | null;
};

type KidRow = {
  name: string;
  birthdate: string | null;
  things_loved: string[] | null;
};

/**
 * Family provider — partner profile + kids + upcoming birthdays and
 * anniversaries in the next 30 days. Cacheable because the profile
 * itself changes rarely (name/kids don't get added weekly). Upcoming
 * dates are computed at build time; they'll refresh as new coach
 * conversations start, which is enough resolution for a "your
 * anniversary is in 12 days" reminder.
 *
 * Returns null when the man has no partner and no kids on file.
 */
export const familyProvider: ContextProvider = {
  key: "family",
  priority: 10,
  cacheable: true,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const today = localDate(new Date(), user.timezone);

    const [{ data: partner }, { data: children }] = await Promise.all([
      svc
        .from("partner_profiles")
        .select(
          "partner_name, relationship_label, partner_birthdate, relationship_date, things_loved",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      svc
        .from("children")
        .select("name, birthdate, things_loved")
        .eq("user_id", user.id),
    ]);

    const partnerData = partner as PartnerRow | null;
    const kids = (children ?? []) as KidRow[];

    if (!partnerData?.partner_name && kids.length === 0) return null;

    const upcoming = upcomingFamilyEvents(partnerData, kids, today, 30);
    const text = renderFamily(partnerData, kids, upcoming);
    return {
      label: "Family layer",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};

function renderFamily(
  partner: PartnerRow | null,
  kids: KidRow[],
  events: { label: string; date: string; daysAway: number }[],
): string {
  const parts: string[] = [];
  if (partner?.partner_name) {
    const label = partner.relationship_label ?? "partner";
    parts.push(`  Partner: ${partner.partner_name} (${label})`);
    if (partner.things_loved && partner.things_loved.length > 0) {
      parts.push(
        `  What he loves about her:\n${partner.things_loved
          .filter(Boolean)
          .map((t) => `    - ${t}`)
          .join("\n")}`,
      );
    }
  }
  if (kids.length > 0) {
    parts.push("  Kids:");
    for (const k of kids) {
      const loves =
        k.things_loved && k.things_loved.length > 0
          ? ` — loves: ${k.things_loved.filter(Boolean).slice(0, 3).join("; ")}`
          : "";
      parts.push(
        `    - ${k.name}${k.birthdate ? ` (b. ${k.birthdate})` : ""}${loves}`,
      );
    }
  }
  if (events.length > 0) {
    parts.push("  Coming up in the next 30 days:");
    for (const e of events) {
      parts.push(
        `    - ${e.date} · ${e.label} · in ${e.daysAway} day${e.daysAway === 1 ? "" : "s"}`,
      );
    }
  }
  return parts.join("\n");
}

function upcomingFamilyEvents(
  partner: PartnerRow | null,
  kids: KidRow[],
  todayIso: string,
  windowDays: number,
): { label: string; date: string; daysAway: number }[] {
  const today = new Date(`${todayIso}T00:00:00`);
  const out: { label: string; date: string; daysAway: number }[] = [];
  const push = (label: string, monthDay: string) => {
    const [m, d] = monthDay.split("-").map(Number);
    if (!m || !d) return;
    let next = new Date(today.getFullYear(), m - 1, d);
    if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
    const daysAway = differenceInCalendarDays(next, today);
    if (daysAway <= windowDays) {
      out.push({ label, date: format(next, "yyyy-MM-dd"), daysAway });
    }
  };
  if (partner?.partner_birthdate) {
    push(
      `${partner.partner_name ?? "partner"}'s birthday`,
      partner.partner_birthdate.slice(5),
    );
  }
  if (partner?.relationship_date) {
    push("anniversary", partner.relationship_date.slice(5));
  }
  for (const k of kids) {
    if (k.birthdate) push(`${k.name}'s birthday`, k.birthdate.slice(5));
  }
  return out.sort((a, b) => a.daysAway - b.daysAway);
}
