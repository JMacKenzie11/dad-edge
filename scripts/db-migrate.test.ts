import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listMigrationFiles, migrationVersion, outOfOrder, pendingMigrations } from "./db-migrate";

describe("db:migrate planning", () => {
  const files = listMigrationFiles(["20260101000002_b.sql", "README.md", "20260101000001_a.sql", "20260101000003_c.sql", "notes.sql"]);

  it("lists migration files in order and ignores everything else", () => {
    expect(files).toEqual(["20260101000001_a.sql", "20260101000002_b.sql", "20260101000003_c.sql"]);
  });

  it("pending is what the ledger doesn't have", () => {
    expect(pendingMigrations(files, new Set(["20260101000001_a"]))).toEqual(["20260101000002_b.sql", "20260101000003_c.sql"]);
    expect(pendingMigrations(files, new Set(files.map(migrationVersion)))).toEqual([]);
  });

  it("flags a pending file older than the newest applied one", () => {
    expect(outOfOrder(files, new Set(["20260101000001_a", "20260101000003_c"]))).toEqual(["20260101000002_b.sql"]);
  });

  it("keys the ledger by full file name, because this repo has two files with the same timestamp", () => {
    const real = listMigrationFiles(readdirSync(join(__dirname, "..", "supabase", "migrations")));
    const stamps = real.map((f) => f.slice(0, 14));
    expect(new Set(stamps).size).toBeLessThan(stamps.length);
    expect(new Set(real.map(migrationVersion)).size).toBe(real.length);
  });
});
