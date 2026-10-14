"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Drag-to-reorder list for admin screens. Native HTML5 drag and drop on
 * desktop, plus up/down buttons on every row so reordering also works by
 * keyboard and on touch screens (HTML5 drag doesn't fire on phones).
 *
 * The list reorders immediately; `onReorder` persists. If it fails, the
 * list snaps back to the server's order and shows the error.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  className,
  itemLabel,
}: {
  items: T[];
  onReorder: (orderedIds: string[]) => Promise<{ ok: boolean; error?: string }>;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  /** Used in the move buttons' accessible names. */
  itemLabel: (item: T) => string;
}) {
  const [order, setOrder] = useState<T[]>(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastServer = useRef(items);

  useEffect(() => {
    lastServer.current = items;
    setOrder(items);
  }, [items]);

  async function commit(next: T[]) {
    const before = order;
    setOrder(next);
    setError(null);
    setSaving(true);
    const res = await onReorder(next.map((i) => i.id));
    setSaving(false);
    if (!res.ok) {
      setOrder(before);
      setError(res.error ?? "The new order didn't save. Refresh and try again.");
    }
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void commit(next);
  }

  return (
    <div className={className}>
      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded-[var(--radius-card)] overflow-hidden" aria-busy={saving}>
        {order.map((item, index) => (
          <li
            key={item.id}
            // Only the handle starts a drag, so text inside the row (an
            // editable file name, say) still selects normally.
            draggable={armedId === item.id}
            onDragStart={(e) => {
              setDragId(item.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.id);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverId(item.id);
            }}
            onDragLeave={() => setOverId((v) => (v === item.id ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              const from = order.findIndex((i) => i.id === dragId);
              setDragId(null);
              setOverId(null);
              if (from !== -1) move(from, index);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
              setArmedId(null);
            }}
            className={cn(
              "flex items-center gap-2 bg-[color:var(--color-surface)]",
              dragId === item.id && "opacity-50",
              overId === item.id && dragId !== item.id && "outline outline-2 -outline-offset-2 outline-[color:var(--color-primary)]",
            )}
          >
            <span
              className="pl-3 cursor-grab select-none text-[color:var(--color-text-muted)]"
              aria-hidden
              title="Drag to reorder"
              onMouseDown={() => setArmedId(item.id)}
              onMouseUp={() => setArmedId(null)}
            >
              ⋮⋮
            </span>
            <div className="flex-1 min-w-0">{renderItem(item, index)}</div>
            <div className="flex flex-col pr-2">
              <button
                type="button"
                onClick={() => move(index, index - 1)}
                disabled={index === 0 || saving}
                aria-label={`Move ${itemLabel(item)} up`}
                className="h-5 w-7 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] disabled:opacity-20"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(index, index + 1)}
                disabled={index === order.length - 1 || saving}
                aria-label={`Move ${itemLabel(item)} down`}
                className="h-5 w-7 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] disabled:opacity-20"
              >
                ▼
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}
