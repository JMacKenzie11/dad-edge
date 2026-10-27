/**
 * Coach Larry side-by-side. Runs every scenario in
 * tests/coach/fixtures/larry-scenarios.ts through the main coach's
 * system prompt as it stands in the working tree, and saves the replies
 * with a few checks on each. Run it on the old prompt and the new one,
 * then pass both files to --html to get a page to compare them.
 *
 * No database reads or writes: the fixtures are the whole context.
 *
 * Usage:
 *   npx tsx scripts/coach-larry-compare.ts run <label> <out.json>
 *   npx tsx scripts/coach-larry-compare.ts html <before.json> <after.json> <out.html>
 *
 * Needs ANTHROPIC_API_KEY, ANTHROPIC_MODEL, ANTHROPIC_UTILITY_MODEL in .env.local.
 */
import dotenv from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { isEntryPoint } from "./lib/entry";

const ReplySchema = z.object({
  reply: z.string().min(1).max(4000),
  mission_suggestion: z
    .object({
      description: z.string().min(1).max(280),
      pillar_code: z.enum(["B", "R", "A", "V", "E"]),
      target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      goal_number: z.number().int().nullable(),
    })
    .nullable(),
});

export type Checks = {
  words: number;
  questions: number;
  slang: string[];
  dashes: boolean;
  larryLife: string[];
};

const SLANG = /\b(freakin[g']?|frickin[g']?|friggin[g']?|dang|darn|damn|dammit|hell|crap|crappy|pissed|shit\w*|fuck\w*|ass|badass|sucks?)\b/gi;
const LARRY_LIFE = /\b(Jess(ica)?|Mason|Ethan|Lawson|Colton|Toby|my wife|my boys?|my sons?|my (oldest|youngest)|my marriage|my therapist)\b/gi;

export function checkReply(text: string): Checks {
  return {
    words: text.trim().split(/\s+/).filter(Boolean).length,
    questions: (text.match(/\?/g) ?? []).length,
    slang: [...new Set((text.match(SLANG) ?? []).map((s) => s.toLowerCase()))],
    dashes: /[—–]|\s-\s/.test(text),
    larryLife: [...new Set(text.match(LARRY_LIFE) ?? [])],
  };
}

type Result = { slug: string; headline: string; userMessage: string; reply: string; mission: string | null; checks: Checks; ms: number };
type RunFile = { label: string; promptVersion: string; ranAt: string; results: Result[] };

async function run(label: string, out: string) {
  dotenv.config({ path: ".env.local" });
  const { generateObject } = await import("ai");
  const { mainModel } = await import("../src/lib/model-config");
  const { systemBase, PROMPT_VERSION } = await import("../src/lib/coach/prompts");
  const { scrubCoachReply } = await import("../src/lib/coach/scrub-reply");
  const { LARRY_SCENARIOS } = await import("../tests/coach/fixtures/larry-scenarios");

  const render = (header: string, blocks: { label: string; text: string }[]) =>
    blocks.length ? `${header}\n\n${blocks.map((b) => `## ${b.label}\n${b.text}`).join("\n\n")}` : "";

  const results: Result[] = [];
  for (const s of LARRY_SCENARIOS) {
    const system = [
      `${systemBase(s.mode)}\n\n(prompt version: ${PROMPT_VERSION})`,
      render("# Live user context (stable)", s.cacheable),
      render("# Live user context (this turn)", s.volatile),
    ]
      .filter(Boolean)
      .join("\n\n");
    const started = Date.now();
    const { object } = await generateObject({
      model: mainModel(),
      schema: ReplySchema,
      system,
      messages: [...(s.history ?? []), { role: "user" as const, content: s.userMessage }],
      maxOutputTokens: 1600,
    });
    const reply = scrubCoachReply(object.reply);
    const m = object.mission_suggestion;
    results.push({
      slug: s.slug,
      headline: s.headline,
      userMessage: s.userMessage,
      reply,
      mission: m ? `${m.pillar_code} · ${m.target_date} · ${m.description}` : null,
      checks: checkReply(reply),
      ms: Date.now() - started,
    });
    console.log(`${s.slug.padEnd(22)} ${results.at(-1)!.checks.words}w ${results.at(-1)!.checks.questions}?`);
  }
  const file: RunFile = { label, promptVersion: PROMPT_VERSION, ranAt: new Date().toISOString(), results };
  writeFileSync(out, JSON.stringify(file, null, 2));
  console.log(`wrote ${out}`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function checkLine(c: Checks): string {
  const bits = [`${c.words} words`, `${c.questions} question${c.questions === 1 ? "" : "s"}`];
  if (c.slang.length) bits.push(`<span class="bad">slang: ${esc(c.slang.join(", "))}</span>`);
  if (c.dashes) bits.push(`<span class="bad">dash</span>`);
  if (c.larryLife.length) bits.push(`<span class="note">his own life: ${esc(c.larryLife.join(", "))}</span>`);
  return bits.join(" · ");
}

function html(beforePath: string, afterPath: string, out: string) {
  const a = JSON.parse(readFileSync(beforePath, "utf8")) as RunFile;
  const b = JSON.parse(readFileSync(afterPath, "utf8")) as RunFile;
  const rows = a.results
    .map((ra) => {
      const rb = b.results.find((r) => r.slug === ra.slug);
      const col = (r: Result | undefined) =>
        r
          ? `<div class="reply">${esc(r.reply).replace(/\n/g, "<br>")}</div>${r.mission ? `<p class="mission">Mission suggested: ${esc(r.mission)}</p>` : ""}<p class="checks">${checkLine(r.checks)}</p>`
          : "<p>(missing)</p>";
      return `<section><h2>${esc(ra.headline)}</h2><p class="member"><b>Member:</b> ${esc(ra.userMessage)}</p><div class="cols"><div class="col"><h3>${esc(a.label)}</h3>${col(ra)}</div><div class="col after"><h3>${esc(b.label)}</h3>${col(rb)}</div></div></section>`;
    })
    .join("\n");
  const page = `<title>Coach Larry Comparison</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Sans+3:wght@400;600&display=swap">
<style>
/* Layout: one card per situation, the member's message on top, the two coaches' replies as text bubbles side by side. */
:root{--bg:#f4f5f2;--card:#ffffff;--text:#1c1f1a;--muted:#5f665c;--border:#dde1d8;--old:#e9ebe6;--larry:#1f4f8f;--larry-soft:#e6eef8;--bad:#a8261b;--note:#7a5a00;
--display:"Archivo",system-ui,sans-serif;--body:"Source Sans 3",system-ui,sans-serif}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#131512;--card:#1b1e1a;--text:#e9ece6;--muted:#a3aa9f;--border:#30352e;--old:#262a25;--larry:#8db6ee;--larry-soft:#1c2a3d;--bad:#ff8b80;--note:#e3c35a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#131512;--card:#1b1e1a;--text:#e9ece6;--muted:#a3aa9f;--border:#30352e;--old:#262a25;--larry:#8db6ee;--larry-soft:#1c2a3d;--bad:#ff8b80;--note:#e3c35a;color-scheme:dark}
body{background:var(--bg);color:var(--text);font:17px/1.55 var(--body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 64px}
main{max-width:1120px;margin:0 auto;display:grid;gap:18px}
header h1{font:800 clamp(1.6rem,4vw,2.3rem)/1.1 var(--display);margin:0 0 8px;text-wrap:balance}
header p{color:var(--muted);margin:0;max-width:70ch}
section{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:18px;display:grid;gap:12px}
h2{font:700 1.05rem/1.3 var(--display);margin:0;text-wrap:balance}
.member{margin:0;color:var(--muted)}.member b{color:var(--text)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media (max-width:760px){.cols{grid-template-columns:1fr}}
.col{min-width:0;display:grid;gap:8px;align-content:start}
h3{font:700 .72rem/1 var(--display);letter-spacing:.1em;text-transform:uppercase;margin:0;color:var(--muted)}
.col.after h3{color:var(--larry)}
.reply{background:var(--old);border-radius:14px 14px 14px 4px;padding:12px 14px}
.col.after .reply{background:var(--larry-soft)}
.checks,.mission{font-size:.85rem;color:var(--muted);margin:0}
.bad{color:var(--bad);font-weight:600}.note{color:var(--note);font-weight:600}
</style>
<main>
<header><h1>Coach Larry: before and after</h1>
<p>The same ${a.results.length} situations and the same made-up member: Ryan, wife Kate, kids Jake and Lily. On the left is ${esc(a.label)} (${esc(a.promptVersion)}). On the right is ${esc(b.label)} (${esc(b.promptVersion)}). Most situations are the member's first message, and the last four come later in a conversation. Under each reply you'll see its length, how many questions it asks, any slang or dashes, and any mention of Larry's own life.</p></header>
${rows}
</main>`;
  writeFileSync(out, page);
  console.log(`wrote ${out}`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (cmd === "run" && args.length === 2) return run(args[0], args[1]);
  if (cmd === "html" && args.length === 3) return html(args[0], args[1], args[2]);
  console.error("Usage: run <label> <out.json> | html <before.json> <after.json> <out.html>");
  process.exit(1);
}

if (isEntryPoint(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
