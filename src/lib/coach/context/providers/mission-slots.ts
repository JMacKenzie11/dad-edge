import { loadCoachMissionPlan, renderCoachMissionPlan } from "@/lib/missions/coach-slots";
import type { SessionUser } from "@/lib/session";
import type { ContextBlock, ContextProvider } from "../types";
import { estimateTokens } from "../util";

/**
 * Mission slots provider: which of his weekly slots are still open this
 * week and next, and his open goals numbered for goal_number. The coach
 * reads it so suggestions land in open slots; send-message.ts checks the
 * suggestion against the same plan (fitSuggestion) before he sees it.
 *
 * Not cacheable: a slot fills the moment he adds a mission.
 */
export const missionSlotsProvider: ContextProvider = {
  key: "mission_slots",
  priority: 26,
  cacheable: false,

  async build(user: SessionUser): Promise<ContextBlock | null> {
    const plan = await loadCoachMissionPlan(user.id, user.timezone);
    const text = renderCoachMissionPlan(plan);
    return { label: "Open mission slots", text, tokenEstimate: estimateTokens(text) };
  },
};
