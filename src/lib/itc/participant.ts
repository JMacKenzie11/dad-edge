import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type ItcParticipant = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_seen_at: string | null;
};

/**
 * Look up an ITC participant by email, creating the row if it doesn't exist.
 * Never touches public.users. This is the ITC-side identity boundary: a
 * matching email in public.users does NOT link the two.
 */
export async function upsertParticipantByEmail(
  email: string,
): Promise<ItcParticipant> {
  const supabase = createSupabaseServiceClient();
  const normalized = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from("itc_participants")
    .upsert(
      { email: normalized, last_seen_at: new Date().toISOString() },
      { onConflict: "email" },
    )
    .select("id, email, name, created_at, last_seen_at")
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert ITC participant: ${error?.message ?? "no row"}`);
  }
  return data as ItcParticipant;
}

export async function listAllParticipants(): Promise<ItcParticipant[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_participants")
    .select("id, email, name, created_at, last_seen_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`listAllParticipants: ${error.message}`);
  return (data ?? []) as ItcParticipant[];
}

export async function getParticipantById(id: string): Promise<ItcParticipant | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("itc_participants")
    .select("id, email, name, created_at, last_seen_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Failed to read ITC participant: ${error.message}`);
  return (data as ItcParticipant | null) ?? null;
}
