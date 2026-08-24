"use server";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Server-side resolver for the Help widget.
 *
 * Takes the current pathname + optional view key + user role.
 * Normalizes the pathname to a Next.js route pattern (dynamic
 * segments become `[name]`), runs the resolution ladder against
 * the help_content table, and returns approved content — or logs
 * a gap and returns null.
 *
 * Resolution ladder — permission-inheriting so a higher-privileged
 * user sees content authored for anyone with equal-or-lower access.
 * Admins see admin + leader + member. Leaders see leader + member.
 * Members see member. Then each layer tries 'all'.
 *
 * For a viewer with role R and roles[R] = R + inherits:
 *   1. (route, view, R)
 *   2. (route, view, 'all')
 *   3. (route, view, inherit_1)
 *   4. (route, view, inherit_2)   (etc.)
 *   5. (route, null, R)
 *   6. (route, null, 'all')
 *   7. (route, null, inherit_1)
 *   8. (route, null, inherit_2)   (etc.)
 *
 * First match wins. Rationale: extraction tags routes by the role
 * they're designed for (/today = member; /admin/* = admin). An admin
 * looking at /today gets the member-authored help without needing a
 * separate admin-authored row for the same page.
 */

const ROLE_LADDER: Record<
  "member" | "leader" | "admin",
  Array<"member" | "leader" | "admin">
> = {
  admin: ["admin", "leader", "member"],
  leader: ["leader", "member"],
  member: ["member"],
};

type HelpRow = {
  id: string;
  title: string;
  sections: Array<{ what_its_for: string; steps: string[] }>;
};

export type HelpResult =
  | { status: "found"; title: string; sections: HelpRow["sections"] }
  | { status: "missing"; route_pattern: string; view_key: string | null };

export async function getHelpForPage(input: {
  pathname: string;
  view_key: string | null;
  role: "member" | "leader" | "admin";
}): Promise<HelpResult> {
  const routePattern = normalizeRoute(input.pathname);
  const svc = createSupabaseServiceClient();

  // Build the full resolution ladder for this viewer:
  //   - view first, then null-view
  //   - within each view, try own role, then 'all', then inherited roles
  const inheritedRoles = ROLE_LADDER[input.role];
  const rolesToTry: string[] = [
    inheritedRoles[0], // own role
    "all",
    ...inheritedRoles.slice(1), // inherited fallbacks
  ];
  const viewsToTry: Array<string | null> = input.view_key
    ? [input.view_key, null]
    : [null];

  const ladder: Array<[string | null, string]> = [];
  for (const view of viewsToTry) {
    for (const role of rolesToTry) {
      ladder.push([view, role]);
    }
  }

  for (const [viewKey, role] of ladder) {
    let q = svc
      .from("help_content")
      .select("id, title, sections")
      .eq("route_pattern", routePattern)
      .eq("role", role)
      .eq("reviewed", true)
      .limit(1);
    if (viewKey === null) {
      q = q.is("view_key", null);
    } else {
      q = q.eq("view_key", viewKey);
    }
    const { data } = await q;
    const row = (data?.[0] ?? null) as HelpRow | null;
    if (row) {
      return {
        status: "found",
        title: row.title,
        sections: row.sections,
      };
    }
  }

  // No content — log the miss for coverage visibility.
  await logGap(routePattern, input.view_key, input.role);
  return {
    status: "missing",
    route_pattern: routePattern,
    view_key: input.view_key,
  };
}

async function logGap(
  routePattern: string,
  viewKey: string | null,
  role: string,
): Promise<void> {
  const svc = createSupabaseServiceClient();
  // Upsert: insert if new, else bump hit_count + last_seen_at.
  // Postgres doesn't do ON CONFLICT DO UPDATE via .upsert() with
  // custom expression on a partial index / null-including unique
  // constraint cleanly, so do a select-first pattern.
  let q = svc
    .from("help_content_gaps")
    .select("id, hit_count")
    .eq("route_pattern", routePattern)
    .eq("role", role)
    .limit(1);
  if (viewKey === null) q = q.is("view_key", null);
  else q = q.eq("view_key", viewKey);
  const { data } = await q;
  const existing = data?.[0] as
    | { id: string; hit_count: number }
    | undefined;
  if (existing) {
    await svc
      .from("help_content_gaps")
      .update({
        hit_count: existing.hit_count + 1,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await svc.from("help_content_gaps").insert({
      route_pattern: routePattern,
      view_key: viewKey,
      role,
    });
  }
}

/**
 * Normalize a browser pathname to a Next.js route pattern.
 *
 * The widget doesn't know the app's route map, so we substitute
 * common dynamic segment names by shape:
 *   - UUID       → [id] (for /admin/users/[id], /goals/[id], etc.)
 *   - Otherwise, keep the literal segment (routes like /admin,
 *     /coach have no dynamic segments at this level).
 *
 * ITC's map id: /itc/<uuid> → /itc/[mapId]
 * Coach thread: /coach/<uuid> → /coach/[id]
 * Goal id:      /goals/<uuid> → /goals/[id]
 * User id:      /admin/users/<uuid> → /admin/users/[id]
 * Community:    /admin/communities/<uuid> → /admin/communities/[id]
 * Survey:       /me/survey/<uuid> → /me/survey/[id]
 *
 * A UUID-shape match covers all of these since we use uuid PKs
 * consistently. We pick the [name] token per-parent-path so the
 * route pattern matches what extract-routes wrote.
 */
function normalizeRoute(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const normalized: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (isUuidLike(p)) {
      const parent = parts.slice(0, i).join("/");
      const tokenName = tokenForParent(parent);
      normalized.push(`[${tokenName}]`);
    } else {
      normalized.push(p);
    }
  }
  return "/" + normalized.join("/");
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function tokenForParent(parentPath: string): string {
  // Map known parent → dynamic token name; unknown → generic [id].
  const map: Record<string, string> = {
    itc: "mapId",
    "itc/admin": "mapId",
    coach: "id",
    goals: "id",
    "admin/users": "id",
    "admin/communities": "id",
    "me/survey": "id",
  };
  return map[parentPath] ?? "id";
}
