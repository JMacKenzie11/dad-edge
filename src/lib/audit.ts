import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Write an audit log row. Use for every admin/leader mutation and every
 * service-role read (§3 posture). Never throws — audit failures must not
 * block the caller, but they are logged to console.
 */
export async function auditLog(entry: {
  actor_user_id: string | null;
  action: string;
  target_type?: string;
  target_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const svc = createSupabaseServiceClient();
  const { error } = await svc.from("audit_log").insert({
    actor_user_id: entry.actor_user_id,
    action: entry.action,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) console.error("audit_log insert failed", error, entry);
}
