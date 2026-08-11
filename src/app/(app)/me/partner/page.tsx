import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { savePartnerFromMe } from "./actions";

export const dynamic = "force-dynamic";

const LABELS = ["wife", "partner", "girlfriend", "fiancee", "husband", "boyfriend"] as const;

export default async function PartnerEdit() {
  const { user, readOnly } = await requireAccess();
  if (readOnly) redirect("/me");
  const supabase = await createSupabaseServerClient();
  const { data: p } = await supabase
    .from("partner_profiles")
    .select("partner_name, relationship_label, partner_birthdate, relationship_date, things_loved")
    .eq("user_id", user.id)
    .maybeSingle();

  const partner = p as
    | {
        partner_name: string | null;
        relationship_label: string | null;
        partner_birthdate: string | null;
        relationship_date: string | null;
        things_loved: string[] | null;
      }
    | null;

  return (
    <div className="max-w-md mx-auto space-y-6">
      <header>
        <h1 className="font-heading text-3xl">Your partner</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">Only you see this.</p>
      </header>
      <form action={savePartnerFromMe} className="space-y-4">
        <input
          name="partner_name"
          defaultValue={partner?.partner_name ?? ""}
          placeholder="Her name"
          className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        />
        <select
          name="relationship_label"
          defaultValue={partner?.relationship_label ?? ""}
          className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
        >
          <option value="">—</option>
          {LABELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input
            type="date"
            name="partner_birthdate"
            defaultValue={partner?.partner_birthdate ?? ""}
            className="h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
          <input
            type="date"
            name="relationship_date"
            defaultValue={partner?.relationship_date ?? ""}
            className="h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        </div>
        {[0, 1, 2].map((i) => (
          <input
            key={i}
            name={`loved_${i + 1}`}
            defaultValue={partner?.things_loved?.[i] ?? ""}
            placeholder="Something you love about her."
            className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]"
          />
        ))}
        <button
          type="submit"
          className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
        >
          Save
        </button>
      </form>
    </div>
  );
}
