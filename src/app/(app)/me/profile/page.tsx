import Link from "next/link";
import { requireAccess } from "@/lib/session";
import { EditProfileForm } from "./edit-form";

export const dynamic = "force-dynamic";

export default async function EditProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireAccess();
  const params = await searchParams;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link
        href="/me"
        className="text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
      >
        ← ME
      </Link>

      <header>
        <p className="text-[10px] font-heading tracking-widest text-[color:var(--color-text-muted)]">
          EDIT PROFILE
        </p>
        <h1 className="font-heading text-3xl mt-1">Your details</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mt-1">
          Your photo, name, and where you're based. Cell phone is
          leader/admin visible only.
        </p>
      </header>

      {params.error ? (
        <p className="text-xs text-[color:var(--color-danger)]">{params.error}</p>
      ) : null}

      <EditProfileForm
        defaultFirstName={user.first_name ?? ""}
        defaultLastName={user.last_name ?? ""}
        defaultCity={user.city ?? ""}
        defaultPhone={user.phone ?? ""}
        existingAvatarUrl={user.avatar_url ?? ""}
      />
    </div>
  );
}
