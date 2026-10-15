/**
 * Seed the Resource Library with a review course: "Patience Course",
 * seven placeholder lessons, so every screen can be reviewed without real
 * content.
 *
 *   - Lessons use Blender's "Big Buck Bunny" (Creative Commons, public on
 *     Vimeo) as the stand-in video.
 *   - Lesson 2 has two PDFs. Lesson 4 has no video, only a PDF.
 *   - The PDFs are generated here, so nothing has to be checked in.
 *
 * SAFE BY DEFAULT: this points at whatever Supabase .env.local names, and
 * that is production. Without flags the course is created as a DRAFT,
 * which members can't see; admins review it through "Preview as member".
 *
 *   npm run seed:courses                         draft, all communities
 *   npm run seed:courses -- --community <slug>   restrict to one community
 *   npm run seed:courses -- --publish            publish it (members see it)
 *   npm run seed:courses -- --reset              delete and recreate
 *   npm run seed:courses -- --remove             delete it and its files
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isEntryPoint } from "./lib/entry";
import { assertDevTarget } from "./lib/target";

const SLUG = "patience-course";
const BUCKET = "lesson-files";
const VIDEO_URL = "https://vimeo.com/1084537";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

let svc: SupabaseClient;

/** Connects when main() starts, never at import, and only to the dev
 *  database (CLAUDE.md ground rules). */
function connect(): void {
  assertDevTarget();
  svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function p(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const OVERVIEW = {
  type: "doc",
  content: [
    p("Placeholder course for reviewing the Resource Library. Seven short lessons on patience at home: what sets you off, what to do in the moment, and how to repair when you get it wrong."),
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "How to use it" }] },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p("Watch one lesson a day.")] },
        { type: "listItem", content: [p("Download the worksheet and fill it in the same day.")] },
        { type: "listItem", content: [p("Mark the lesson complete when you've done both.")] },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Questions? Bring them to " },
        { type: "text", text: "your community", marks: [{ type: "bold" }] },
        { type: "text", text: " this week." },
      ],
    },
  ],
};

const LESSONS: Array<{ title: string; video: boolean; files: string[]; description?: string }> = [
  { title: "Welcome: why patience is a skill, not a trait", video: true, files: [], description: "Start here. What the next six lessons cover and what to have ready." },
  { title: "Know your triggers", video: true, files: ["Trigger Log", "Trigger Log Example"], description: "Fill in the log for three days before the next lesson." },
  { title: "The ten-second pause", video: true, files: [] },
  { title: "Worksheet: your patience plan", video: false, files: ["Patience Plan Worksheet"], description: "No video for this one. Print the worksheet and fill it in with your partner if you can." },
  { title: "Patience with your kids", video: true, files: [] },
  { title: "Patience with your partner", video: true, files: [] },
  { title: "When you lose it: how to repair", video: true, files: [], description: "The repair conversation, step by step." },
];

/** A small, valid one-page PDF with a title line. Offsets are computed so
 *  any reader opens it. */
function makePdf(title: string): Uint8Array {
  const safe = title.replace(/[()\\]/g, "");
  const stream = `BT /F1 24 Tf 72 720 Td (${safe}) Tj ET\nBT /F1 12 Tf 72 690 Td (Placeholder file for the Resource Library seed course.) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

async function vimeo() {
  const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(VIDEO_URL)}&width=960`);
  if (!res.ok) throw new Error(`Vimeo oEmbed failed: ${res.status}`);
  const body = (await res.json()) as { video_id: number; thumbnail_url: string; duration: number };
  return { id: String(body.video_id), thumb: body.thumbnail_url, duration: body.duration };
}

async function removeCourse(courseId: string) {
  const { data: lessons } = await svc.from("lessons").select("id").eq("course_id", courseId);
  const lessonIds = ((lessons ?? []) as { id: string }[]).map((l) => l.id);
  if (lessonIds.length) {
    const { data: files } = await svc.from("lesson_files").select("storage_path").in("lesson_id", lessonIds);
    const paths = ((files ?? []) as { storage_path: string }[]).map((f) => f.storage_path);
    if (paths.length) await svc.storage.from(BUCKET).remove(paths);
  }
  await svc.from("courses").delete().eq("id", courseId);
}

async function main() {
  connect();
  const { data: existing } = await svc.from("courses").select("id").eq("slug", SLUG).maybeSingle();
  if (existing && (flag("reset") || flag("remove"))) {
    await removeCourse((existing as { id: string }).id);
    console.log(`[seed:courses] removed existing ${SLUG}`);
    if (flag("remove")) return;
  } else if (existing) {
    console.log(`[seed:courses] ${SLUG} already exists. Use --reset to recreate it or --remove to delete it.`);
    return;
  } else if (flag("remove")) {
    console.log(`[seed:courses] nothing to remove`);
    return;
  }

  let communityId: string | null = null;
  const communitySlug = value("community");
  if (communitySlug) {
    const { data } = await svc.from("communities").select("id").eq("slug", communitySlug).maybeSingle();
    if (!data) throw new Error(`No community with slug ${communitySlug}`);
    communityId = (data as { id: string }).id;
  }

  const video = await vimeo();
  const { data: course, error } = await svc
    .from("courses")
    .insert({ title: "Patience Course", slug: SLUG, overview_json: OVERVIEW, is_published: flag("publish"), is_pinned: true, sort_order: 0 })
    .select("id")
    .single();
  if (error || !course) throw new Error(`course insert: ${error?.message}`);
  const courseId = (course as { id: string }).id;
  if (communityId) await svc.from("course_communities").insert({ course_id: courseId, community_id: communityId });

  for (const [i, l] of LESSONS.entries()) {
    const { data: lesson, error: lErr } = await svc
      .from("lessons")
      .insert({
        course_id: courseId,
        title: l.title,
        sort_order: i,
        description_json: l.description ? { type: "doc", content: [p(l.description)] } : null,
        ...(l.video
          ? {
              vimeo_url: VIDEO_URL,
              vimeo_video_id: video.id,
              vimeo_hash: null,
              vimeo_thumbnail_url: video.thumb,
              vimeo_duration_seconds: video.duration,
            }
          : {}),
      })
      .select("id")
      .single();
    if (lErr || !lesson) throw new Error(`lesson insert: ${lErr?.message}`);
    const lessonId = (lesson as { id: string }).id;
    for (const [j, name] of l.files.entries()) {
      const bytes = makePdf(name);
      const path = `${lessonId}/${crypto.randomUUID()}-${name.toLowerCase().replace(/\s+/g, "-")}.pdf`;
      const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf" });
      if (up.error) throw new Error(`upload ${name}: ${up.error.message}`);
      await svc.from("lesson_files").insert({ lesson_id: lessonId, file_name: name, storage_path: path, size_bytes: bytes.length, sort_order: j });
    }
  }

  console.log(
    `[seed:courses] created Patience Course (${LESSONS.length} lessons) · ${flag("publish") ? "PUBLISHED" : "draft"} · ${
      communitySlug ? `only ${communitySlug}` : "all communities"
    }`,
  );
  console.log(`[seed:courses] admin editor: /admin/courses/${courseId}`);
  console.log(`[seed:courses] member view:  /resources/${SLUG}${flag("publish") ? "" : "?preview=1 (admins only while it's a draft)"}`);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
