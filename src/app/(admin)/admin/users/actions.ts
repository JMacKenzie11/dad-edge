"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { auditLog } from "@/lib/audit";
import { isStageBEmailLive, sendActivationEmail } from "@/lib/email";

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3300";
}

const CreateAccountSchema = z
  .object({
    email: z.string().email().max(254),
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(80).optional(),
    // Optional so admin-only accounts can be created without a
    // community assignment. When present must be a uuid; when
    // absent the account creates with no membership.
    community_id: z.string().uuid().optional(),
    subscription_status: z
      .enum(["trialing", "active", "past_due", "canceled", "comped"])
      .default("comped"),
    // Checkbox on the New Account form. When true, sets
    // is_platform_admin on the users row in the same insert so
    // creating an admin is a single step (was: create then flip on
    // the detail page).
    is_platform_admin: z.string().optional(),
    // Admin-only: skips onboarding, no community assignment, no
    // coachee shell. Must be paired with is_platform_admin=on
    // (enforced by the users_admin_only_requires_platform_admin
    // DB CHECK; validated here too so we can return a friendly error).
    is_admin_only: z.string().optional(),
  })
  .refine(
    (v) =>
      // When NOT admin-only, community_id is required (matches
      // pre-admin-only behavior — a coachee without a community is
      // broken).
      v.is_admin_only === "on" || !!v.community_id,
    { message: "Community required unless Admin-only is checked." },
  )
  .refine(
    (v) =>
      // Admin-only requires platform admin. Otherwise the user has
      // literally no accessible surface.
      v.is_admin_only !== "on" || v.is_platform_admin === "on",
    { message: "Admin-only requires Platform Admin." },
  );

/**
 * Create an account. NEVER sends any email. The user exists in
 * auth.users with email_confirm=true (so future sign-ins work) but
 * has no password. They cannot sign in until Send Invite fires.
 * Community assignment is required and manual — the whole point of
 * Section 5 of the auth-phase spec.
 */
export async function createAccount(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const rawCommunityId = formData.get("community_id");
  const parsed = CreateAccountSchema.safeParse({
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    first_name: String(formData.get("first_name") ?? "").trim() || undefined,
    last_name: String(formData.get("last_name") ?? "").trim() || undefined,
    community_id:
      typeof rawCommunityId === "string" && rawCommunityId.length > 0
        ? rawCommunityId
        : undefined,
    subscription_status:
      formData.get("subscription_status") || undefined,
    is_platform_admin: formData.get("is_platform_admin") ?? undefined,
    is_admin_only: formData.get("is_admin_only") ?? undefined,
  });
  if (!parsed.success) {
    redirect(
      `/admin/users?error=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? "Bad input.",
      )}`,
    );
  }

  const svc = createSupabaseServiceClient();

  const { data: existing } = await svc
    .from("users")
    .select("id, email")
    .eq("email", parsed.data.email)
    .maybeSingle();
  if (existing) {
    redirect(
      `/admin/users?error=${encodeURIComponent(`An account already exists for ${parsed.data.email}.`)}`,
    );
  }

  // Create the auth user with email_confirm=true and no password.
  // The public.users row is created by the handle_new_auth_user
  // trigger; we then patch first/last/subscription in a follow-up
  // update since the trigger doesn't know those fields.
  const { data: authRes, error: authErr } = await svc.auth.admin.createUser({
    email: parsed.data.email,
    email_confirm: true,
  });
  if (authErr || !authRes.user) {
    redirect(
      `/admin/users?error=${encodeURIComponent(`Create failed: ${authErr?.message ?? "no user returned"}`)}`,
    );
  }
  const userId = authRes.user.id;

  const isPlatformAdmin = parsed.data.is_platform_admin === "on";
  const isAdminOnly = parsed.data.is_admin_only === "on";
  await svc
    .from("users")
    .update({
      first_name: parsed.data.first_name ?? null,
      last_name: parsed.data.last_name ?? null,
      subscription_status: parsed.data.subscription_status,
      subscription_source: "manual",
      is_platform_admin: isPlatformAdmin,
      is_admin_only: isAdminOnly,
    })
    .eq("id", userId);

  // Membership only when NOT admin-only. Admin-only users have
  // no community by design.
  if (!isAdminOnly && parsed.data.community_id) {
    await svc.from("memberships").insert({
      user_id: userId,
      community_id: parsed.data.community_id,
      role: "member",
      status: "active",
    });
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "user.create",
    target_type: "user",
    target_id: userId,
    metadata: {
      email: parsed.data.email,
      community_id: parsed.data.community_id ?? null,
      subscription_status: parsed.data.subscription_status,
      is_platform_admin: isPlatformAdmin,
      is_admin_only: isAdminOnly,
    },
  });

  revalidatePath("/admin/users");
  redirect(`/admin/users/${userId}?created=1`);
}

const SendInviteSchema = z.object({
  user_id: z.string().uuid(),
});

/**
 * Send an activation invite to a user. Sends via Supabase's default
 * email sender for Stage A; swap to Resend in Checkpoint D. Sets
 * invited_at = now(). The recipient lands on /auth/callback →
 * /set-password.
 *
 * Idempotent-ish: re-sending simply generates a fresh link and
 * re-stamps invited_at. Prior invite links are invalidated by
 * Supabase's token rotation.
 */
export async function sendInvite(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = SendInviteSchema.safeParse({
    user_id: formData.get("user_id"),
  });
  if (!parsed.success) return;

  const svc = createSupabaseServiceClient();
  const { data: userRow } = await svc
    .from("users")
    .select("id, email, first_name")
    .eq("id", parsed.data.user_id)
    .maybeSingle();
  if (!userRow) {
    redirect(`/admin/users?error=${encodeURIComponent("User not found.")}`);
  }
  const user = userRow as {
    id: string;
    email: string;
    first_name: string | null;
  };

  const inviteErr = await deliverActivationInvite(user);
  if (inviteErr) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(`Invite failed: ${inviteErr}`)}`,
    );
  }

  await svc
    .from("users")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", parsed.data.user_id);

  await auditLog({
    actor_user_id: admin.id,
    action: "user.invite_sent",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { email: user.email, stage: isStageBEmailLive() ? "B" : "A" },
  });

  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${parsed.data.user_id}?invited=1`);
}

/**
 * Deliver an activation email to a user, using the right sender for
 * the current stage.
 *
 * Uses Supabase's RECOVERY link, not INVITE. Rationale: createAccount
 * has already created the auth.users row (email_confirm=true, no
 * password), so the user *already exists*. Supabase's invite type
 * (inviteUserByEmail / generateLink type=invite) refuses existing
 * users with "A user with this email address has already been
 * registered". Recovery works whether the user has a password or
 * not, drops them into a session, and — with redirectTo pointing at
 * /set-password — lands them on the same activation flow.
 *
 * Stage A (default, EMAIL_STAGE unset or !== "B"): call
 * supabase.auth.resetPasswordForEmail — Supabase generates the link
 * AND sends its own default template. Ugly, unbranded, but unblocks
 * testing without any DNS work. Safe for internal use; MUST NOT be
 * used to invite a real person.
 *
 * Stage B (EMAIL_STAGE=B + RESEND_API_KEY set): generate the recovery
 * link via svc.auth.admin.generateLink({type: 'recovery'}) but skip
 * Supabase's sender; deliver our own branded email via Resend using
 * the activation copy in src/lib/copy/auth-emails.ts. Copy still
 * reads as "activation" — from the user's POV this is their first
 * password-set, even though under the hood it's a recovery flow.
 *
 * Returns a string error message on failure, null on success.
 */
async function deliverActivationInvite(user: {
  id: string;
  email: string;
  first_name: string | null;
}): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const redirectTo = `${appOrigin()}/auth/callback?next=/set-password`;

  if (!isStageBEmailLive()) {
    // Stage A: let Supabase send its default reset email.
    const { createSupabaseServerClient } = await import(
      "@/lib/supabase/server"
    );
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo,
    });
    return error?.message ?? null;
  }

  // Stage B: generate the link without sending Supabase's default,
  // then deliver our own branded email via Resend.
  const { data, error: linkErr } = await svc.auth.admin.generateLink({
    type: "recovery",
    email: user.email,
    options: { redirectTo },
  });
  if (linkErr) return linkErr.message;
  const actionLink = data.properties?.action_link;
  if (!actionLink) return "generateLink returned no action_link";

  // Look up the user's community for the greeting.
  const { data: membership } = await svc
    .from("memberships")
    .select("communities:community_id(name)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const memRaw = membership as
    | { communities: { name: string } | { name: string }[] | null }
    | null;
  const communityName = memRaw?.communities
    ? Array.isArray(memRaw.communities)
      ? (memRaw.communities[0]?.name ?? null)
      : (memRaw.communities.name ?? null)
    : null;

  const result = await sendActivationEmail({
    to: user.email,
    firstName: user.first_name,
    communityName,
    activationUrl: actionLink,
  });
  return result.ok ? null : result.error;
}

const SendInvitesBatchSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(200),
});

/**
 * Batch Send Invite. Any per-user failure is logged and the batch
 * continues — one bad address doesn't block the rest.
 */
export async function sendInvitesBatch(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const raw = formData.getAll("user_ids").map((v) => String(v));
  const parsed = SendInvitesBatchSchema.safeParse({ user_ids: raw });
  if (!parsed.success) {
    redirect(
      `/admin/users?error=${encodeURIComponent("Select at least one user.")}`,
    );
  }

  const svc = createSupabaseServiceClient();
  const { data: userRows } = await svc
    .from("users")
    .select("id, email, first_name")
    .in("id", parsed.data.user_ids);
  const rows = (userRows ?? []) as Array<{
    id: string;
    email: string;
    first_name: string | null;
  }>;

  let sent = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();
  const stage = isStageBEmailLive() ? "B" : "A";

  for (const u of rows) {
    const err = await deliverActivationInvite(u);
    if (err) {
      console.warn("[admin] batch invite failed for %s: %s", u.email, err);
      failed += 1;
      continue;
    }
    await svc.from("users").update({ invited_at: nowIso }).eq("id", u.id);
    await auditLog({
      actor_user_id: admin.id,
      action: "user.invite_sent",
      target_type: "user",
      target_id: u.id,
      metadata: { email: u.email, batch: true, stage },
    });
    sent += 1;
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users?batch_sent=${sent}&batch_failed=${failed}`);
}

const StatusSchema = z.object({
  user_id: z.string().uuid(),
  subscription_status: z.enum(["trialing", "active", "past_due", "canceled", "comped"]),
  reason: z.string().max(240).optional(),
});

export async function setSubscriptionStatus(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = StatusSchema.safeParse({
    user_id: formData.get("user_id"),
    subscription_status: formData.get("subscription_status"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) redirect(`/admin/users?error=${encodeURIComponent("Bad input.")}`);
  const svc = createSupabaseServiceClient();

  const { data: previous } = await svc
    .from("users")
    .select("subscription_status")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  const updates: Record<string, unknown> = {
    subscription_status: parsed.data.subscription_status,
    subscription_source: "manual",
  };
  if (parsed.data.subscription_status === "canceled") {
    updates.canceled_at = new Date().toISOString();
  } else {
    updates.canceled_at = null;
  }

  const { error } = await svc.from("users").update(updates).eq("id", parsed.data.user_id);
  if (error) redirect(`/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`);

  // Mirror on the membership: canceled users stay visible for 30 days per §5.
  if (parsed.data.subscription_status === "canceled") {
    const visibleUntil = new Date(Date.now() + 30 * 86400_000).toISOString();
    await svc
      .from("memberships")
      .update({
        status: "inactive",
        deactivated_at: new Date().toISOString(),
        canceled_visible_until: visibleUntil,
      })
      .eq("user_id", parsed.data.user_id);
  } else {
    // Reactivate memberships that were only inactive because of cancellation.
    await svc
      .from("memberships")
      .update({
        status: "active",
        deactivated_at: null,
        canceled_visible_until: null,
      })
      .eq("user_id", parsed.data.user_id)
      .eq("status", "inactive");
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "entitlement.set",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: {
      from: (previous as { subscription_status: string } | null)?.subscription_status ?? null,
      to: parsed.data.subscription_status,
      reason: parsed.data.reason ?? null,
    },
  });

  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  revalidatePath("/admin/users");
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

const DeleteUserSchema = z.object({
  user_id: z.string().uuid(),
  /** Typed confirmation — must exactly equal the user's email. Guards
   *  against fat-finger clicks and misrouted forms. */
  confirm_email: z.string().min(1).max(254),
});

/**
 * Hard-delete a user account. Removes the auth.users row (which
 * cascades to public.users and any FK-cascaded child data via the
 * schema) and, for safety, explicitly deletes the public.users row
 * afterward in case the FK isn't set to cascade.
 *
 * Guardrails:
 *  - Admin can't delete themselves (would lock out the caller mid-request).
 *  - Requires typed email confirmation matching the target's email.
 *  - Audit-logged before the delete so we still have a record after
 *    the row is gone.
 *
 * This is destructive and non-reversible. There is no soft-delete
 * flag here — cancellation lives in setSubscriptionStatus.
 */
export async function deleteUser(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = DeleteUserSchema.safeParse({
    user_id: formData.get("user_id"),
    confirm_email: String(formData.get("confirm_email") ?? "").trim().toLowerCase(),
  });
  if (!parsed.success) {
    redirect(
      `/admin/users?error=${encodeURIComponent("Bad delete input.")}`,
    );
  }

  if (parsed.data.user_id === admin.id) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(
        "You can't delete your own account.",
      )}`,
    );
  }

  const svc = createSupabaseServiceClient();
  const { data: userRow } = await svc
    .from("users")
    .select("id, email")
    .eq("id", parsed.data.user_id)
    .maybeSingle();
  if (!userRow) {
    redirect(`/admin/users?error=${encodeURIComponent("User not found.")}`);
  }
  const target = userRow as { id: string; email: string };

  if (target.email.trim().toLowerCase() !== parsed.data.confirm_email) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(
        "Confirmation email didn't match. Nothing deleted.",
      )}`,
    );
  }

  await auditLog({
    actor_user_id: admin.id,
    action: "user.delete",
    target_type: "user",
    target_id: target.id,
    metadata: { email: target.email },
  });

  const { error: authErr } = await svc.auth.admin.deleteUser(target.id);
  if (authErr) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(
        `Auth delete failed: ${authErr.message}`,
      )}`,
    );
  }

  // Safety net: if the public.users FK isn't set to ON DELETE CASCADE
  // the row may still exist. Idempotent — deletes nothing if it's
  // already gone.
  await svc.from("users").delete().eq("id", target.id);

  revalidatePath("/admin/users");
  redirect(
    `/admin/users?error=${encodeURIComponent(`Deleted ${target.email}.`)}`,
  );
}

const DeleteUsersBatchSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(100),
  /** Typed confirmation for the batch — must be the literal string
   *  "DELETE" (case-sensitive). Same guardrail as the single-delete
   *  but the confirmation is universal (bulk typing 50 emails is
   *  impractical). */
  confirm_text: z.literal("DELETE"),
});

/**
 * Batch hard-delete. Loops through user_ids, deleting each. Any
 * per-user failure is logged and the batch continues — a single bad
 * row doesn't block the rest.
 *
 * Guardrails:
 *  - Admin can't delete themselves (skipped silently, counted as
 *    "self" in the summary).
 *  - Requires typed "DELETE" confirmation from the dialog.
 *  - Every delete is audit-logged before it fires.
 */
export async function deleteUsersBatch(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const raw = formData.getAll("user_ids").map((v) => String(v));
  const parsed = DeleteUsersBatchSchema.safeParse({
    user_ids: raw,
    confirm_text: String(formData.get("confirm_text") ?? ""),
  });
  if (!parsed.success) {
    redirect(
      `/admin/users?error=${encodeURIComponent(
        "Select at least one user and type DELETE to confirm.",
      )}`,
    );
  }

  const svc = createSupabaseServiceClient();
  const { data: userRows } = await svc
    .from("users")
    .select("id, email")
    .in("id", parsed.data.user_ids);
  const rows = (userRows ?? []) as Array<{ id: string; email: string }>;

  let deleted = 0;
  let failed = 0;
  let self = 0;

  for (const u of rows) {
    if (u.id === admin.id) {
      self += 1;
      continue;
    }
    await auditLog({
      actor_user_id: admin.id,
      action: "user.delete",
      target_type: "user",
      target_id: u.id,
      metadata: { email: u.email, batch: true },
    });
    const { error: authErr } = await svc.auth.admin.deleteUser(u.id);
    if (authErr) {
      console.warn(
        "[admin] batch delete auth failed for %s: %s",
        u.email,
        authErr.message,
      );
      failed += 1;
      continue;
    }
    await svc.from("users").delete().eq("id", u.id);
    deleted += 1;
  }

  revalidatePath("/admin/users");
  const summary = `Deleted ${deleted}${
    self > 0 ? `, skipped self (${self})` : ""
  }${failed > 0 ? `, ${failed} failed (check logs)` : ""}.`;
  redirect(`/admin/users?error=${encodeURIComponent(summary)}`);
}

const AdminFlagSchema = z.object({
  user_id: z.string().uuid(),
  is_platform_admin: z.enum(["on", "off"]).transform((v) => v === "on"),
});

export async function setPlatformAdmin(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = AdminFlagSchema.safeParse({
    user_id: formData.get("user_id"),
    is_platform_admin: formData.get("is_platform_admin") ? "on" : "off",
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  await svc
    .from("users")
    .update({ is_platform_admin: parsed.data.is_platform_admin })
    .eq("id", parsed.data.user_id);
  await auditLog({
    actor_user_id: admin.id,
    action: "user.set_platform_admin",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { value: parsed.data.is_platform_admin },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

const ItcAccessFlagSchema = z.object({
  user_id: z.string().uuid(),
  itc_access: z.enum(["on", "off"]).transform((v) => v === "on"),
});

/**
 * Set the users.itc_access flag. Enables /itc for coachees who
 * weren't migrated via the ITC migration script — e.g., new admin-
 * created coachees, or platform admins who need to preview the
 * coaching flow. Audit-logged.
 */
const AdminOnlyFlagSchema = z.object({
  user_id: z.string().uuid(),
  is_admin_only: z.enum(["on", "off"]).transform((v) => v === "on"),
});

/**
 * Flip users.is_admin_only. Enforces the invariant that admin-only
 * requires is_platform_admin — silently sets is_platform_admin=true
 * alongside so the DB CHECK doesn't reject. (The alternative is
 * returning a friendly error, but the admin UI already exposes both
 * checkboxes and this pairing is what the admin obviously means.)
 */
export async function setAdminOnly(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = AdminOnlyFlagSchema.safeParse({
    user_id: formData.get("user_id"),
    is_admin_only: formData.get("is_admin_only") ? "on" : "off",
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  const update: { is_admin_only: boolean; is_platform_admin?: boolean } = {
    is_admin_only: parsed.data.is_admin_only,
  };
  if (parsed.data.is_admin_only) update.is_platform_admin = true;
  const { error } = await svc
    .from("users")
    .update(update)
    .eq("id", parsed.data.user_id);
  if (error) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`,
    );
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "user.set_admin_only",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { value: parsed.data.is_admin_only },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

export async function setItcAccess(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = ItcAccessFlagSchema.safeParse({
    user_id: formData.get("user_id"),
    itc_access: formData.get("itc_access") ? "on" : "off",
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("users")
    .update({ itc_access: parsed.data.itc_access })
    .eq("id", parsed.data.user_id);
  if (error) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(
        error.message,
      )}`,
    );
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "user.set_itc_access",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { value: parsed.data.itc_access },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

// ---------------------------------------------------------------------------
// Memberships — add / remove / role change on the user detail page.
// The New Account form takes a community + role at create time, but
// once the user exists there was no way to move them or add a second
// community. These three actions cover that.
// ---------------------------------------------------------------------------

const AddMembershipSchema = z.object({
  user_id: z.string().uuid(),
  community_id: z.string().uuid(),
  role: z.enum(["member", "leader"]).default("member"),
});

export async function addMembership(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = AddMembershipSchema.safeParse({
    user_id: formData.get("user_id"),
    community_id: formData.get("community_id"),
    role: formData.get("role") ?? "member",
  });
  if (!parsed.success) {
    redirect(
      `/admin/users/${formData.get("user_id")}?error=${encodeURIComponent(
        "Invalid membership input",
      )}`,
    );
  }
  const svc = createSupabaseServiceClient();
  // Upsert on (user_id, community_id) so re-adding a previously
  // removed membership flips it back to active + preserves the
  // original id rather than orphaning it.
  const { error } = await svc.from("memberships").upsert(
    {
      user_id: parsed.data.user_id,
      community_id: parsed.data.community_id,
      role: parsed.data.role,
      status: "active",
    },
    { onConflict: "user_id,community_id" },
  );
  if (error) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`,
    );
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "user.add_membership",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: {
      community_id: parsed.data.community_id,
      role: parsed.data.role,
    },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

const RemoveMembershipSchema = z.object({
  user_id: z.string().uuid(),
  membership_id: z.string().uuid(),
});

/**
 * Hard-delete the membership row. Simplest semantics: gone = gone.
 * If the user re-joins later, addMembership above creates a fresh
 * row (or resurrects if the row wasn't fully deleted, thanks to the
 * upsert). Their check-ins + missions stay on the users row and
 * remain visible on personal pages; they just stop appearing in the
 * community's roster / leaderboard.
 */
export async function removeMembership(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = RemoveMembershipSchema.safeParse({
    user_id: formData.get("user_id"),
    membership_id: formData.get("membership_id"),
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("memberships")
    .delete()
    .eq("id", parsed.data.membership_id);
  if (error) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`,
    );
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "user.remove_membership",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { membership_id: parsed.data.membership_id },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}

const SetRoleSchema = z.object({
  user_id: z.string().uuid(),
  membership_id: z.string().uuid(),
  role: z.enum(["member", "leader"]),
});

export async function setMembershipRole(formData: FormData) {
  const admin = await requirePlatformAdmin();
  const parsed = SetRoleSchema.safeParse({
    user_id: formData.get("user_id"),
    membership_id: formData.get("membership_id"),
    role: formData.get("role"),
  });
  if (!parsed.success) return;
  const svc = createSupabaseServiceClient();
  const { error } = await svc
    .from("memberships")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.membership_id);
  if (error) {
    redirect(
      `/admin/users/${parsed.data.user_id}?error=${encodeURIComponent(error.message)}`,
    );
  }
  await auditLog({
    actor_user_id: admin.id,
    action: "user.set_membership_role",
    target_type: "user",
    target_id: parsed.data.user_id,
    metadata: { membership_id: parsed.data.membership_id, role: parsed.data.role },
  });
  revalidatePath(`/admin/users/${parsed.data.user_id}`);
  redirect(`/admin/users/${parsed.data.user_id}?saved=1`);
}
