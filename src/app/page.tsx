import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Marketing landing page for signed-out visitors. If a user is
 * already signed in, bounce them to their normal landing (main app
 * or /itc) instead of showing them the "SIGN IN" prompt they don't
 * need. Same routing rules the sign-in action uses:
 *
 *   - Platform admins → /today
 *   - Non-admin ITC users → /itc
 *   - Everyone else → /today
 */
export default async function LandingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: row } = await supabase
      .from("users")
      .select("itc_access, is_platform_admin")
      .eq("id", user.id)
      .maybeSingle();
    const r = row as
      | { itc_access: boolean | null; is_platform_admin: boolean | null }
      | null;
    if (r?.itc_access && !r?.is_platform_admin) {
      redirect("/itc");
    }
    redirect("/today");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 gap-10">
      <Image
        src="/brand/logo-tagline-white.png"
        alt="THE DAD EDGE - Live Legendary"
        width={420}
        height={120}
        priority
      />
      <div className="text-center max-w-md space-y-4">
        <h1 className="font-heading text-4xl md:text-5xl">Brave Man Operating System</h1>
        <p className="text-[color:var(--color-text-muted)]">
          Log the day. Set the mission. Report back.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="px-5 py-3 font-heading text-sm rounded-md bg-[color:var(--color-primary)] text-white"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}
