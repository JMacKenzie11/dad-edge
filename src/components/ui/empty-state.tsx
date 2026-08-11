import Image from "next/image";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center gap-3 py-10 px-6",
        "bg-[color:var(--color-surface)] border border-dashed border-[color:var(--color-border)] rounded-[var(--radius-card)]",
        className,
      )}
    >
      <Image src="/brand/mark-white.png" alt="" width={48} height={48} className="opacity-70" />
      <h3 className="font-heading text-lg">{title}</h3>
      {body ? <p className="text-sm text-[color:var(--color-text-muted)] max-w-xs">{body}</p> : null}
      {action}
    </div>
  );
}

export function LoadingMark({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div className="relative">
        <Image
          src="/brand/mark-white.png"
          alt=""
          width={44}
          height={44}
          className="animate-pulse"
        />
      </div>
      {label ? (
        <p className="text-xs font-heading tracking-widest text-[color:var(--color-text-muted)]">
          {label.toUpperCase()}
        </p>
      ) : null}
    </div>
  );
}
