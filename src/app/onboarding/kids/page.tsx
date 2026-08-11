import { requireUser } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { addKid, finishKids } from "../actions";
import { StepProgress } from "../step-progress";

export const dynamic = "force-dynamic";

export default async function KidsStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: kids } = await supabase
    .from("children")
    .select("id, name, birthdate, things_loved")
    .eq("user_id", user.id)
    .order("created_at");

  return (
    <div>
      <StepProgress step={4} total={7} />
      <h1 className="font-heading text-3xl mb-2">Your kids.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        Optional. Add one at a time. Only you see this.
      </p>

      {(kids ?? []).length > 0 ? (
        <ul className="mb-6 space-y-2">
          {(kids ?? []).map((k) => (
            <li key={k.id} className="p-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm">
              <p className="font-heading">{k.name}</p>
              {k.birthdate ? <p className="text-xs text-[color:var(--color-text-muted)]">{k.birthdate}</p> : null}
              {(k.things_loved as string[] | null)?.length ? (
                <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
                  {(k.things_loved as string[])[0]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <form action={addKid} className="space-y-3 mb-6">
        <input name="name" placeholder="Name" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
        <input type="date" name="birthdate" className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
        <input name="loved" placeholder="Something you love about him or her." className="w-full h-11 px-3 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)]" />
        {params.error ? <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p> : null}
        <button
          type="submit"
          className="w-full h-11 rounded-md font-heading border border-[color:var(--color-border)] text-[color:var(--color-text)]"
        >
          Add
        </button>
      </form>

      <form action={finishKids}>
        <button
          type="submit"
          className="w-full h-12 rounded-md font-heading bg-[color:var(--color-primary)] text-white"
        >
          {(kids ?? []).length > 0 ? "Continue" : "Skip"}
        </button>
      </form>
    </div>
  );
}
