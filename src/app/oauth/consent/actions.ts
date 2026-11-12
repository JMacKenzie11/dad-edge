"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { auditLog } from "@/lib/audit";

const Id = z.string().min(8).max(200).regex(/^[A-Za-z0-9_-]+$/);

export type ConsentResult = { error?: string };

/**
 * Allow or decline an AI app's sign-in. Allow is checked again here: the
 * person must still be a platform admin and the app still approved. The
 * token hook asks the same two questions when the token is issued.
 */
async function decide(formData: FormData, allow: boolean): Promise<ConsentResult> {
  const id = Id.safeParse(formData.get("authorization_id"));
  if (!id.success) return { error: "This request isn't complete. Start again from the AI app." };
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id.data}`)}`);

  if (allow) {
    const details = await supabase.auth.oauth.getAuthorizationDetails(id.data);
    const clientId = details.data && "client" in details.data ? details.data.client.id : null;
    const svc = createSupabaseServiceClient();
    const [trusted, admin] = await Promise.all([
      clientId ? svc.rpc("mcp_client_trusted", { p_client_id: clientId }) : Promise.resolve({ data: false }),
      svc.rpc("mcp_user_is_admin", { p_user_id: auth.user.id }),
    ]);
    if (trusted.data !== true || admin.data !== true) return { error: "This connection isn't allowed." };
    const { data, error } = await supabase.auth.oauth.approveAuthorization(id.data, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) return { error: "That request has expired. Start again from the AI app." };
    await auditLog({ actor_user_id: auth.user.id, action: "mcp.oauth_allowed", target_type: "oauth_client", target_id: clientId, metadata: {} });
    redirect(data.redirect_url);
  }

  const { data, error } = await supabase.auth.oauth.denyAuthorization(id.data, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) return { error: "That request has expired. You can close this page." };
  redirect(data.redirect_url);
}

export async function allowApp(_prev: ConsentResult, formData: FormData): Promise<ConsentResult> {
  return decide(formData, true);
}

export async function declineApp(_prev: ConsentResult, formData: FormData): Promise<ConsentResult> {
  return decide(formData, false);
}
