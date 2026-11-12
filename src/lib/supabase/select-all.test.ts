import { describe, expect, it } from "vitest";
import { PAGE_ROWS, selectAll } from "./select-all";

/** A fake table that, like the database API, returns at most PAGE_ROWS per request. */
function table(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ i }));
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + PAGE_ROWS)), error: null });
  };
  return { page, calls };
}

describe("selectAll", () => {
  it("gets every row past the 1,000-row cap", async () => {
    const t = table(2313);
    const { data, error } = await selectAll(t.page);
    expect(error).toBeNull();
    expect(data).toHaveLength(2313);
    expect(data.at(-1)).toEqual({ i: 2312 });
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more when the rows end exactly on a page", async () => {
    const t = table(2000);
    expect((await selectAll(t.page)).data).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  it("returns what it has and the error when a page fails", async () => {
    let n = 0;
    const res = await selectAll(() =>
      Promise.resolve(n++ === 0 ? { data: Array(PAGE_ROWS).fill({}), error: null } : { data: null, error: { message: "boom" } }),
    );
    expect(res.data).toHaveLength(PAGE_ROWS);
    expect(res.error?.message).toBe("boom");
  });
});
