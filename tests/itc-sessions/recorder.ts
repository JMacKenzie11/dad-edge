/**
 * Record/replay wrapper for LanguageModel calls in persona tests.
 *
 * Two modes, controlled by ITC_LLM_MODE:
 *   record: proxy real doGenerate calls, save {key -> response} to a
 *           JSON fixture file under tests/itc-sessions/fixtures/
 *   replay: look up by key, return stored response; throw if missing
 *           (PR-time run — deterministic, no network, no API cost)
 *
 * Key is a SHA-256 of a normalized serialization of the params passed
 * to the underlying doGenerate call (system + messages + tools shape
 * + model settings). Same input hashes to same key so replays are
 * cache-hit deterministic.
 *
 * When ITC_LLM_MODE is unset (or set to anything else), the wrapper
 * is a no-op passthrough — production code path is untouched.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { LanguageModel, LanguageModelMiddleware } from "ai";
import { wrapLanguageModel } from "ai";

export type RecorderMode = "record" | "replay" | "off";

export function recorderMode(): RecorderMode {
  const raw = process.env.ITC_LLM_MODE?.trim().toLowerCase();
  if (raw === "record" || raw === "replay") return raw;
  return "off";
}

/**
 * Wrap a base LanguageModel with record/replay middleware bound to a
 * specific fixture file. Fixture file path is per-persona so different
 * personas can be recorded/replayed independently.
 *
 * In `off` mode, returns the base model untouched (zero overhead in
 * production).
 */
export function wrapForRecordReplay(
  model: LanguageModel,
  fixturePath: string,
): LanguageModel {
  const mode = recorderMode();
  if (mode === "off") return model;

  let fixtures = mode === "replay" ? loadFixtures(fixturePath) : loadFixtures(fixturePath);
  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async ({ doGenerate, params }) => {
      const key = keyForParams(params);
      if (mode === "replay") {
        const stored = fixtures[key];
        if (!stored) {
          throw new Error(
            `[recorder replay] no fixture for key ${key.slice(0, 16)}… ` +
              `in ${fixturePath}. Re-record with ITC_LLM_MODE=record ` +
              `npx vitest run <persona>. First ~200 chars of prompt: ` +
              summarizeParams(params),
          );
        }
        return stored as Awaited<ReturnType<typeof doGenerate>>;
      }
      // record mode
      const result = await doGenerate();
      fixtures = { ...fixtures, [key]: result };
      writeFixtures(fixturePath, fixtures);
      return result;
    },
  };
  return wrapLanguageModel({ model, middleware });
}

/**
 * Normalize params into a stable JSON string then SHA-256 hash it.
 * Volatile substrings (UUIDs, today's date, one-week-out date) are
 * replaced with placeholders before hashing so a recording from
 * yesterday against map A will replay today against map B without
 * cache miss. Different personas use different fixture files so
 * collisions from this normalization are scoped and low-risk.
 */
function keyForParams(params: unknown): string {
  const serialized = stableStringify(params);
  const normalized = normalizeVolatileSubstrings(serialized);
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Replace substrings that vary run-to-run (but don't change the
 * coach's semantic input) with fixed placeholder tokens. Keeps the
 * hash key stable across recording session and replay session.
 */
function normalizeVolatileSubstrings(s: string): string {
  return (
    s
      // UUID v4 (map ids, participant ids, message ids, proposal ids)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
      // ISO date YYYY-MM-DD (today's date + one-week horizon in dynamic
      // context block, plus target_date on any test the model sees)
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "DATE")
      // ISO timestamp fragments (created_at values that sometimes bleed
      // into system messages)
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "TIMESTAMP")
  );
}

/**
 * JSON.stringify with sorted object keys so key order doesn't churn
 * the hash. Numbers, strings, booleans, arrays pass through unchanged.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

function summarizeParams(params: unknown): string {
  try {
    const s = JSON.stringify(params);
    return s.slice(0, 200);
  } catch {
    return "(unserializable)";
  }
}

function loadFixtures(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(
      `[recorder] fixture file ${path} exists but is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function writeFixtures(
  path: string,
  data: Record<string, unknown>,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}
