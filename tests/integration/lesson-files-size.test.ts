import { afterAll, describe, expect, it } from "vitest";
import { LESSON_FILES_BUCKET, MAX_PDF_BYTES } from "../../src/lib/resources/files";
import { service } from "./helpers/supabase";

/**
 * The lesson-files bucket takes a PDF up to the app's limit (50 MB), so
 * a file the admin page accepts isn't then refused by Storage. Uploads a
 * 30 MB PDF (over the old 25 MB cap) and checks a file over 50 MB is
 * still refused. Dev database only.
 */

const PATH = `zz-size-test/${Date.now()}`;

function pdfOf(bytes: number): Buffer {
  const b = Buffer.alloc(bytes);
  b.write("%PDF-1.7\n");
  return b;
}

describe("lesson-files bucket size limit", () => {
  afterAll(async () => {
    await service().storage.from(LESSON_FILES_BUCKET).remove([`${PATH}-ok.pdf`, `${PATH}-big.pdf`]);
  });

  it("accepts a 30 MB PDF", async () => {
    const { error } = await service()
      .storage.from(LESSON_FILES_BUCKET)
      .upload(`${PATH}-ok.pdf`, pdfOf(30 * 1024 * 1024), { contentType: "application/pdf" });
    expect(error).toBeNull();
  }, 120_000);

  it("refuses a PDF over the app's limit", async () => {
    const { error } = await service()
      .storage.from(LESSON_FILES_BUCKET)
      .upload(`${PATH}-big.pdf`, pdfOf(MAX_PDF_BYTES + 1024 * 1024), { contentType: "application/pdf" });
    expect(error).not.toBeNull();
  }, 120_000);
});
