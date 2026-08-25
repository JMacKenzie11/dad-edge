import { z } from "zod";
import { generateObject } from "ai";
import { utilityModel } from "@/lib/model-config";
import type { Mode } from "@/lib/coach/prompts";

const SCHEMA = z.object({
  title: z.string().min(2).max(60),
});

/**
 * Suggest a 3–6 word title for a conversation based on its opening user
 * message. Cheap Haiku call. Falls back to a safe default on failure — a
 * missing title never blocks the coach reply.
 */
export async function suggestConversationTitle(opts: {
  mode: Mode;
  firstUserMessage: string;
}): Promise<string> {
  const trimmed = opts.firstUserMessage.trim().slice(0, 800);
  if (trimmed.length === 0) return defaultTitle(opts.mode);

  const system = `You title conversations in a men's coaching app. Given the first message a man sent, return a short label (3–6 words, plain sentence case, no quotes, no ending punctuation) that a busy man could scan later and remember what this thread was about.

Voice:
- POSITIVELY FRAMED. Frame the title as what he's working on or moving toward, NOT what's broken. "Strengthening my marriage" beats "Problem with my wife". "Reconnecting with Dave" beats "Fight with Dave". "Getting sharper at work" beats "Business struggles".
- OPPORTUNITY, not diagnosis. Even when the message is a vent, the title should read as forward-facing.
- BANNED prefixes/framings: "problem with", "issue with", "trouble with", "struggling with", "dealing with", "fighting with", "difficulty with", "stuck on".
- No fluff prefixes: no "chat about" / "conversation about" / "discussion of".
- Concrete over abstract: "Hard talk with my COO" beats "Business challenge".
- Never include his name or personally-identifying info.
- Never em-dashes (—). Never emojis. Never exclamation points.

Return JSON only.`;

  try {
    const { object } = await generateObject({
      model: utilityModel(),
      schema: SCHEMA,
      system,
      prompt: `Mode: ${opts.mode}\n\nFirst message:\n"""\n${trimmed}\n"""`,
      maxOutputTokens: 120,
    });
    const title = object.title.replace(/[.!?"']+$/g, "").trim();
    return title.length > 0 ? title : defaultTitle(opts.mode);
  } catch (err) {
    console.error("title suggestion failed", err);
    return defaultTitle(opts.mode);
  }
}

function defaultTitle(mode: Mode): string {
  return mode === "mission" ? "New mission" : "New conversation";
}
