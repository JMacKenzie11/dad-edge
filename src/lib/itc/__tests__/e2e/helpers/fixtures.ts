/**
 * E2E test fixtures — create a fresh participant + map for each test,
 * clean up at the end. All fixtures use timestamped emails
 * (`e2e-<uuid>@test.local`) so parallel test runs don't collide and
 * dev-database inspection can tell test data from real data at a glance.
 */

import { randomUUID } from "node:crypto";
import { createMap } from "@/lib/itc/maps";
import { upsertParticipantByEmail } from "@/lib/itc/participant";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PillarCode } from "@/lib/pillars";

export type TestMapContext = {
  participantId: string;
  mapId: string;
  email: string;
  pillar: PillarCode;
};

export async function createTestMap(
  pillar: PillarCode = "A",
): Promise<TestMapContext> {
  const email = `e2e-${randomUUID()}@test.local`;
  const participant = await upsertParticipantByEmail(email);
  const map = await createMap(participant.id, pillar);
  return {
    participantId: participant.id,
    mapId: map.id,
    email,
    pillar,
  };
}

/**
 * Delete the participant row — cascades to map + everything under it via
 * the ON DELETE CASCADE constraints in the schema. Call in afterEach so
 * dev database doesn't accumulate junk across test runs.
 */
export async function cleanupTestMap(ctx: TestMapContext): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("itc_participants")
    .delete()
    .eq("id", ctx.participantId);
  if (error) {
    // Non-fatal — test data cleanup shouldn't fail the test. Log so
    // maintainers can spot accumulating junk.
    // eslint-disable-next-line no-console
    console.warn(
      "[e2e cleanup] failed to delete participant %s: %s",
      ctx.participantId,
      error.message,
    );
  }
}
