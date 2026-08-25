/**
 * /messages "empty" state — inbox is rendered by the layout on the
 * left. On desktop, the right pane shows a placeholder. On mobile,
 * this page IS the inbox (right pane is empty height).
 */
export const dynamic = "force-dynamic";

export default function MessagesIndexPage() {
  return (
    <div className="hidden md:flex h-full min-h-[70vh] items-center justify-center border border-dashed border-[color:var(--color-border)] rounded-[var(--radius-card)]">
      <div className="text-center px-6">
        <p className="font-heading text-sm text-[color:var(--color-text)]">
          Pick a conversation.
        </p>
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
          Or head to Community and start a new one.
        </p>
      </div>
    </div>
  );
}
