import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authedAs, createTestUser, deleteUsers, service, type TestUser } from "./helpers/supabase";

/**
 * Partner survey drafts against the dev database, as real members
 * (20261110000001_partner_survey_drafts.sql; DECISIONS.md "Partner survey
 * saves every answer").
 */

const svc = service();
let alice: TestUser, bob: TestUser;
let asAlice: SupabaseClient, asBob: SupabaseClient;
let setId = "";
let questionIds: string[] = [];

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestUser("survey-alice"), createTestUser("survey-bob")]);
  asAlice = await authedAs(alice.email, alice.password);
  asBob = await authedAs(bob.email, bob.password);
  const { data: set } = await svc
    .from("survey_question_sets")
    .select("id, questions:survey_questions(id, sort_order)")
    .eq("version", "v1")
    .single();
  setId = set!.id as string;
  questionIds = (set!.questions as { id: string; sort_order: number }[])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((q) => q.id);
});

afterAll(async () => {
  await deleteUsers([alice.id, bob.id]);
});

describe("partner survey drafts", () => {
  let draftId = "";

  it("a plain insert (the code before drafts) still creates a finished survey", async () => {
    const { data, error } = await asAlice
      .from("partner_surveys")
      .insert({ user_id: alice.id, question_set_id: setId })
      .select("id, completed_at")
      .single();
    expect(error).toBeNull();
    expect(data!.completed_at).not.toBeNull();
  });

  it("a member can start a draft and save a note before its score", async () => {
    const { data, error } = await asAlice
      .from("partner_surveys")
      .insert({ user_id: alice.id, question_set_id: setId, completed_at: null })
      .select("id, completed_at")
      .single();
    expect(error).toBeNull();
    expect(data!.completed_at).toBeNull();
    draftId = data!.id as string;

    const { error: noteErr } = await asAlice
      .from("partner_survey_responses")
      .insert({ survey_id: draftId, question_id: questionIds[0], score: null, note: "She laughed first" });
    expect(noteErr).toBeNull();
  });

  it("allows only one draft per member", async () => {
    const { error } = await asAlice
      .from("partner_surveys")
      .insert({ user_id: alice.id, question_set_id: setId, completed_at: null });
    expect(error?.code).toBe("23505");
  });

  it("still refuses a score outside 1-5", async () => {
    const { error } = await asAlice
      .from("partner_survey_responses")
      .upsert({ survey_id: draftId, question_id: questionIds[0], score: 6, note: "x" }, { onConflict: "survey_id,question_id" });
    expect(error).not.toBeNull();
  });

  it("another member can't see or change the draft", async () => {
    const { data } = await asBob.from("partner_surveys").select("id").eq("id", draftId);
    expect(data).toEqual([]);
    const { data: answers } = await asBob.from("partner_survey_responses").select("id").eq("survey_id", draftId);
    expect(answers).toEqual([]);
    const { error } = await asBob
      .from("partner_survey_responses")
      .insert({ survey_id: draftId, question_id: questionIds[1], score: 1, note: "not his" });
    expect(error).not.toBeNull();
  });

  it("discarding the draft removes its answers", async () => {
    const { error } = await asAlice.from("partner_surveys").delete().eq("id", draftId);
    expect(error).toBeNull();
    const { data } = await svc.from("partner_survey_responses").select("id").eq("survey_id", draftId);
    expect(data).toEqual([]);
  });
});
