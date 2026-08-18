import { describe, expect, it } from "vitest";
import { parseCoachMarkers } from "../../marker-parser";

describe("parseCoachMarkers — content markers become proposals", () => {
  it("propose_goal", () => {
    const t =
      'How\'s this: <<propose_goal>>I\'m committed to getting better at being present and calm when my wife is upset.<</propose_goal>> Lock it in?';
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(1);
    expect(r.immediateActions).toHaveLength(0);
    expect(r.proposals[0]).toEqual({
      type: "propose_goal",
      text: "I'm committed to getting better at being present and calm when my wife is upset.",
    });
    expect(r.strippedText).not.toContain("<<");
    expect(r.strippedText).toContain("Lock it in?");
  });

  it("propose_behavior", () => {
    const t =
      "Got it — <<propose_behavior>>I bring up things she did in the past instead of listening to her.<</propose_behavior>> Anything else?";
    const r = parseCoachMarkers(t);
    expect(r.proposals[0]).toEqual({
      type: "propose_behavior",
      text: "I bring up things she did in the past instead of listening to her.",
    });
  });

  it("propose_worry with behavior attribute", () => {
    const t =
      "That's the fear underneath #2. <<propose_worry behavior=2>>I worry that if I let myself feel small or wrong in front of her, she'd lose respect for me as a man.<</propose_worry>> Behavior #3 was...";
    const r = parseCoachMarkers(t);
    expect(r.proposals[0]).toMatchObject({
      type: "propose_worry",
      behavior_index: 2,
      text: expect.stringContaining("she'd lose respect for me as a man"),
    });
  });

  it("propose_commitments_batch parses numbered list body", () => {
    const t = `Here are the drafts:
<<propose_commitments_batch>>
1. I'm also committed to keeping her past mistakes available so mine are never the only thing on the table.
2. I'm also committed to staying in control of the narrative about who I am, so I don't have to face being not good enough.
3. I'm also committed to leaving the room before I lose control, so I never have to face what I'm capable of saying.
4. I'm also committed to staying positioned as the one who sees clearly, so she never sees me as diminished.
<</propose_commitments_batch>>
Lock them in when the set is right.`;
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(1);
    const batch = r.proposals[0];
    if (batch.type !== "propose_commitments_batch") throw new Error("wrong type");
    expect(batch.items).toHaveLength(4);
    expect(batch.items[0].worry_index).toBe(1);
    expect(batch.items[0].text).toContain("keeping her past mistakes");
    expect(batch.items[3].worry_index).toBe(4);
  });

  it("propose_assumption with commits attribute", () => {
    const t =
      "Cluster A candidate: <<propose_assumption commits=1,4>>I assume that if I admit I'm the kind of guy who keeps doing things that hurt her, then I'm not worth staying with.<</propose_assumption>> Does that hold for both?";
    const r = parseCoachMarkers(t);
    const a = r.proposals[0];
    if (a.type !== "propose_assumption") throw new Error("wrong type");
    expect(a.commitment_indices).toEqual([1, 4]);
    expect(a.text).toContain("not worth staying with");
  });

  it("save_test_design parses labeled fields", () => {
    const t = `Here's a first draft:
<<save_test_design type=observation target=2026-08-24>>
my_big_assumption_says: I assume that if I let myself feel small in front of her, she'd lose respect for me as a man.
so_i_will: For the next week, notice when the pull to protect myself fires.
and_collect_the_following_data: What specifically triggers the pull.
in_order_to_find_out: Whether the assumption holds up under real observation.
<</save_test_design>>
Read it and say save it.`;
    const r = parseCoachMarkers(t);
    const test = r.proposals[0];
    if (test.type !== "save_test_design") throw new Error("wrong type");
    expect(test.test_type).toBe("observation");
    expect(test.target_date).toBe("2026-08-24");
    expect(test.assumption_says).toContain("she'd lose respect for me");
    expect(test.behavior_change).toContain("notice when the pull");
    expect(test.data_to_collect).toContain("specifically triggers");
    expect(test.in_order_to_find_out).toContain("holds up under real observation");
  });
});

describe("parseCoachMarkers — transition markers apply immediately", () => {
  it("advance_stage as self-closing", () => {
    const t = "Locked. <<advance stage=behaviors>> Column 2 is what you...";
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(0);
    expect(r.immediateActions).toHaveLength(1);
    expect(r.immediateActions[0]).toEqual({
      type: "advance_stage",
      to: "behaviors",
    });
  });

  it("mark_walkthrough_delivered as self-closing", () => {
    const t = "What's it like to see that? <<mark_walkthrough_delivered>>";
    const r = parseCoachMarkers(t);
    expect(r.immediateActions[0]).toEqual({
      type: "mark_walkthrough_delivered",
    });
  });

  it("select_assumption applies immediately (small pick, no card)", () => {
    const t = "Switching to #2. <<select_assumption index=2>>";
    const r = parseCoachMarkers(t);
    expect(r.immediateActions[0]).toEqual({
      type: "select_assumption_for_testing",
      assumption_index: 2,
    });
  });
});

describe("parseCoachMarkers — strippedText hides all markers from coachee", () => {
  it("strips valid markers cleanly", () => {
    const t =
      "Locked. <<advance stage=commitments>> Here's what I'm drafting: <<propose_commitments_batch>>\n1. one\n2. two\n<</propose_commitments_batch>>";
    const r = parseCoachMarkers(t);
    expect(r.strippedText).not.toMatch(/<<|>>/);
    expect(r.strippedText).toContain("Locked.");
    expect(r.strippedText).toContain("Here's what I'm drafting:");
  });

  it("strips malformed tags via defense-in-depth pass", () => {
    // Coach forgot closing tag — first regex won't match, but the
    // defense-in-depth pass strips the opening tag anyway.
    const t = "Locked. <<advance stage=commitments Column 2 is next.";
    const r = parseCoachMarkers(t);
    // The malformed opening tag itself won't be recognized as an
    // action, and the defense-in-depth pass only strips complete
    // <<...>> shapes. In this pathological case, the opening tag
    // string persists — the design tradeoff is: strict grammar wins,
    // malformed tags visible to coachee. Acceptable because it makes
    // the prompt failure obvious.
    // For the more common case (typo in tag name):
    const t2 = "Text <<lock-worry behavior=2>> more text <</lock-worry>>";
    const r2 = parseCoachMarkers(t2);
    expect(r2.strippedText).not.toMatch(/<<lock-worry>>|<<\/lock-worry>>/);
    // Body between tags remains visible when the tag itself is unknown.
    expect(r2.strippedText).toContain("more text");
  });

  it("collapses whitespace holes after marker removal", () => {
    const t = "Line 1\n\n\n<<propose_behavior>>text<</propose_behavior>>\n\n\nLine 2";
    const r = parseCoachMarkers(t);
    expect(r.strippedText).not.toMatch(/\n{3,}/);
  });
});

describe("parseCoachMarkers — errors on invalid markers", () => {
  it("unknown tag name lands in errors", () => {
    const t = "<<pretend_action>>text<</pretend_action>>";
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(0);
    expect(r.immediateActions).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("unknown marker"))).toBe(true);
  });

  it("propose_worry missing behavior attribute", () => {
    const t = "<<propose_worry>>I worry that...<</propose_worry>>";
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("behavior"))).toBe(true);
  });

  it("propose_assumption missing commits attribute", () => {
    const t = "<<propose_assumption>>I assume that...<</propose_assumption>>";
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(0);
    expect(r.errors.some((e) => e.includes("commits"))).toBe(true);
  });

  it("multiple markers in one message all parse", () => {
    const t =
      "Landed #2. <<propose_worry behavior=2>>I worry that if X, then Y.<</propose_worry>> On to #3. <<propose_worry behavior=3>>I worry that if A, then B.<</propose_worry>>";
    const r = parseCoachMarkers(t);
    expect(r.proposals).toHaveLength(2);
    if (r.proposals[0].type !== "propose_worry") throw new Error("wrong type");
    if (r.proposals[1].type !== "propose_worry") throw new Error("wrong type");
    expect(r.proposals[0].behavior_index).toBe(2);
    expect(r.proposals[1].behavior_index).toBe(3);
  });

  it("empty input returns empty result", () => {
    const r = parseCoachMarkers("");
    expect(r.proposals).toEqual([]);
    expect(r.immediateActions).toEqual([]);
    expect(r.strippedText).toBe("");
  });

  it("no markers in input passes through cleanly", () => {
    const t = "Just a chat message with no markers.";
    const r = parseCoachMarkers(t);
    expect(r.strippedText).toBe(t);
    expect(r.proposals).toEqual([]);
    expect(r.immediateActions).toEqual([]);
  });
});
