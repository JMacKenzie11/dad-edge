/**
 * LIVE test: every case here calls the real model.
 *
 * That means it can fail for no reason, because the model words a
 * title slightly differently each run. It sat in the fast suite until
 * 2026-09-04 and flaked there, which is worse than it sounds: once a
 * fast suite cries wolf you stop believing it, and a real failure gets
 * shrugged off and re-run.
 *
 * It runs with `npm run test:itc:live` alongside the ITC regressions.
 * `npm run test:itc` excludes it so that suite stays deterministic:
 * if the fast one goes red, something is actually broken.
 */
import { describe, expect, it } from "vitest";
import { suggestConversationTitle } from "@/lib/coach/title";

/**
 * Coach conversation titles — voice regression guard.
 *
 * Titles show up in the sidebar and in bell notifications. If the
 * model drifts back to diagnostic framings ("Problem with my wife")
 * every man's sidebar starts reading like a clinical file. The
 * banned-prefix rules live in src/lib/coach/title.ts:22 and the
 * voice spec (docs/coach-voice-and-tone.md); this test exercises
 * the actual live call and asserts those rules hold against
 * high-temptation openings.
 *
 * Each scenario is a first message that would EASILY produce a banned
 * framing if the prompt weren't holding the line — venting, blaming,
 * naming the "problem". A regression here means the prompt lost its
 * grip and needs a tighter rule, not a per-title post-processor.
 */

const BANNED_PREFIXES = [
  "problem with",
  "issue with",
  "trouble with",
  "struggling with",
  "dealing with",
  "fighting with",
  "difficulty with",
  "stuck on",
  "chat about",
  "conversation about",
  "discussion of",
];

function startsWithBannedPrefix(title: string): string | null {
  const lower = title.toLowerCase().trim();
  for (const p of BANNED_PREFIXES) {
    if (lower.startsWith(p)) return p;
  }
  return null;
}

const VENT_OPENINGS: Array<{ label: string; message: string }> = [
  {
    label: "wife-blame vent",
    message:
      "My wife has been checked out for months. Every time I try to bring anything up she rolls her eyes and walks off. I don't know what to do anymore, I feel like I'm the only one trying.",
  },
  {
    label: "friend-conflict",
    message:
      "Had another blowup with Dave last night. Same thing as always — he says something cutting, I overreact, we don't talk for a week. I'm sick of it.",
  },
  {
    label: "work-frustration",
    message:
      "Work is a mess. My COO keeps undermining me in front of the team and I can feel my authority eroding by the day. I need to figure out how to handle this before I lose it.",
  },
  {
    label: "parenting-struggle",
    message:
      "My teenage son barely speaks to me. He grunts at dinner, disappears into his room, and treats every question like an interrogation. I miss him and I don't know how to reach him.",
  },
];

describe("suggestConversationTitle — voice compliance", () => {
  it.each(VENT_OPENINGS)(
    "does not use a banned diagnostic prefix — $label",
    async ({ message }) => {
      const title = await suggestConversationTitle({
        mode: "general",
        firstUserMessage: message,
      });

      const banned = startsWithBannedPrefix(title);
      expect(banned, `title used banned prefix "${banned}": ${title}`).toBeNull();

      // Structural rules from the prompt: no em-dashes, no emojis, no
      // exclamation, no ending punctuation. Cheap to check.
      expect(title, "title contained an em-dash").not.toMatch(/—/);
      expect(title, "title ended with punctuation").not.toMatch(/[.!?]$/);
      expect(title, "title contained a quote").not.toMatch(/["']/);
      // Rough emoji check — high Unicode planes cover pictographs.
      expect(title, "title contained an emoji").not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    },
  );

  it("returns the fallback title for an empty message (no LLM call)", async () => {
    const general = await suggestConversationTitle({
      mode: "general",
      firstUserMessage: "   ",
    });
    expect(general).toBe("New conversation");

    const mission = await suggestConversationTitle({
      mode: "mission",
      firstUserMessage: "",
    });
    expect(mission).toBe("New mission");
  });
});
