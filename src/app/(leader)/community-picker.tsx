"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function LeaderCommunityPicker({
  communities,
}: {
  communities: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const search = useSearchParams();
  const current = search.get("c") ?? communities[0]?.id ?? "";

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
