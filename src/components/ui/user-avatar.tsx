/**
 * Circular avatar for a user. Falls back to a colored initial when
 * no picture is set — so the avatar always renders, even for
 * brand-new users who haven't hit the /onboarding/profile step yet.
 *
 * Sizes:
 *   sm — 32px, inline chip / list row
 *   md — 48px, list row prominent
 *   lg — 80px, header on /me
 *
 * Pass `url` from users.avatar_url. The initial fallback prefers
 * first name → email local part.
 */
type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-2xl",
};

export function UserAvatar({
  url,
  firstName,
  lastName,
  email,
  size = "lg",
}: {
  url: string | null | undefined;
  firstName: string | null | undefined;
  lastName?: string | null | undefined;
  email: string | null | undefined;
  size?: Size;
}) {
  const sizeClass = SIZE_CLASSES[size];
  if (url) {
    return (
      <img
        src={url}
        alt={firstName ?? email ?? "Profile"}
        className={`${sizeClass} rounded-full object-cover border border-[color:var(--color-border)] shrink-0`}
      />
    );
  }
  const initial = initialFor(firstName, lastName, email);
  return (
    <div
      className={`${sizeClass} rounded-full bg-[color:var(--color-surface)] border border-[color:var(--color-border)] flex items-center justify-center font-heading uppercase text-[color:var(--color-text-muted)] shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function initialFor(
  first: string | null | undefined,
  last: string | null | undefined,
  email: string | null | undefined,
): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  if (f && l) return `${f[0]}${l[0]}`;
  if (f) return f[0]!;
  if (email) return email.trim()[0] ?? "?";
  return "?";
}
