import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Identity provider — the man's name, timezone, work, why-yes intent,
 * and community affiliation. Cacheable because this changes on the
 * order of weeks (rare) or never (name, timezone).
 */
export const identityProvider: ContextProvider = {
  key: "identity",
  priority: 0, // renders first
  cacheable: true,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const svc = createSupabaseServiceClient();
    const [{ data: mem }, { data: userRow }] = await Promise.all([
      svc
        .from("memberships")
        .select("communities:community_id(name)")
        .eq("user_id", user.id)
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
      svc.from("users").select("why_yes").eq("id", user.id).maybeSingle(),
    ]);
    const raw = mem as
      | { communities: { name: string } | { name: string }[] | null }
      | null;
    const communityName = raw?.communities
      ? Array.isArray(raw.communities)
        ? (raw.communities[0]?.name ?? null)
        : (raw.communities.name ?? null)
      : null;
    const whyYes = (userRow as { why_yes: string | null } | null)?.why_yes ?? null;

    const employmentLabel = user.employment_type
      ? {
          w2: "W2 employee",
          contract: "Contractor",
          self_employed: "Self-employed",
          business_owner: "Business owner",
          other: "Other",
        }[user.employment_type]
      : null;
    const workLine =
      [user.occupation, employmentLabel].filter(Boolean).join(" · ") ||
      "(not on file)";

    const whyLine = whyYes && whyYes.trim()
      ? `Why he showed up: ${whyYes.trim()}`
      : null;

    const lines = [
      `Name: ${user.first_name ?? "(unknown)"} ${user.last_name ?? ""}`.trim(),
      `Timezone: ${user.timezone}`,
      `Community: ${communityName ?? "(none)"}`,
      `Work: ${workLine}`,
    ];
    if (whyLine) lines.push(whyLine);

    const text = lines.join("\n");
    return {
      label: "The man",
      text,
      tokenEstimate: estimateTokens(text),
    };
  },
};
