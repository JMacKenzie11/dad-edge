"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Community dropdown for anyone in more than one community. Writes the
 * choice to ?c= on the current page. Used by the leader layout and the
 * Community pages.
 */
export function CommunityPicker({
  communities,
  current: currentProp,
}: {
  communities: { id: string; name: string }[];
  /** The community the page is showing, when the server already chose one. */
  current?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const current = currentProp ?? search.get("c") ?? communities[0]?.id ?? "";

  if (communities.length <= 1) {
    return communities[0] ? (
      <span className="font-heading tracking-widest text-[color:var(--color-accent)]">
        {communities[0].name.toUpperCase()}
      </span>
    ) : null;
  }

  return (
    <select
      value={current}
      onChange={(e) => {
        const params = new URLSearchParams(search.toString());
        params.set("c", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="h-8 px-2 rounded bg-[color:var(--color-bg)] border border-[color:var(--color-border)] font-heading text-[10px] tracking-widest"
    >
      {communities.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
