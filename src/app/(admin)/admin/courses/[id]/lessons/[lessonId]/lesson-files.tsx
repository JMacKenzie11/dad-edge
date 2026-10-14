"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { SortableList } from "@/components/ui/sortable-list";
import { useConfirm } from "@/components/ui/use-confirm";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { checkPdfFile, formatFileSize, LESSON_FILES_BUCKET, PDF_MIME } from "@/lib/resources/files";
import {
  createLessonFileUpload,
  deleteLessonFile,
  finalizeLessonFile,
  renameLessonFile,
  reorderLessonFiles,
} from "../../../actions";

export type AdminLessonFile = { id: string; name: string; sizeBytes: number };

type UploadStatus = { key: string; name: string; state: "uploading" | "failed"; error?: string };

export function LessonFiles({ lessonId, files }: { lessonId: string; files: AdminLessonFile[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dialog, confirm] = useConfirm();
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function uploadOne(file: File, key: string) {
    const fail = (msg: string) =>
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "failed", error: msg } : x)));

    const problem = await checkPdfFile(file);
    if (problem) return fail(problem);

    const ticket = await createLessonFileUpload(lessonId, file.name, file.size);
    if (!ticket.ok) return fail(ticket.error);

    const supabase = createSupabaseBrowserClient();
    const { error: upErr } = await supabase.storage
      .from(LESSON_FILES_BUCKET)
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: PDF_MIME });
    if (upErr) return fail(`${file.name} didn't upload. Check your connection and try again.`);

    const done = await finalizeLessonFile(lessonId, ticket.path, file.name);
    if (!done.ok) return fail(done.error);
    setUploads((u) => u.filter((x) => x.key !== key));
  }

  async function handleFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    if (picked.length === 0) return;
    setError(null);
    const entries = picked.map((f, i) => ({ file: f, key: `${Date.now()}-${i}-${f.name}` }));
    setUploads((u) => [...u, ...entries.map((e) => ({ key: e.key, name: e.file.name, state: "uploading" as const }))]);
    // One at a time keeps the order members see the same as the order picked.
    for (const e of entries) await uploadOne(e.file, e.key);
    router.refresh();
  }

  async function onDelete(f: AdminLessonFile) {
    const ok = await confirm({
      title: `Delete ${f.name}?`,
      body: "Members won't be able to download it anymore. This can't be undone.",
      confirmLabel: "Delete file",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteLessonFile(f.id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {dialog}
      {files.length > 0 ? (
        <SortableList
          items={files}
          itemLabel={(f) => f.name}
          onReorder={async (ids) => {
            const res = await reorderLessonFiles(lessonId, ids);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          renderItem={(f) => (
            <FileRow file={f} onDelete={() => onDelete(f)} disabled={pending} onError={setError} />
          )}
        />
      ) : null}

      {uploads.length > 0 ? (
        <ul className="space-y-1">
          {uploads.map((u) => (
            <li key={u.key} className="text-xs flex items-start gap-2">
              {u.state === "uploading" ? (
                <>
                  <span className="inline-block h-3 w-3 mt-0.5 animate-spin rounded-full border-2 border-current/30 border-t-current" aria-hidden />
                  <span className="text-[color:var(--color-text-muted)]">Uploading {u.name}…</span>
                </>
              ) : (
                <>
                  <span className="text-[color:var(--color-danger)] flex-1">{u.error}</span>
                  <button
                    type="button"
                    onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}
                    className="text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={
          "flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-[var(--radius-card)] border border-dashed text-center " +
          (dragOver ? "border-[color:var(--color-primary)] bg-[color:var(--color-surface-2)]" : "border-[color:var(--color-border)]")
        }
      >
        <p className="text-sm text-[color:var(--color-text-muted)]">Drop PDFs here, or</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-10 px-4 rounded-md bg-[color:var(--color-primary)] text-white font-heading text-xs tracking-widest"
        >
          CHOOSE PDFS
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          aria-label="Choose PDFs"
          onChange={(e) => {
            if (e.target.files) void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {error ? <p className="text-xs text-[color:var(--color-danger)]">{error}</p> : null}
    </div>
  );
}

function FileRow({
  file,
  onDelete,
  disabled,
  onError,
}: {
  file: AdminLessonFile;
  onDelete: () => void;
  disabled: boolean;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(file.name);
  const [saving, startSave] = useTransition();

  function save() {
    const trimmed = name.trim();
    if (trimmed === file.name) return;
    if (trimmed === "") {
      setName(file.name);
      return;
    }
    startSave(async () => {
      const res = await renameLessonFile(file.id, trimmed);
      if (!res.ok) {
        onError(res.error);
        setName(file.name);
      } else {
        onError(null);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3 py-2 pr-2">
      <PdfIcon />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        maxLength={200}
        aria-label="File name members see"
        className="flex-1 min-w-0 h-9 px-2 rounded-md bg-transparent border border-transparent hover:border-[color:var(--color-border)] focus:border-[color:var(--color-primary)] text-sm"
      />
      <span className="text-xs text-[color:var(--color-text-muted)] whitespace-nowrap">
        {saving ? "Saving…" : formatFileSize(file.sizeBytes)}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`Delete ${file.name}`}
        className="h-8 px-3 rounded-md border border-[color:var(--color-danger)] text-[color:var(--color-danger)] font-heading text-[11px] tracking-widest hover:bg-[color:var(--color-danger)] hover:text-white"
      >
        DELETE
      </button>
    </div>
  );
}

function PdfIcon() {
  return (
    <svg width="20" height="24" viewBox="0 0 20 24" fill="none" aria-hidden className="shrink-0 text-[color:var(--color-text-muted)]">
      <path d="M2 1h11l5 5v17H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13 1v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
