/**
 * PDF attachment rules, shared by the admin uploader (client) and the
 * server actions that finalize an upload. Both sides check, and the
 * server's check is the one that counts.
 */

export const LESSON_FILES_BUCKET = "lesson-files";
/** 50 MB: the most Supabase Storage takes per file on both projects
 *  (project setting), and the lesson-files bucket's own limit. */
export const MAX_PDF_MB = 50;
export const MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;
export const TOO_BIG_MESSAGE = (name: string) =>
  `${name} is over ${MAX_PDF_MB} MB. Compress it or split it, then try again.`;
export const PDF_MIME = "application/pdf";

/** Every PDF starts with "%PDF-". An extension or a browser-reported
 *  type is a claim; these five bytes are the file. */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

export function hasPdfExtension(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

/** Display name an admin sees and can edit: the file name without ".pdf". */
export function defaultDisplayName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim();
  return base.length > 0 ? base.slice(0, 200) : "Download";
}

/** Storage object names stay ASCII and predictable; the display name is
 *  what people see. */
export function storageSafeName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const withExt = hasPdfExtension(cleaned) ? cleaned : `${cleaned || "file"}.pdf`;
  return withExt.slice(-120);
}

/** Name for the browser's Save dialog. */
export function downloadFileName(displayName: string): string {
  const safe = displayName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "download";
  return hasPdfExtension(safe) ? safe : `${safe}.pdf`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Client-side pre-check. Returns an error message or null. */
export async function checkPdfFile(file: File): Promise<string | null> {
  if (!hasPdfExtension(file.name) || (file.type && file.type !== PDF_MIME)) {
    return `${file.name} isn't a PDF. Only PDF files can be attached.`;
  }
  if (file.size > MAX_PDF_BYTES) {
    return TOO_BIG_MESSAGE(file.name);
  }
  if (file.size === 0) return `${file.name} is empty.`;
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (!hasPdfSignature(head)) {
    return `${file.name} isn't a real PDF, even though the name ends in .pdf. Export it as a PDF and try again.`;
  }
  return null;
}
