import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addKidFromMe, removeKid } from "./actions";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function KidsEdit() {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me");
  const supabase = await createSupabaseServerClient();
  const { data: kids } = await supabase
    .from("children")
    .select("id, name, birthdate, things_loved")
    .eq("user_id", user.id)
    .order("created_at");

  return (
    <div className="max-w-md mx-auto space-y-6">
      <header>
        <h1 className="font-heading text-3xl">Kids</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">Only you see this.</p>
      </header>

      <form action={addKidFromMe} className="space-y-3 p-4 rounded-[var(--radius-card)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)]">
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">ADD ONE</p>
        <input name="name" placeholder="Name" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]" />
        <input type="date" name="birthdate" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]" />
        <input name="loved" placeholder="Something you love." className="w-full h-11 px-3 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-border)]" />
        <Button type="submit">Add</Button>
      </form>

      <ul className="space-y-2">
        {(kids ?? []).map((k) => (
          <li key={k.id} className="p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-heading text-sm">{k.name as string}</p>
              {k.birthdate ? <p className="text-xs text-[color:var(--color-text-muted)]">{k.birthdate as string}</p> : null}
              {((k.things_loved as string[] | null) ?? []).slice(0, 1).map((t, i) => (
                <p key={i} className="text-xs text-[color:var(--color-text-muted)] mt-1">&ldquo;{t}&rdquo;</p>
              ))}
            </div>
            <form action={removeKid.bind(null, k.id as string)}>
              <button
                type="submit"
                className="text-[10px] font-heading tracking-widest text-[color:var(--color-danger)]"
              >
                REMOVE
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
