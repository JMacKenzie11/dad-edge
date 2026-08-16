import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ItcStage } from "./stage";

/**
 * Per-turn diagnostic event buffer. See the itc_turn_events migration
 * for schema and per-event-type payload documentation.
 *
 * Usage:
 *   const events = new TurnEventLog(mapId, turnIndex);
 *   events.record("prefetch", { msgs: 12 }, { durationMs: 42 });
 *   ...
 *   await events.flush(); // one bulk INSERT
 *
 * Buffered writes = one round-trip per turn, no matter how many events.
 * flush() failures are non-fatal — they log a warning and drop the
 * events. Nothing in the coach loop should ever await events.flush()
 * before returning to the user.
 */

export type TurnEventType =
  | "prefetch"
  | "llm_attempt"
  | "rubric"
  | "action_apply"
  | "action_rejected"
  | "extract"
  | "reconcile"
  | "backstop_fire"
  | "dedup_skip"
  | "turn_summary"
  | "error";

type TurnEventRow = {
  map_id: string;
  turn_id: string;
  turn_index: number;
  event_type: TurnEventType;
  stage: string | null;
  duration_ms: number | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export class TurnEventLog {
  readonly turnId: string;
  private readonly mapId: string;
  private readonly turnIndex: number;
  private readonly buffer: TurnEventRow[] = [];

  constructor(mapId: string, turnIndex: number, turnId?: string) {
    this.mapId = mapId;
    this.turnIndex = turnIndex;
    this.turnId = turnId ?? randomUUID();
  }

  record(
    eventType: TurnEventType,
    payload: Record<string, unknown>,
    opts: { durationMs?: number; stage?: ItcStage | null } = {},
  ): void {
    this.buffer.push({
      map_id: this.mapId,
      turn_id: this.turnId,
      turn_index: this.turnIndex,
      event_type: eventType,
      stage: opts.stage ?? null,
      duration_ms: opts.durationMs ?? null,
      payload,
      created_at: new Date().toISOString(),
    });
  }

  size(): number {
    return this.buffer.length;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0, this.buffer.length);
    try {
      const supabase = createSupabaseServiceClient();
      const { error } = await supabase.from("itc_turn_events").insert(rows);
      if (error) {
        console.warn(
          "[itc turn-events] flush failed (%d events): %s",
          rows.length,
          error.message,
        );
      }
    } catch (err) {
      console.warn(
        "[itc turn-events] flush threw (%d events): %s",
        rows.length,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
