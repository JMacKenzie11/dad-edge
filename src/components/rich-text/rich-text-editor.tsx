"use client";

import { useEffect, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { safeHref } from "@/lib/rich-text/doc";
import { cn } from "@/lib/cn";

/**
 * Admin rich text editor for course overviews and lesson descriptions.
 * Toolbar is deliberately small: bold, italic, two heading levels, lists,
 * links. Writes Tiptap JSON into a hidden input named `name`, so it drops
 * into any server-action form. The server sanitizes again on save.
 */
export function RichTextEditor({
  name,
  initialValue,
  placeholder,
  onChange,
}: {
  name: string;
  initialValue: unknown;
  placeholder?: string;
  onChange?: () => void;
}) {
  const [json, setJson] = useState<string>(() =>
    initialValue ? JSON.stringify(initialValue) : "",
  );
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https"],
          isAllowedUri: (url) => safeHref(url) !== null,
        },
      }),
    ],
    content: (initialValue as object | null) ?? "",
    editorProps: {
      attributes: {
        class:
          "rte-content min-h-[140px] px-3 py-3 text-sm leading-relaxed focus:outline-none",
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: e }) => {
      setJson(e.isEmpty ? "" : JSON.stringify(e.getJSON()));
      onChange?.();
    },
  });

  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-bg)] focus-within:border-[color:var(--color-primary)]">
      <input type="hidden" name={name} value={json} />
      {editor ? <Toolbar editor={editor} /> : <div className="h-10 border-b border-[color:var(--color-border)]" />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (linkOpen) setLinkValue(state.href);
  }, [linkOpen, state.href]);

  function applyLink() {
    const trimmed = linkValue.trim();
    if (trimmed === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const href = safeHref(withProtocol);
    if (!href) {
      setLinkError("Links have to start with http:// or https://.");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkError(null);
    setLinkOpen(false);
  }

  return (
    <div className="border-b border-[color:var(--color-border)]">
      <div className="flex flex-wrap gap-1 p-1.5">
        <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <span className="font-bold">B</span>
        </ToolButton>
        <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span className="italic">I</span>
        </ToolButton>
        <span className="w-px bg-[color:var(--color-border)] mx-1" aria-hidden />
        <ToolButton label="Heading" active={state.h2} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H1
        </ToolButton>
        <ToolButton label="Subheading" active={state.h3} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H2
        </ToolButton>
        <span className="w-px bg-[color:var(--color-border)] mx-1" aria-hidden />
        <ToolButton label="Bulleted list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          • List
        </ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1. List
        </ToolButton>
        <span className="w-px bg-[color:var(--color-border)] mx-1" aria-hidden />
        <ToolButton label="Link" active={state.link || linkOpen} onClick={() => setLinkOpen((v) => !v)}>
          Link
        </ToolButton>
      </div>
      {linkOpen ? (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
          <input
            type="url"
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            placeholder="https://"
            aria-label="Link address"
            className="flex-1 min-w-[180px] h-9 px-2 rounded-md bg-[color:var(--color-surface)] border border-[color:var(--color-border)] text-sm"
            autoFocus
          />
          <button type="button" onClick={applyLink} className="h-9 px-3 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest">
            Apply
          </button>
          {state.link ? (
            <button
              type="button"
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkOpen(false);
              }}
              className="h-9 px-3 rounded-md border border-[color:var(--color-border)] font-heading text-xs tracking-widest"
            >
              Remove link
            </button>
          ) : null}
          {linkError ? <p className="w-full text-xs text-[color:var(--color-danger)]">{linkError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "h-8 min-w-8 px-2 rounded text-xs",
        active
          ? "bg-[color:var(--color-primary)] text-white"
          : "text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-text)]",
      )}
    >
      {children}
    </button>
  );
}
