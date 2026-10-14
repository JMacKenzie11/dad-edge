import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMembership,
  authedAs,
  createCommunity,
  createTestUser,
  deleteCommunities,
  deleteUsers,
  service,
  type TestUser,
} from "./helpers/supabase";

/**
 * Resource Library RLS boundary (20261014000001_resource_library.sql).
 *
 *   1. A member sees a published course open to all communities.
 *   2. A member never sees an unpublished course, or one restricted to a
 *      community he isn't in. Lessons and file rows follow the course.
 *   3. A man past the entitlement window sees nothing.
 *   4. No lesson file is reachable through Storage with a member's own
 *      session; only the service role can sign a URL.
 *   5. Members write only their own completions, and only on lessons
 *      they can view. They can't write courses.
 */

const BUCKET = "lesson-files";
let alice: TestUser; // community A
let carol: TestUser; // community B
let dana: TestUser; //  community A, canceled long ago
let communityA: { id: string };
let communityB: { id: string };
let aliceClient: SupabaseClient;
let carolClient: SupabaseClient;
let danaClient: SupabaseClient;

const ids = {
  open: "",
  restrictedB: "",
  draft: "",
  openLesson: "",
  restrictedLesson: "",
  draftLesson: "",
  openFile: "",
};
const objectPath = `it-test/${crypto.randomUUID()}.pdf`;

beforeAll(async () => {
  [alice, carol, dana] = await Promise.all([createTestUser("alice"), createTestUser("carol"), createTestUser("dana")]);
  [communityA, communityB] = await Promise.all([createCommunity("res-A"), createCommunity("res-B")]);
  await Promise.all([
    addMembership(alice.id, communityA.id),
    addMembership(carol.id, communityB.id),
    addMembership(dana.id, communityA.id),
  ]);
  const svc = service();
  await svc
    .from("users")
    .update({ subscription_status: "canceled", canceled_at: new Date(Date.now() - 60 * 86400_000).toISOString() })
    .eq("id", dana.id);

  const suffix = crypto.randomUUID().slice(0, 8);
  const { data: courses, error } = await svc
    .from("courses")
    .insert([
      { title: "[IT-TEST] open", slug: `it-open-${suffix}`, is_published: true },
      { title: "[IT-TEST] restricted", slug: `it-restricted-${suffix}`, is_published: true },
      { title: "[IT-TEST] draft", slug: `it-draft-${suffix}`, is_published: false },
    ])
    .select("id, slug");
  if (error || !courses) throw new Error(error?.message);
  const bySlug = (prefix: string) => (courses as { id: string; slug: string }[]).find((c) => c.slug.startsWith(prefix))!.id;
  ids.open = bySlug("it-open");
  ids.restrictedB = bySlug("it-restricted");
  ids.draft = bySlug("it-draft");
  await svc.from("course_communities").insert({ course_id: ids.restrictedB, community_id: communityB.id });

  const { data: lessons } = await svc
    .from("lessons")
    .insert([
      { course_id: ids.open, title: "L1", sort_order: 0 },
      { course_id: ids.restrictedB, title: "L1", sort_order: 0 },
      { course_id: ids.draft, title: "L1", sort_order: 0 },
    ])
    .select("id, course_id");
  const lessonFor = (courseId: string) => (lessons as { id: string; course_id: string }[]).find((l) => l.course_id === courseId)!.id;
  ids.openLesson = lessonFor(ids.open);
  ids.restrictedLesson = lessonFor(ids.restrictedB);
  ids.draftLesson = lessonFor(ids.draft);

  const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
  const up = await svc.storage.from(BUCKET).upload(objectPath, pdf, { contentType: "application/pdf" });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { data: file } = await svc
    .from("lesson_files")
    .insert({ lesson_id: ids.openLesson, file_name: "Workbook", storage_path: objectPath, size_bytes: pdf.length })
    .select("id")
    .single();
  ids.openFile = (file as { id: string }).id;

  [aliceClient, carolClient, danaClient] = await Promise.all([
    authedAs(alice.email, alice.password),
    authedAs(carol.email, carol.password),
    authedAs(dana.email, dana.password),
  ]);
});

afterAll(async () => {
  const svc = service();
  await svc.storage.from(BUCKET).remove([objectPath]);
  await svc.from("courses").delete().in("id", [ids.open, ids.restrictedB, ids.draft].filter(Boolean));
  await deleteUsers([alice?.id, carol?.id, dana?.id].filter(Boolean) as string[]);
  await deleteCommunities([communityA?.id, communityB?.id].filter(Boolean) as string[]);
});

async function visibleCourseIds(client: SupabaseClient): Promise<string[]> {
  const { data } = await client.from("courses").select("id").in("id", [ids.open, ids.restrictedB, ids.draft]);
  return ((data ?? []) as { id: string }[]).map((r) => r.id).sort();
}

describe("resource library RLS", () => {
  it("member sees open courses, not drafts or other communities' courses", async () => {
    expect(await visibleCourseIds(aliceClient)).toEqual([ids.open].sort());
    expect(await visibleCourseIds(carolClient)).toEqual([ids.open, ids.restrictedB].sort());
  });

  it("lessons and file rows follow course visibility", async () => {
    const { data: lessons } = await aliceClient
      .from("lessons")
      .select("id")
      .in("id", [ids.openLesson, ids.restrictedLesson, ids.draftLesson]);
    expect(((lessons ?? []) as { id: string }[]).map((l) => l.id)).toEqual([ids.openLesson]);
    const { data: files } = await carolClient.from("lesson_files").select("id").eq("id", ids.openFile);
    expect(files).toHaveLength(1);
  });

  it("a man past the win-back window sees nothing", async () => {
    expect(await visibleCourseIds(danaClient)).toEqual([]);
  });

  it("a member's own session can't read or sign a lesson file", async () => {
    const dl = await aliceClient.storage.from(BUCKET).download(objectPath);
    expect(dl.data).toBeNull();
    const signed = await aliceClient.storage.from(BUCKET).createSignedUrl(objectPath, 60);
    expect(signed.data).toBeNull();
    const list = await aliceClient.storage.from(BUCKET).list("it-test");
    expect(list.data ?? []).toHaveLength(0);
  });

  it("a member can't upload into the lesson files bucket", async () => {
    const res = await aliceClient.storage
      .from(BUCKET)
      .upload(`it-test/${crypto.randomUUID()}.pdf`, new TextEncoder().encode("%PDF-1.4"), { contentType: "application/pdf" });
    expect(res.error).not.toBeNull();
  });

  it("completions: own row on a visible lesson only", async () => {
    const ok = await aliceClient.from("lesson_completions").insert({ user_id: alice.id, lesson_id: ids.openLesson });
    expect(ok.error).toBeNull();
    const draft = await aliceClient.from("lesson_completions").insert({ user_id: alice.id, lesson_id: ids.draftLesson });
    expect(draft.error).not.toBeNull();
    const restricted = await aliceClient.from("lesson_completions").insert({ user_id: alice.id, lesson_id: ids.restrictedLesson });
    expect(restricted.error).not.toBeNull();
    const forged = await aliceClient.from("lesson_completions").insert({ user_id: carol.id, lesson_id: ids.openLesson });
    expect(forged.error).not.toBeNull();
  });

  it("completions are private to their owner", async () => {
    await carolClient.from("lesson_completions").insert({ user_id: carol.id, lesson_id: ids.openLesson });
    const { data } = await aliceClient.from("lesson_completions").select("user_id").eq("lesson_id", ids.openLesson);
    expect(((data ?? []) as { user_id: string }[]).every((r) => r.user_id === alice.id)).toBe(true);
  });

  it("members can't write courses, lessons or visibility rows", async () => {
    const c = await aliceClient.from("courses").insert({ title: "x", slug: `it-x-${crypto.randomUUID().slice(0, 6)}` });
    expect(c.error).not.toBeNull();
    const u = await aliceClient.from("courses").update({ is_published: true }).eq("id", ids.draft).select("id");
    expect(u.data ?? []).toHaveLength(0);
    const v = await aliceClient.from("course_communities").insert({ course_id: ids.restrictedB, community_id: communityA.id });
    expect(v.error).not.toBeNull();
  });
});
