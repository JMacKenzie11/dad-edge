import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdmin } from "@/lib/admin";
import { appOrigin } from "@/lib/invites";
import { CreateKeyForm } from "./create-key-form";
import { revokeApiKey } from "./actions";

export const dynamic = "force-dynamic";

type KeyRow = {
  id: string;
  label: string;
  key_hint: string;
  community_ids: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never";
}

export default async function ApiKeysPage() {
  await requirePlatformAdmin();
  const svc = createSupabaseServiceClient();
  const [{ data: keys }, { data: communities }] = await Promise.all([
    svc.from("api_keys").select("id, label, key_hint, community_ids, created_at, last_used_at, revoked_at").order("created_at", { ascending: false }),
    svc.from("communities").select("id, name").eq("status", "active").order("name"),
  ]);
  const nameOf = new Map(((communities ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl">API keys</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">
          A key lets an outside system such as Grok Bot look up members&apos; first names and emails over MCP at{" "}
          <code>{appOrigin()}/api/mcp</code>. It can&apos;t change anything.
        </p>
      </header>

      <CreateKeyForm communities={(communities ?? []) as { id: string; name: string }[]} />

      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden">
        {((keys ?? []) as KeyRow[]).map((k) => (
          <li key={k.id} className="p-4 flex items-center justify-between gap-4 text-sm">
            <div className="space-y-1">
              <p className="font-medium">
                {k.label} <code className="text-xs text-[color:var(--color-text-muted)]">{k.key_hint}…</code>
              </p>
              <p className="text-xs text-[color:var(--color-text-muted)]">
                {k.community_ids.length === 0 ? "All communities" : k.community_ids.map((id) => nameOf.get(id) ?? "archived community").join(", ")}
                {" · "}made {when(k.created_at)} · last used {when(k.last_used_at)}
              </p>
            </div>
            {k.revoked_at ? (
              <span className="text-xs text-[color:var(--color-text-muted)]">Revoked {when(k.revoked_at)}</span>
            ) : (
              <form action={revokeApiKey}>
                <input type="hidden" name="id" value={k.id} />
                <button type="submit" className="h-9 px-3 rounded-md border border-[color:var(--color-border)] text-xs font-heading tracking-widest">
                  REVOKE
                </button>
              </form>
            )}
          </li>
        ))}
        {(keys ?? []).length === 0 ? <li className="p-4 text-sm text-[color:var(--color-text-muted)]">No keys yet.</li> : null}
      </ul>
    </div>
  );
}
