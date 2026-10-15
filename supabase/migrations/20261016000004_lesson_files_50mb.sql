-- =============================================================================
-- Lesson PDFs: 50 MB per file, up from 25 MB (Jason, 2026-10-16).
--
-- 50 MB is also the Supabase project's own per-file upload limit on both
-- projects (Storage settings), so this is as high as it goes without
-- changing that setting. Matches MAX_PDF_MB in src/lib/resources/files.ts.
-- =============================================================================

update storage.buckets
set file_size_limit = 52428800
where id = 'lesson-files';
