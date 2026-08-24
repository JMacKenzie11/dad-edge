/**
 * Help System — Route Extractor (Checkpoint A)
 *
 * Walks the App Router route tree and extracts, per route (and per
 * view / per role where applicable), the concrete interactive
 * elements on the page. Output is a JSON manifest that the
 * generation step (`generate-content.ts`) is allowed to describe;
 * anything not in a manifest can't be described in help content,
 * which is the whole guardrail against fabricated instructions.
 *
 * What we extract per element:
 *   - kind: 'button' | 'link' | 'field' | 'toggle' | 'select' | 'header'
 *   - label: visible text (JSX children as string, or the label /
 *     placeholder attribute for form inputs). Trimmed, whitespace-
 *     collapsed. Empty labels are dropped.
 *   - role hint: 'admin' | 'leader' | 'member' | undefined based on
 *     route group + guard-function calls in the page's imports.
 *
 * What we do NOT extract:
 *   - Dynamic labels built from state / props at runtime (the string
 *     literal isn't in the source, so we can't describe it truthfully).
 *   - Elements gated by client-side state we can't statically resolve.
 *
 * Role signal detection:
 *   - Route group determines the base role:
 *       (admin)  → admin
 *       (leader) → leader
 *       (app), /itc, /onboarding → member
 *   - Guard function calls override the base:
 *       requirePlatformAdmin() → admin
 *       requireLeader()        → leader
 *       requireAccess() / requireUser() → keep base
 *
 * ITC per-stage extraction:
 *   - The ITC canvas at /itc/[mapId] surfaces different capabilities
 *     depending on `map.current_stage`. Each Section component in
 *     map-canvas.tsx corresponds to a stage. We identify sections by
 *     their `title` prop and record their interactive descendants
 *     under a separate `view_key`, keyed by a slugified stage name.
 *
 * Output: writes `scripts/help/manifests/<sha>.json` for each
 * (route, view_key, role) tuple. The runtime widget doesn't read
 * these; the generation script does.
 *
 * Usage:
 *   npm run help:extract               (full extract, all routes)
 *   npm run help:extract -- /today     (single route filter)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import ts from "typescript";

const APP_ROOT = path.join(process.cwd(), "src", "app");
const MANIFEST_DIR = path.join(process.cwd(), "scripts", "help", "manifests");

type ExtractedElement = {
  kind: "button" | "link" | "field" | "toggle" | "select" | "header";
  label: string;
};

type Manifest = {
  route_pattern: string;
  view_key: string | null;
  role: "member" | "leader" | "admin" | "all";
  elements: ExtractedElement[];
  source_hash: string;
  source_files: string[];
};

// ---------------------------------------------------------------------------
// Route discovery
// ---------------------------------------------------------------------------

type RouteRecord = {
  // Filesystem directory containing page.tsx
  dir: string;
  // Next.js route pattern with dynamic segments normalized to [name]
  routePattern: string;
  // Base role from the containing route group
  baseRole: "member" | "leader" | "admin";
};

function discoverRoutes(): RouteRecord[] {
  const found: RouteRecord[] = [];
  walk(APP_ROOT, [], found);
  return found;
}

function walk(dir: string, segments: string[], found: RouteRecord[]): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const hasPage = entries.some(
    (e) => e === "page.tsx" || e === "page.ts" || e === "page.jsx",
  );
  if (hasPage) {
    const routePattern = "/" + segments.join("/") || "/";
    const baseRole = detectBaseRole(segments);
    found.push({
      dir,
      routePattern: routePattern === "//" ? "/" : routePattern,
      baseRole,
    });
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (!fs.statSync(full).isDirectory()) continue;
    // Route groups: (admin), (app), (leader) — don't add to the URL path
    if (entry.startsWith("(") && entry.endsWith(")")) {
      walk(full, segments, found);
      continue;
    }
    // Parallel/intercept routes and private folders — skip
    if (entry.startsWith("_") || entry.startsWith("@")) continue;
    // Dynamic segments: [foo] → [foo] (keep as-is for pattern)
    walk(full, [...segments, entry], found);
  }
}

function detectBaseRole(
  segments: string[],
): "member" | "leader" | "admin" {
  // segments here don't include the route-group parens — but the walk
  // traverses through (admin), (leader), (app). We infer from the
  // physical directory by walking up from the leaf, so re-check by
  // looking at the actual on-disk path. Simpler: check for known
  // top-level path prefixes.
  //
  // /itc/* → member (ITC coachees; admin-only ITC surfaces are under
  //          /itc/admin and we detect that below).
  if (segments[0] === "itc" && segments[1] === "admin") return "admin";
  if (segments[0] === "itc") return "member";
  if (segments[0] === "admin") return "admin";
  if (segments[0] === "leader") return "leader";
  return "member";
}

// ---------------------------------------------------------------------------
// Per-route extraction
// ---------------------------------------------------------------------------

function loadPageSource(dir: string): {
  filename: string;
  text: string;
} | null {
  for (const name of ["page.tsx", "page.ts", "page.jsx"]) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) {
      return { filename: full, text: fs.readFileSync(full, "utf-8") };
    }
  }
  return null;
}

/**
 * Also read directly-imported component files from the page's own
 * directory (co-located components — the common Next.js pattern).
 * Extraction is one file deep; deeper components are ignored for
 * now. That's a deliberate cap: farther-nested components are
 * usually generic UI (button, card) that don't add capability info.
 */
function loadColocatedSources(pageDir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(pageDir);
  for (const entry of entries) {
    if (entry === "page.tsx" || entry === "page.ts") continue;
    if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) continue;
    const full = path.join(pageDir, entry);
    if (fs.statSync(full).isFile()) {
      results.push(full);
    }
  }
  return results;
}

function detectRoleOverride(
  text: string,
  baseRole: "member" | "leader" | "admin",
): "member" | "leader" | "admin" {
  if (/\brequirePlatformAdmin\s*\(/.test(text)) return "admin";
  if (/\brequireLeader\s*\(/.test(text)) return "leader";
  return baseRole;
}

/**
 * Extract labels from JSX text nodes and label-like attributes.
 * Ignores dynamic {expr} content unless it's a string literal.
 */
function extractElements(sourceText: string): ExtractedElement[] {
  const sf = ts.createSourceFile(
    "extract.tsx",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: ExtractedElement[] = [];

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = getTagName(node);
      const attrs = getAttrs(node);
      const kind = classifyKind(tagName, attrs);
      if (kind) {
        const label = extractLabel(node, kind);
        if (label && label.length > 0 && label.length < 200) {
          out.push({ kind, label });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return dedupe(out);
}

function getTagName(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): string {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tagNode = opening.tagName;
  if (ts.isIdentifier(tagNode)) return tagNode.text;
  return tagNode.getText();
}

function getAttrs(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): Record<string, string | null> {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const attrs: Record<string, string | null> = {};
  for (const attr of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
    const name = attr.name.text;
    if (attr.initializer === undefined) {
      attrs[name] = "";
      continue;
    }
    if (ts.isStringLiteral(attr.initializer)) {
      attrs[name] = attr.initializer.text;
    } else if (
      ts.isJsxExpression(attr.initializer) &&
      attr.initializer.expression &&
      ts.isStringLiteral(attr.initializer.expression)
    ) {
      attrs[name] = attr.initializer.expression.text;
    } else {
      attrs[name] = null;
    }
  }
  return attrs;
}

function classifyKind(
  tag: string,
  attrs: Record<string, string | null>,
): ExtractedElement["kind"] | null {
  const t = tag.toLowerCase();
  if (t === "button" || tag === "SubmitButton") return "button";
  if (t === "a" || tag === "Link") return "link";
  if (t === "input") {
    const type = (attrs.type || "").toLowerCase();
    if (type === "checkbox" || type === "radio") return "toggle";
    if (type === "hidden" || type === "submit" || type === "button") {
      return null;
    }
    return "field";
  }
  if (t === "textarea") return "field";
  if (t === "select") return "select";
  if (t === "h1" || t === "h2") return "header";

  // Custom PascalCase components — infer from props + name.
  // Any component that takes a `label` prop with a string literal is
  // acting as a labelled interactive element. Name-based hints:
  //   *Button / *Btn → button
  //   *Toggle / *Switch / *Checkbox → toggle
  //   *Field / *Input / *Textarea / *Select → field
  // Fallback: if it has a placeholder or a label string prop, treat
  // as field. This catches ReflectionField, PillarToggle, and other
  // wrappers without a per-component allowlist.
  if (!/^[A-Z]/.test(tag)) return null;
  if (/(Button|Btn)$/.test(tag)) return "button";
  if (/(Toggle|Switch|Checkbox|Radio)$/.test(tag)) return "toggle";
  if (/(Field|Input|Textarea)$/.test(tag)) return "field";
  if (/Select$/.test(tag)) return "select";
  if (attrs["label"] || attrs["placeholder"]) return "field";
  return null;
}

function extractLabel(
  node: ts.JsxElement | ts.JsxSelfClosingElement,
  kind: ExtractedElement["kind"],
): string {
  // For inputs / selects, prefer the placeholder / aria-label / name.
  if (
    kind === "field" ||
    kind === "select" ||
    kind === "toggle"
  ) {
    const attrs = getAttrs(node);
    return (
      normalize(attrs["label"]) ||
      normalize(attrs["placeholder"]) ||
      normalize(attrs["aria-label"]) ||
      normalize(attrs["name"]) ||
      ""
    );
  }
  // SubmitButton uses `label` prop
  if (kind === "button") {
    const attrs = getAttrs(node);
    const labelProp = normalize(attrs["label"]);
    if (labelProp) return labelProp;
  }
  // For everything else, walk children and gather string content.
  if (ts.isJsxSelfClosingElement(node)) {
    return normalize(getAttrs(node)["aria-label"]) || "";
  }
  return collectJsxText(node);
}

function collectJsxText(node: ts.JsxElement): string {
  let out = "";
  for (const child of node.children) {
    if (ts.isJsxText(child)) {
      out += child.text;
    } else if (
      ts.isJsxExpression(child) &&
      child.expression &&
      ts.isStringLiteral(child.expression)
    ) {
      out += child.expression.text;
    } else if (ts.isJsxElement(child)) {
      out += " " + collectJsxText(child);
    }
    // JsxSelfClosingElement, dynamic {expr}: skipped
  }
  return normalize(out);
}

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

function dedupe(items: ExtractedElement[]): ExtractedElement[] {
  const seen = new Set<string>();
  const out: ExtractedElement[] = [];
  for (const el of items) {
    const key = `${el.kind}|${el.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(el);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ITC per-stage extraction (custom path)
// ---------------------------------------------------------------------------

const ITC_STAGES = [
  { key: "goal", title: "improvement goal" },
  { key: "behaviors", title: "doing / not-doing" },
  { key: "worries", title: "worry box" },
  { key: "commitments", title: "competing commitments" },
  { key: "assumptions", title: "big assumptions" },
  { key: "immune_system", title: "your immune system" },
  { key: "prioritize", title: "which assumption to test first" },
  { key: "test_design", title: "design the test" },
  { key: "test_running", title: "run the test" },
  { key: "results", title: "debrief the test" },
  { key: "done", title: "closing the map" },
];

/**
 * Walk the ITC map-canvas source and pull elements per-Section.
 * Each Section is identified by its `title` prop; we match the
 * title string case-insensitively against ITC_STAGES to derive the
 * view_key.
 *
 * Section children are usually child components (BehaviorsRow,
 * WorriesRow, PrioritizePicker, TestDesignForm, ResultsForm) — not
 * inline JSX. We recognize those tag names and pull elements from
 * their source files in the colocated set. One level of descent
 * only — the child components' own children (form-field, etc.) are
 * generic UI and don't add capability info.
 */
function extractItcStages(
  mapCanvasSource: string,
  colocatedFiles: string[],
): Map<string, ExtractedElement[]> {
  const perStage = new Map<string, ExtractedElement[]>();
  const sf = ts.createSourceFile(
    "map-canvas.tsx",
    mapCanvasSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  // Cache: PascalCase component name → extracted elements from
  // its source file (if we can find it in the colocated set).
  const childCache = new Map<string, ExtractedElement[]>();
  function elementsForComponent(componentName: string): ExtractedElement[] {
    if (childCache.has(componentName)) return childCache.get(componentName)!;
    // Component "BehaviorsRow" typically lives in "behaviors-row.tsx".
    const kebab = componentName
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
    const match = colocatedFiles.find((f) =>
      path.basename(f).toLowerCase().startsWith(`${kebab}.`),
    );
    let out: ExtractedElement[] = [];
    if (match) {
      try {
        out = extractElements(fs.readFileSync(match, "utf-8"));
      } catch {
        // ignore parse errors — extraction is best-effort
      }
    }
    childCache.set(componentName, out);
    return out;
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = getTagName(node);
      if (tag === "Section") {
        const attrs = getAttrs(node);
        const title = normalize(attrs["title"]).toLowerCase();
        const stage = ITC_STAGES.find((s) => title.includes(s.title));
        if (stage && ts.isJsxElement(node)) {
          // Inline JSX inside the Section (buttons, links, etc.)
          const inline = extractFromNode(node);
          // Any PascalCase child component tags — descend one level.
          const childComponents = collectChildComponentNames(node);
          const fromChildren = childComponents.flatMap((c) =>
            elementsForComponent(c),
          );
          const existing = perStage.get(stage.key) ?? [];
          perStage.set(
            stage.key,
            dedupe([...existing, ...inline, ...fromChildren]),
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return perStage;
}

function collectChildComponentNames(node: ts.JsxElement): string[] {
  const names: string[] = [];
  function visit(n: ts.Node): void {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = getTagName(n);
      // PascalCase = React component; lowercase = HTML element.
      if (/^[A-Z]/.test(tag) && tag !== "Section") {
        names.push(tag);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return Array.from(new Set(names));
}

function extractFromNode(node: ts.Node): ExtractedElement[] {
  const out: ExtractedElement[] = [];
  function visit(n: ts.Node): void {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = getTagName(n);
      const attrs = getAttrs(n);
      const kind = classifyKind(tag, attrs);
      if (kind) {
        const label = extractLabel(n, kind);
        if (label && label.length > 0 && label.length < 200) {
          out.push({ kind, label });
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return dedupe(out);
}

// ---------------------------------------------------------------------------
// Manifest assembly + write
// ---------------------------------------------------------------------------

function hashElements(els: ExtractedElement[]): string {
  const canonical = els
    .map((e) => `${e.kind}:${e.label}`)
    .sort()
    .join("\n");
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function writeManifest(m: Manifest): void {
  if (!fs.existsSync(MANIFEST_DIR)) {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  }
  const filename = manifestFilename(m);
  const full = path.join(MANIFEST_DIR, filename);
  fs.writeFileSync(full, JSON.stringify(m, null, 2) + "\n");
  console.log(
    `  wrote ${filename} (${m.elements.length} elements, hash ${m.source_hash})`,
  );
}

function manifestFilename(m: Manifest): string {
  const safe = (s: string | null) =>
    (s ?? "_").replace(/[^a-z0-9-]/gi, "_").replace(/^_+|_+$/g, "");
  const route = safe(m.route_pattern.replace(/^\//, "") || "root");
  const view = m.view_key ? `__${safe(m.view_key)}` : "";
  return `${route}${view}__${m.role}.json`;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function main(): void {
  const filter = process.argv[2] ?? null;
  console.log(`[help:extract] scanning ${APP_ROOT}`);
  if (filter) console.log(`[help:extract] filter: ${filter}`);
  const routes = discoverRoutes();
  console.log(`[help:extract] found ${routes.length} routes`);

  let wrote = 0;
  for (const r of routes) {
    if (filter && r.routePattern !== filter && !r.routePattern.startsWith(filter)) {
      continue;
    }
    const src = loadPageSource(r.dir);
    if (!src) continue;
    const colocated = loadColocatedSources(r.dir);
    // Parse each source file separately — concatenating them into
    // one TSX blob confuses the parser (duplicate imports, mixed
    // module boundaries) and drops most elements.
    const perFileTexts: { filename: string; text: string }[] = [
      { filename: src.filename, text: src.text },
      ...colocated.map((f) => ({
        filename: f,
        text: fs.readFileSync(f, "utf-8"),
      })),
    ];
    const roleSignalText = perFileTexts.map((f) => f.text).join("\n");
    const role = detectRoleOverride(roleSignalText, r.baseRole);
    const sourceFiles = [src.filename, ...colocated];

    console.log(`\n${r.routePattern}  [${role}]`);

    // ITC map canvas special case: per-stage extraction from
    // map-canvas.tsx PLUS the child components each Section renders
    // (behaviors-row.tsx, worries-row.tsx, etc.). Sections contain
    // component refs, not inline JSX, so we need to descend.
    if (r.routePattern === "/itc/[mapId]") {
      const mapCanvas = colocated.find((f) => f.endsWith("map-canvas.tsx"));
      if (mapCanvas) {
        const perStage = extractItcStages(
          fs.readFileSync(mapCanvas, "utf-8"),
          colocated,
        );
        for (const [stageKey, elements] of perStage.entries()) {
          const m: Manifest = {
            route_pattern: r.routePattern,
            view_key: stageKey,
            role: "member",
            elements,
            source_hash: hashElements(elements),
            source_files: sourceFiles,
          };
          writeManifest(m);
          wrote += 1;
        }
        continue;
      }
    }

    // Parse each file separately, merge elements, dedupe.
    let elements: ExtractedElement[] = [];
    for (const f of perFileTexts) {
      try {
        elements = elements.concat(extractElements(f.text));
      } catch (err) {
        console.warn(
          `  skipping ${path.basename(f.filename)}: ${
            err instanceof Error ? err.message : "parse error"
          }`,
        );
      }
    }
    elements = dedupe(elements);
    const m: Manifest = {
      route_pattern: r.routePattern,
      view_key: null,
      role,
      elements,
      source_hash: hashElements(elements),
      source_files: sourceFiles,
    };
    writeManifest(m);
    wrote += 1;
  }

  console.log(`\n[help:extract] wrote ${wrote} manifests to ${MANIFEST_DIR}`);
}

main();
