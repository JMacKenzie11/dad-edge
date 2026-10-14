import { Fragment, type ReactNode } from "react";
import { readStoredDoc, safeHref, type RichNode } from "@/lib/rich-text/doc";
import { cn } from "@/lib/cn";

/**
 * The one read-only renderer for course and lesson rich text. Server
 * component: no editor bundle ships to members. Re-sanitizes whatever it's
 * handed, so a row written before a rule tightened still renders safely.
 */
export function RichTextView({ value, className }: { value: unknown; className?: string }) {
  const doc = readStoredDoc(value);
  if (!doc) return null;
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed text-[color:var(--color-text)]", className)}>
      {doc.content.map((n, i) => (
        <Fragment key={i}>{renderNode(n)}</Fragment>
      ))}
    </div>
  );
}

function renderChildren(nodes: RichNode[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => <Fragment key={i}>{renderNode(n)}</Fragment>);
}

function renderNode(node: RichNode): ReactNode {
  switch (node.type) {
    case "paragraph":
      return <p className="min-h-[1em]">{renderChildren(node.content)}</p>;
    case "heading":
      return node.attrs.level === 2 ? (
        <h2 className="font-heading text-lg pt-2">{renderChildren(node.content)}</h2>
      ) : (
        <h3 className="font-heading text-base pt-1">{renderChildren(node.content)}</h3>
      );
    case "bulletList":
      return <ul className="list-disc pl-5 space-y-1">{renderChildren(node.content)}</ul>;
    case "orderedList":
      return (
        <ol className="list-decimal pl-5 space-y-1" start={node.attrs?.start}>
          {renderChildren(node.content)}
        </ol>
      );
    case "listItem":
      return <li className="[&>p]:inline">{renderChildren(node.content)}</li>;
    case "hardBreak":
      return <br />;
    case "text":
      return renderText(node);
    default:
      return null;
  }
}

function renderText(node: Extract<RichNode, { type: "text" }>): ReactNode {
  let out: ReactNode = node.text;
  const marks = node.marks ?? [];
  if (marks.some((m) => m.type === "italic")) out = <em>{out}</em>;
  if (marks.some((m) => m.type === "bold")) out = <strong>{out}</strong>;
  const link = marks.find((m) => m.type === "link");
  if (link && link.type === "link") {
    const href = safeHref(link.attrs.href);
    if (href) {
      out = (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-[color:var(--color-accent)] underline underline-offset-2"
        >
          {out}
        </a>
      );
    }
  }
  return out;
}
