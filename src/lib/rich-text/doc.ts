/**
 * Rich text for course overviews and lesson descriptions.
 *
 * Stored as Tiptap JSON. The editor toolbar only offers bold, italic, two
 * heading levels, bulleted and numbered lists, and links, and sanitizeDoc
 * holds the stored JSON to exactly that set: anything else (images, tables,
 * code blocks, a pasted <script> that Tiptap parsed into some node) is
 * dropped on save, so the renderer never has to trust what's in the column.
 */

export type RichMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "link"; attrs: { href: string } };

export type RichNode =
  | { type: "doc"; content: RichNode[] }
  | { type: "paragraph"; content?: RichNode[] }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: RichNode[] }
  | { type: "bulletList"; content: RichNode[] }
  | { type: "orderedList"; attrs?: { start?: number }; content: RichNode[] }
  | { type: "listItem"; content: RichNode[] }
  | { type: "hardBreak" }
  | { type: "text"; text: string; marks?: RichMark[] };

export type RichDoc = { type: "doc"; content: RichNode[] };

/** http and https only. Anything else (javascript:, data:, mailto:,
 *  relative paths) is not a link we render. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2000) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Keep what the admin typed (the URL parser would append a slash);
    // it has already proven to parse as http(s).
    return trimmed;
  } catch {
    return null;
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function sanitizeMarks(raw: unknown): RichMark[] {
  const out: RichMark[] = [];
  for (const m of asArray(raw)) {
    if (!m || typeof m !== "object") continue;
    const type = (m as { type?: unknown }).type;
    if (type === "bold" || type === "italic") {
      if (!out.some((x) => x.type === type)) out.push({ type });
    } else if (type === "link") {
      const href = safeHref((m as { attrs?: { href?: unknown } }).attrs?.href);
      if (href && !out.some((x) => x.type === "link")) out.push({ type: "link", attrs: { href } });
    }
  }
  return out;
}

function sanitizeInline(raw: unknown): RichNode[] {
  const out: RichNode[] = [];
  for (const n of asArray(raw)) {
    if (!n || typeof n !== "object") continue;
    const node = n as { type?: unknown; text?: unknown; marks?: unknown; content?: unknown };
    if (node.type === "text" && typeof node.text === "string" && node.text.length > 0) {
      const marks = sanitizeMarks(node.marks);
      out.push(marks.length ? { type: "text", text: node.text, marks } : { type: "text", text: node.text });
    } else if (node.type === "hardBreak") {
      out.push({ type: "hardBreak" });
    } else if (Array.isArray(node.content)) {
      // Unknown inline wrapper: keep its text, lose the wrapper.
      out.push(...sanitizeInline(node.content));
    }
  }
  return out;
}

function sanitizeListItems(raw: unknown): RichNode[] {
  const items: RichNode[] = [];
  for (const n of asArray(raw)) {
    if (!n || typeof n !== "object" || (n as { type?: unknown }).type !== "listItem") continue;
    const content = sanitizeBlocks((n as { content?: unknown }).content);
    if (content.length > 0) items.push({ type: "listItem", content });
  }
  return items;
}

function sanitizeBlocks(raw: unknown): RichNode[] {
  const out: RichNode[] = [];
  for (const n of asArray(raw)) {
    if (!n || typeof n !== "object") continue;
    const node = n as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown };
    switch (node.type) {
      case "paragraph": {
        const content = sanitizeInline(node.content);
        out.push(content.length ? { type: "paragraph", content } : { type: "paragraph" });
        break;
      }
      case "heading": {
        const level = node.attrs?.level === 3 ? 3 : 2;
        const content = sanitizeInline(node.content);
        out.push({ type: "heading", attrs: { level }, ...(content.length ? { content } : {}) });
        break;
      }
      case "bulletList": {
        const content = sanitizeListItems(node.content);
        if (content.length) out.push({ type: "bulletList", content });
        break;
      }
      case "orderedList": {
        const content = sanitizeListItems(node.content);
        const start = typeof node.attrs?.start === "number" && node.attrs.start > 1 ? Math.floor(node.attrs.start) : undefined;
        if (content.length) out.push({ type: "orderedList", ...(start ? { attrs: { start } } : {}), content });
        break;
      }
      default: {
        // Anything outside the allowed set: keep the words as a plain
        // paragraph so nothing an admin wrote silently disappears.
        const content = sanitizeInline(node.content);
        if (content.length) out.push({ type: "paragraph", content });
      }
    }
  }
  return out;
}

/** Returns a clean doc, or null when there's no text in it at all. */
export function sanitizeDoc(raw: unknown): RichDoc | null {
  let value = raw;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "doc") return null;
  const doc: RichDoc = { type: "doc", content: sanitizeBlocks((value as { content?: unknown }).content) };
  return isEmptyDoc(doc) ? null : doc;
}

export function plainText(doc: RichDoc | RichNode | null | undefined): string {
  if (!doc) return "";
  if (doc.type === "text") return doc.text;
  if (doc.type === "hardBreak") return "\n";
  const children = "content" in doc && Array.isArray(doc.content) ? doc.content : [];
  const sep = doc.type === "doc" || doc.type === "bulletList" || doc.type === "orderedList" ? "\n" : "";
  return children.map((c) => plainText(c)).join(sep);
}

export function isEmptyDoc(doc: RichDoc | null | undefined): boolean {
  return plainText(doc).trim().length === 0;
}

/** Validates a stored value read back from the DB. Same rules as save. */
export function readStoredDoc(raw: unknown): RichDoc | null {
  return sanitizeDoc(raw);
}
