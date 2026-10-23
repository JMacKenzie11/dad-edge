import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { canAccess, type SubscriptionStatus } from "@/lib/entitlement";
import { downloadFileName, LESSON_FILES_BUCKET } from "@/lib/resources/files";

/**
 * The only door to a lesson PDF. The bucket is private with no storage
 * policies, so an object can only be fetched with a signed URL, and the
 * only place that issues one for members is here, after:
 *
 *   1. a signed-in session,
 *   2. the entitlement gate (canAccess: full or win-back read-only),
 *   3. RLS on lesson_files via the request-scoped client, which only
 *      returns the row when can_view_course() passes (published, visible
 *      to one of his communities, entitled; admins see drafts),
 *   4. an explicit published check unless an admin is previewing.
 *
 * The signed URL lives for 60 seconds: long enough for the redirect,
 * useless if it ends up in a chat or a browser history sync.
 */
const SIGNED_URL_SECONDS = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!UUID.test(fileId)) return new NextResponse("Not found", { status: 404 });

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(login, 303);
  }

  const { data: me } = await supabase
    .from("users")
    .select("subscription_status, subscription_source, canceled_at, is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();
  const profile = me as { subscription_status: SubscriptionStatus; subscription_source: "manual" | "stripe"; canceled_at: string | null; is_platform_admin: boolean } | null;
  if (!profile) return new NextResponse("Not found", { status: 404 });
  const decision = canAccess({ subscription_status: profile.subscription_status, deactivated_at: profile.canceled_at, subscription_source: profile.subscription_source });
  if (decision.access === "none") return NextResponse.redirect(new URL("/inactive", req.url), 303);

  const { data: file } = await supabase
    .from("lesson_files")
    .select("id, file_name, storage_path, lessons:lesson_id(course_id, courses:course_id(is_published))")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });

  const row = file as unknown as {
    file_name: string;
    storage_path: string;
    lessons: { courses: { is_published: boolean } | { is_published: boolean }[] | null } | null;
  };
  const courseRel = row.lessons?.courses;
  const course = Array.isArray(courseRel) ? courseRel[0] : courseRel;
  const preview = req.nextUrl.searchParams.get("preview") === "1" && profile.is_platform_admin;
  if (!course || (!course.is_published && !preview)) return new NextResponse("Not found", { status: 404 });

  const svc = createSupabaseServiceClient();
  const { data: signed, error } = await svc.storage
    .from(LESSON_FILES_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS, { download: downloadFileName(row.file_name) });
  if (error || !signed) {
    return new NextResponse("That file isn't available right now. Try again in a minute.", { status: 503 });
  }

  const res = NextResponse.redirect(signed.signedUrl, 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
