/**
 * Deterministic unit tests for looksLikeStructuredOutputLeakage. No LLM
 * calls, no network, no fixtures — pure regex/logic. Runs fast, catches
 * regressions instantly, and every new garbled reply observed in prod
 * gets a case here so the detector never loses coverage.
 *
 * When a new leakage variant slips into a production session, copy the
 * exact reply text into a `should catch` case below and extend
 * looksLikeStructuredOutputLeakage until this file passes again. That
 * turns "guard drift" into a mechanical add-and-extend loop.
 */

import { describe, expect, it } from "vitest";
import { looksLikeStructuredOutputLeakage } from "../../coach";

describe("looksLikeStructuredOutputLeakage — should CATCH", () => {
  // NOTE: pure zero-letter garbage like `.}` is caught by the
  // isNoLetters check in actions.ts (runItcCoachTurnWithGuards), not
  // here. This detector focuses on leakage variants that HAVE letters
  // and would otherwise slip past that first filter.

  it("quoted schema key mid-reply", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        `Here's the full map, locked - showing this]},."action"}) Wait, ignore that formatting].`,
      ),
    ).toBe(true);
  });

  it('meta-correction "wait, the format leaked"', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "wait, the format leaked. Let me answer properly.",
      ),
    ).toBe(true);
  });

  it('meta-correction "ignore that formatting"', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "That's the fear underneath. }, ambient artifact, ignore }. Continuing.",
      ),
    ).toBe(true);
  });

  it("placeholder stub reply", () => {
    expect(looksLikeStructuredOutputLeakage("the reply is here")).toBe(true);
    expect(looksLikeStructuredOutputLeakage("Response goes here")).toBe(true);
    expect(looksLikeStructuredOutputLeakage("[content]")).toBe(true);
    expect(looksLikeStructuredOutputLeakage("TODO")).toBe(true);
  });

  it("truncated fragment — short reply, no terminal punctuation", () => {
    expect(looksLikeStructuredOutputLeakage("keep going, this one")).toBe(true);
  });

  it("two or more JSON-structural fragments", () => {
    expect(
      looksLikeStructuredOutputLeakage("Something ]} else and }) more"),
    ).toBe(true);
  });

  // ---- The 2026-08-12 case: unquoted schema tokens rendered as prose ----

  it('unquoted "Action:" label at start of a line', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        `Here's your worry.\n\nAction: propose_worry with behavior_index=2.`,
      ),
    ).toBe(true);
  });

  it('mangled "nAction:" (escape artifact) from real session', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        `Admitting she's right and then not being able to follow through, that would'd make you words that don't hean it means anything.\n\nThat's worry #2.\n\nnAction: propose_worry with beh_derior_index=2, textting the worry text.`,
      ),
    ).toBe(true);
  });

  it('unquoted action-type name in prose ("propose_worry", "advance_stage", etc.)', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "That's the fear. Firing propose_worry for behavior 2.",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage(
        "Good. Emitting advance_stage to move us to commitments.",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage(
        "Locking these in via propose_commitments_batch.",
      ),
    ).toBe(true);
  });

  it('unquoted "*_index" assignments leaked from action metadata', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "Setting the worry text with behavior_index=3.",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage(
        "Firing with worry_index: 1 and text: ...",
      ),
    ).toBe(true);
  });

  it('banned "That\'s worry #N" narration', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I worry that if I stay, she'd be right. That's worry #2.",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage("That's worry #4 — moving to #5.")
    ).toBe(true);
  });

  // ---- 2026-08-12 case 2: model reasoning chain leaked as reply ----

  it("meta-editing phrase — model announced it was about to write the real reply", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "That's the fear. Let's writing the actual reply text properly now:",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage(
        "Right — let me start the actual reply.",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage("Actually let me answer that.")
    ).toBe(true);
  });

  it("trailing colon with no list continuation", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "Now the last worry locked, that would give commitments column intro:",
      ),
    ).toBe(true);
    expect(looksLikeStructuredOutputLeakage("Here's what I hear:")).toBe(true);
  });

  it("third-person coach self-narrative — refers to coachee as he/him/his", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "going on to attack, that would mean losing, that would mean she'd think less of him and he'd look weak as a man",
      ),
    ).toBe(true);
    expect(
      looksLikeStructuredOutputLeakage("he'd feel exposed and unable to hold his ground.")
    ).toBe(true);
  });

  it("full reasoning-chain leak from real 2026-08-12 session", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "going on to attack, that would 't losing, that would means she'd think less of him and he'd look weak as a man.that's the fear under #4..Now the last worry locked, that would give commitments column intro..Let's writing the actual reply text properly now:",
      ),
    ).toBe(true);
  });

  // ---- Text-level corruption in action.text (2026-08-12 case 3) ----

  it("doubled stem fragment — 'worworry'", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I worry that i worworry that ifbringing up her past, I'd have to admit some of what she says is fair.",
      ),
    ).toBe(true);
  });

  it("doubled stem fragment — 'comcomcommitment'", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I'm also comcommitted to keeping the ledger stacked.",
      ),
    ).toBe(true);
  });

  it('multiple "I worry that" in a short window', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I worry that if I stay, I worry that she'll see me collapse.",
      ),
    ).toBe(true);
  });

  it('multiple "I\'m also committed to" in a short window', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I'm also committed to leaving early I'm also committed to shutting down.",
      ),
    ).toBe(true);
  });
});

describe("looksLikeStructuredOutputLeakage — should NOT catch (real coach replies)", () => {
  it("normal probing question", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "And what would be the worst part of that for you?",
      ),
    ).toBe(false);
  });

  it("acknowledgment plus pivot (with terminal punctuation)", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "That's the fear under #1. Behavior #2 was 'I shut down and walk out of the room' — if you stopped doing that, what are you afraid would happen?",
      ),
    ).toBe(false);
  });

  it("commitments intro + drafted list", () => {
    const reply = `That's the fear underneath #4. These are commitments a part of you already made, quietly, to make sure that fear never gets tested. Here's one for each:

1. I'm also committed to leaving the room before she can prove I'm the one who screwed up.
2. I'm also committed to staying closed off to what's bothering her so I can't say the thing that hurts her.
3. I'm also committed to keeping her past mistakes on the table so mine are never the only ones being counted.
4. I'm also committed to agreeing before she can test whether I can actually hold my own.

Read each one and tell me which don't fit.`;
    expect(looksLikeStructuredOutputLeakage(reply)).toBe(false);
  });

  it("brief acknowledgment ending in period", () => {
    expect(looksLikeStructuredOutputLeakage("Locked.")).toBe(false);
    expect(looksLikeStructuredOutputLeakage("Right.")).toBe(false);
    expect(looksLikeStructuredOutputLeakage("Got it.")).toBe(false);
  });

  it("legitimate mention of behavior number without action metadata", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "Behavior #2 was 'I shut down' — what are you afraid would happen?",
      ),
    ).toBe(false);
  });

  it("reveal narrative mentioning column numbers", () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "Column 1 is the gas — you want to be present with her. Column 4 is the brake — the vows a part of you made to make sure the fears in column 3 never come true.",
      ),
    ).toBe(false);
  });

  it('worry stem in reply ("I worry that...")', () => {
    expect(
      looksLikeStructuredOutputLeakage(
        "I worry that if I stop guiding people down that forced path, I've failed them.",
      ),
    ).toBe(false);
  });

  it("intro line followed by numbered list (colon is legit here)", () => {
    const reply = `Here's what's on the map:
1. I go on the offense
2. I shut down
3. I leave the room`;
    expect(looksLikeStructuredOutputLeakage(reply)).toBe(false);
  });

  it("intro line followed by dashed list (colon is legit here)", () => {
    const reply = `Two things I want you to notice:
- what happened
- what surprised you`;
    expect(looksLikeStructuredOutputLeakage(reply)).toBe(false);
  });
});
