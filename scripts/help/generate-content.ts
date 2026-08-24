/**
 * Help System — Content Generator (Checkpoint B)
 *
 * For each manifest under scripts/help/manifests/, call Anthropic
 * Haiku (utilityModel) to produce plain-language help content grounded
 * in the extracted elements. Run the result through voice-lint and
 * write to help_content with reviewed=false. A human reviews at
 * /admin/help-content.
 *
 * Contract with the model:
 *   - Elements in the manifest are the ONLY concrete actions it may
 *     describe. It never invents an element that isn't in the list.
 *   - The route's purpose is pulled from PRODUCT_SPEC.md for framing.
 *   - The voice adaptation doc is loaded as a hard constraint.
 *   - Output is structured JSON matching HelpContentSchema.
 *
 * Usage:
 *   npm run help:generate                       (all manifests)
 *   npm run help:generate -- /today             (filter by route)
 *   npm run help:generate -- --dry-run          (print, don't write)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { generateObject } from "ai";
import { z } from "zod";
import { utilityModel } from "../../src/lib/model-config";
import { lintSections, type LintResult } from "./voice-lint";

const MANIFEST_DIR = path.join(process.cwd(), "scripts", "help", "manifests");
const VOICE_DOC = path.join(process.cwd(), "docs", "app-voice-adaptation.md");
const PRODUCT_SPEC = path.join(process.cwd(), "PRODUCT_SPEC.md");

// ---------------------------------------------------------------------------
// Types + schema
// ---------------------------------------------------------------------------

type Manifest = {
  route_pattern: string;
  view_key: string | null;
  role: "member" | "leader" | "admin" | "all";
  elements: Array<{ kind: string; label: string }>;
  source_hash: string;
  source_files: string[];
};

const HelpContentSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(80)
    .describe("Page title, 3-6 words, plain sentence case."),
  sections: z
    .array(
      z.object({
        what_its_for: z
          .string()
          .min(10)
          .max(240)
          .describe("One-sentence plain description of what this capability is for."),
        steps: z
          .array(z.string().min(3).max(240))
          .min(1)
          .max(8)
          .describe(
            "Ordered numbered steps to accomplish the capability. Use exact label text bolded, e.g. 'tap **Add**'.",
          ),
      }),
    )
    .min(1)
    .max(10),
});

type GeneratedHelp = z.infer<typeof HelpContentSchema>;

// ---------------------------------------------------------------------------
// PRODUCT_SPEC.md route purpose lookup
// ---------------------------------------------------------------------------

/**
 * Best-effort: scan PRODUCT_SPEC.md for a table row starting with
 * `| \`route_pattern\`` and pull the last cell as the purpose text.
 * If nothing matches, return null; the generator prompt then falls
 * back to element-only grounding.
 */
function findRoutePurpose(routePattern: string, spec: string): string | null {
  const lines = spec.split("\n");
  const escaped = routePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\|\\s*\`${escaped}(?:\\[[^\\]]+\\])?\`\\s*\\|`,
  );
  for (const line of lines) {
    if (pattern.test(line)) {
      // Table row cells split on |. First cell is path, second is
      // the file, then everything after is the purpose.
      const cells = line.split("|").map((c) => c.trim());
      if (cells.length >= 3) {
        // Purpose is typically the last non-empty cell.
        const purpose = cells[cells.length - 2];
        if (purpose && purpose.length > 20) return purpose;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function buildSystem(): string {
  const voiceDoc = fs.readFileSync(VOICE_DOC, "utf-8");
  return `You write in-app HELP content for the BRAVE MAN OS. Reference content, not a coach turn. Written for a man scanning the app who wants to know what a button does or how to complete a step. Plain, tight, useful.

Hard constraints:

1. GROUNDED. You may only describe capabilities that correspond to elements in the ELEMENT LIST below. If an element isn't listed, you cannot describe it. If the list is thin (five elements or fewer), your content is thin — that's honest.

2. LITERAL LABELS. When you reference an element, use its exact visible label wrapped in **bold**. Not paraphrases. "tap **Add**" — not "tap the add button". If a label is uppercase in the extract, keep it uppercase.

3. NO CONVERSATION. This is reference content. No "let's", no "welcome to", no "here's what you can do", no closing questions like "does that make sense?". Just: what it's for, then the steps.

4. VOICE RULES. Load and obey the voice adaptation guide below in full.

5. FORMAT. Structured JSON:
   - title: 3-6 words, plain sentence case, no ending punctuation
   - sections: ordered array; one entry per capability on the page
     - what_its_for: one plain sentence, present tense, second-person you-form ("Sets your active quarterly goal.")
     - steps: 1-8 numbered steps to perform the action. Each step is one sentence. Use exact bolded label text.

If the element list represents a display-only surface (mostly headers, no actionable elements), your content can be a single section explaining what the page shows and how to read it, with no steps — in that case return a section whose steps has one entry: the one instruction ("Scroll through the list to see your community's activity this week.").

===== VOICE RULES =====

${voiceDoc}

===== END VOICE RULES =====`;
}

function buildUserPrompt(m: Manifest, purpose: string | null): string {
  const roleLine =
    m.role === "all"
      ? "Audience: any signed-in user."
      : `Audience: ${m.role} role only.`;
  const viewLine = m.view_key
    ? `View: this content is served when the user's current view within the page is "${m.view_key}".`
    : "";
  const purposeLine = purpose
    ? `Page purpose (from PRODUCT_SPEC.md): ${purpose}`
    : "Page purpose: not documented in PRODUCT_SPEC.md; infer conservatively from the elements below.";

  const elementLines = m.elements
    .map((e, i) => `${i + 1}. [${e.kind}] "${e.label}"`)
    .join("\n");

  return `Route: ${m.route_pattern}
${viewLine}
${roleLine}

${purposeLine}

ELEMENT LIST (the only capabilities you may describe):
${elementLines || "(no interactive elements — display-only surface)"}

Produce the JSON now.`;
}

async function generate(m: Manifest, spec: string): Promise<GeneratedHelp> {
  const purpose = findRoutePurpose(m.route_pattern, spec);
  const { object } = await generateObject({
    model: utilityModel(),
    schema: HelpContentSchema,
    system: buildSystem(),
    prompt: buildUserPrompt(m, purpose),
    maxOutputTokens: 1500,
  });
  return object;
}

// ---------------------------------------------------------------------------
// DB write (raw fetch — same pattern as migrate-itc-participants.ts)
// ---------------------------------------------------------------------------

const REST_URL = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }
  return `${url}/rest/v1`;
})();
const SVC_KEY = (() => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  return key;
})();

async function upsertHelpContent(row: {
  route_pattern: string;
  view_key: string | null;
  role: string;
  title: string;
  sections: GeneratedHelp["sections"];
  source_hash: string;
  voice_lint_passed: boolean;
}): Promise<void> {
  // ON CONFLICT (route_pattern, view_key, role) — reset reviewed=false
  // on every regenerate; a reviewed row whose content is being
  // regenerated is now unreviewed until a human approves the new
  // version.
  const body = {
    ...row,
    reviewed: false,
    reviewed_by: null,
    reviewed_at: null,
    generated_at: new Date().toISOString(),
  };
  const res = await fetch(
    `${REST_URL}/help_content?on_conflict=route_pattern,view_key,role`,
    {
      method: "POST",
      headers: {
        apikey: SVC_KEY,
        Authorization: `Bearer ${SVC_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`upsert ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filter = args.find((a) => !a.startsWith("--")) ?? null;

  const spec = fs.readFileSync(PRODUCT_SPEC, "utf-8");
  const files = fs
    .readdirSync(MANIFEST_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(
    `[help:generate] ${files.length} manifests${
      filter ? ` (filter: ${filter})` : ""
    }${dryRun ? " · DRY RUN" : ""}`,
  );

  let generated = 0;
  let passed = 0;
  let failedLint = 0;
  const failures: string[] = [];

  for (const f of files) {
    const m = JSON.parse(
      fs.readFileSync(path.join(MANIFEST_DIR, f), "utf-8"),
    ) as Manifest;
    if (
      filter &&
      m.route_pattern !== filter &&
      !m.route_pattern.startsWith(filter)
    ) {
      continue;
    }

    process.stdout.write(
      `\n${m.route_pattern}${m.view_key ? ` · ${m.view_key}` : ""} [${
        m.role
      }] · ${m.elements.length} elements ... `,
    );

    let help: GeneratedHelp;
    try {
      help = await generate(m, spec);
    } catch (err) {
      console.log("FAILED");
      failures.push(
        `  ${f}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    const lint: LintResult = lintSections(help.sections);
    generated += 1;
    if (lint.passed) passed += 1;
    else failedLint += 1;

    console.log(
      lint.passed ? "ok" : `lint failed (${lint.hits.length} hits)`,
    );

    if (dryRun) {
      console.log("  title:", help.title);
      for (const s of help.sections) {
        console.log("  -", s.what_its_for);
        s.steps.forEach((st, i) => console.log(`    ${i + 1}. ${st}`));
      }
      if (!lint.passed) {
        for (const h of lint.hits.slice(0, 5)) {
          console.log(`  lint: ${h.rule} → "${h.match}"`);
        }
      }
      continue;
    }

    await upsertHelpContent({
      route_pattern: m.route_pattern,
      view_key: m.view_key,
      role: m.role,
      title: help.title,
      sections: help.sections,
      source_hash: m.source_hash,
      voice_lint_passed: lint.passed,
    });
  }

  console.log(
    `\n[help:generate] generated ${generated}, lint passed ${passed}, lint failed ${failedLint}`,
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const line of failures) console.log(line);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
