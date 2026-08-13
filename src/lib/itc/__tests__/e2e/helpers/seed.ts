/**
 * Seed a test map into a specific late-stage state by writing rows
 * directly via the service client. Skips the coach entirely — used
 * only when we want to test iteration paths or terminal transitions
 * without walking the whole flow every time.
 *
 * NOTE: seeded state does NOT populate the coach's transcript
 * memory, so the coach might behave slightly differently than a
 * naturally-built map. Trust runTurn results, not seeded state
 * expectations.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { TestMapContext } from "./fixtures";

/**
 * Seed to results stage with one full test cycle complete:
 * - goal locked
 * - 4 selected behaviors
 * - 4 locked worries
 * - 4 commitments
 * - 1 Big Assumption (selected_for_testing, all commitments linked)
 * - 1 test row (status=run) + 1 test_result row (partially_challenged)
 * - reveal_delivered = true, walkthrough_delivered = true
 * - stage = results
 *
 * Ready for the iteration turn — user says "let me run another test"
 * and the coach should fire advance_stage → test_design.
 */
export async function seedToResultsAfterFirstTest(
  ctx: TestMapContext,
): Promise<void> {
  const supabase = createSupabaseServiceClient();

  // Map: set stage + flags + goal.
  await supabase
    .from("itc_maps")
    .update({
      improvement_goal:
        "I'm committed to getting better at being present and calm when my wife is upset with me.",
      current_stage: "results",
      reveal_delivered: true,
      walkthrough_delivered: true,
    })
    .eq("id", ctx.mapId);

  // Behaviors.
  const behaviorRows = [
    "I shut down and walk out of the room",
    "I bring up things she did wrong in the past",
    "I go on the offense and start pointing out her flaws",
    "I agree just to end the conversation, without meaning it",
  ].map((text, i) => ({
    map_id: ctx.mapId,
    text,
    source: "user" as const,
    selected: true,
    sort_order: i,
  }));
  const { data: behaviors, error: bErr } = await supabase
    .from("itc_behaviors")
    .insert(behaviorRows)
    .select("id, sort_order");
  if (bErr || !behaviors) throw new Error(`seed behaviors: ${bErr?.message}`);
  const orderedBehaviors = behaviors.sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  // Worries — one per behavior.
  const worryTexts = [
    "I worry that if I stop shutting down, I'll say the thing that makes me the husband who hurt her.",
    "I worry that if I stop bringing up her past, I'll be the one who's the problem in this marriage.",
    "I worry that if I stop pointing out her flaws, I'll be exposed as having nothing to say.",
    "I worry that if I stop agreeing to end it, she'll see the strong version of me is a costume.",
  ];
  const worryRows = orderedBehaviors.map((b, i) => ({
    map_id: ctx.mapId,
    behavior_id: b.id,
    text: worryTexts[i],
    depth_score: 3,
  }));
  const { data: worries, error: wErr } = await supabase
    .from("itc_worries")
    .insert(worryRows)
    .select("id");
  if (wErr || !worries) throw new Error(`seed worries: ${wErr?.message}`);

  // Commitments.
  const commitmentTexts = [
    "I'm also committed to shutting down before I can say the thing that would hurt her.",
    "I'm also committed to keeping her past mistakes on the table so mine are never the only ones counted.",
    "I'm also committed to putting her flaws in view so I never have to face what I have nothing to say to.",
    "I'm also committed to agreeing early so she can't test whether I actually hold my own.",
  ];
  const commitmentRows = worries.map((w, i) => ({
    map_id: ctx.mapId,
    worry_id: w.id,
    text: commitmentTexts[i],
  }));
  const { data: commitments, error: cErr } = await supabase
    .from("itc_commitments")
    .insert(commitmentRows)
    .select("id");
  if (cErr || !commitments)
    throw new Error(`seed commitments: ${cErr?.message}`);

  // Big Assumption + links to all commitments.
  const { data: assumption, error: aErr } = await supabase
    .from("itc_assumptions")
    .insert({
      map_id: ctx.mapId,
      text: "I assume that if I let her see the real me under pressure, I'll lose her respect for good.",
      depth_score: 3,
      sort_order: 0,
      selected_for_testing: true,
      coach_recommended: true,
    })
    .select("id")
    .single();
  if (aErr || !assumption)
    throw new Error(`seed assumption: ${aErr?.message}`);

  const linkRows = commitments.map((c) => ({
    assumption_id: assumption.id,
    commitment_id: c.id,
  }));
  const { error: lErr } = await supabase
    .from("itc_assumption_commitments")
    .insert(linkRows);
  if (lErr) throw new Error(`seed assumption links: ${lErr.message}`);

  // First test — a data-mining test that was run.
  const { data: test, error: tErr } = await supabase
    .from("itc_tests")
    .insert({
      map_id: ctx.mapId,
      assumption_id: assumption.id,
      test_type: "data_mining",
      assumption_says:
        "If she sees the real me under pressure, she'll lose respect for good.",
      behavior_change:
        "Look back at 3 recent fights where I stayed present instead of the usual protective move.",
      data_to_collect:
        "What actually happened after I stayed — did she treat me differently, walk away, or was it smaller than the assumption predicted?",
      in_order_to_find_out:
        "Whether the collapse the assumption predicts actually shows up when I'm not running the protective moves.",
      target_date: "2026-08-10",
      status: "run",
    })
    .select("id")
    .single();
  if (tErr || !test) throw new Error(`seed test: ${tErr?.message}`);

  // Test result — partially challenged.
  const { error: rErr } = await supabase.from("itc_test_results").insert({
    test_id: test.id,
    ran_on: "2026-08-11",
    what_i_did:
      "Looked at three fights over the last month where I actually stayed instead of walking or attacking.",
    data_collected:
      "She got upset briefly in each one but nothing catastrophic happened. In one, she actually softened after a minute. I felt uncomfortable but not annihilated.",
    what_it_says_about_assumption:
      "The absolute version of the assumption (she'll lose respect for good) didn't play out. Some charge remains but the belief isn't as unqualified as it felt.",
    assumption_verdict: "partially_challenged",
    next_step: "new_test",
  });
  if (rErr) throw new Error(`seed test result: ${rErr.message}`);
}
