import Image from "next/image";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { appLabel, returnsToThisComputer } from "@/lib/mcp/trusted-clients";
import { ConsentForm } from "./consent-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an AI app" };

/**
 * Where an AI app's sign-in lands (DECISIONS.md "MCP sign-in with OAuth").
 * Supabase's OAuth server sends the person here with an authorization_id.
 * Not signed in: to /login and back. He sees which app is asking and what
 * it can read, and allows or declines. Only platform admins can allow, and
 * only approved apps (public.mcp_client_trusted).
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: id } = await searchParams;
  if (!id || !/^[A-Za-z0-9_-]{8,200}$/.test(id)) {
    return <Shell title="This link isn't complete.">Start again from the AI app.</Shell>;
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) return <Shell title="This request has expired.">Start again from the AI app.</Shell>;
  // Allowed before: Supabase hands back where to go.
  if (!("authorization_id" in data) && "redirect_url" in data) redirect(data.redirect_url as string);
  const details = data as { authorization_id: string; redirect_uri: string; client: { id: string; name: string } };
  const label = appLabel(details.client.name, details.redirect_uri);

  const svc = createSupabaseServiceClient();
  const [trusted, admin, me] = await Promise.all([
    svc.rpc("mcp_client_trusted", { p_client_id: details.client.id }),
    svc.rpc("mcp_user_is_admin", { p_user_id: auth.user.id }),
    svc.from("users").select("first_name, email").eq("id", auth.user.id).maybeSingle(),
  ]);
  const who = (me.data as { first_name: string | null; email: string } | null)?.first_name || auth.user.email || "you";

  if (trusted.data !== true) {
    return (
      <Shell title="This AI app isn't approved for Brave Man OS.">
        <p>Brave Man OS connects to Grok Bot, Claude and ChatGPT only. Nothing has been shared.</p>
        <ConsentForm authorizationId={details.authorization_id} canAllow={false} />
      </Shell>
    );
  }
  if (admin.data !== true) {
    return (
      <Shell title="AI apps can connect to admin accounts only.">
        <p>Nothing has been shared.</p>
        <ConsentForm authorizationId={details.authorization_id} canAllow={false} />
      </Shell>
    );
  }

  const local = returnsToThisComputer(details.redirect_uri);
  let returnsTo = "a program on this computer";
  if (!local) {
    try {
      returnsTo = new URL(details.redirect_uri).host;
    } catch {
      returnsTo = details.redirect_uri;
    }
  }

  return (
    <Shell title={`Connect ${label} to Brave Man OS?`}>
      <p>It will act as {who}.</p>
      <p>It can list the communities, the first names and emails of each community&apos;s active members, and how many of each man&apos;s goal missions and BRAVE MAN missions he completed each week.</p>
      <p>It can&apos;t read what his goals or missions say, his check-ins or survey answers, and it can&apos;t change anything.</p>
      <p>Once the names and emails reach {label}, {label}&apos;s own terms and privacy policy apply to them.</p>
      <p>It returns to {returnsTo}.</p>
      {local ? (
        <p className="text-[color:var(--color-danger)]">Only allow it if you started connecting {label} yourself, on this computer, just now.</p>
      ) : null}
      <ConsentForm authorizationId={details.authorization_id} canAllow={true} />
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 gap-8">
      <Image src="/brand/logo-tagline-white.png" alt="THE DAD EDGE - Live Legendary" width={280} height={79} priority />
      <div className="w-full max-w-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] p-6 space-y-4 text-sm">
        <h1 className="font-heading text-xl">{title}</h1>
        <div className="space-y-3 text-[color:var(--color-text-muted)]">{children}</div>
      </div>
    </main>
  );
}
