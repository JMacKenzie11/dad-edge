import { requireUser } from "@/lib/session";
import { StepProgress } from "../step-progress";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfileStep({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  return (
    <div>
      <StepProgress step={2} total={8} />
      <h1 className="font-heading text-3xl mb-2">Add your photo.</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-6">
        A photo, where you're based, and how to reach you. All optional —
        skip anything you don't want to share.
      </p>

      {params.error ? (
        <p className="text-xs text-[color:var(--color-danger)] mb-4">
          {params.error}
        </p>
      ) : null}

      <ProfileForm
        defaultCity={user.city ?? ""}
        defaultPhone={user.phone ?? ""}
        existingAvatarUrl={user.avatar_url ?? ""}
      />
    </div>
  );
}
