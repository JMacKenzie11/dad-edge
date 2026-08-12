/**
 * Drive a full coach turn end-to-end without going through the browser
 * or the auth layer. Calls runCoachTurnForMap (the auth-free core of
 * sendCoachMessage), so every backstop, cascade, retag, and side effect
 * runs exactly as it would in production.
 *
 * Returns the final assistant message on the map after the turn — the
 * text the coachee would see in the chat pane. Useful for regex asserts
 * on transition replies.
 */

import { runCoachTurnForMap } from "@/app/itc/actions";
import { getMapById, listMessages, type ItcMap } from "@/lib/itc/maps";

export type TurnResult = {
  ok: boolean;
  reason?: string;
  finalMap: ItcMap;
  assistantReply: string;
};

export async function runTurn(
  mapId: string,
  userText: string,
): Promise<TurnResult> {
  const result = await runCoachTurnForMap(mapId, userText);
  const [finalMap, messages] = await Promise.all([
    getMapById(mapId),
    listMessages(mapId),
  ]);
  if (!finalMap) {
    throw new Error(`runTurn: map ${mapId} not found after turn`);
  }
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant");
  return {
    ok: result.ok,
    reason: result.reason,
    finalMap,
    assistantReply: lastAssistant?.content ?? "",
  };
}
