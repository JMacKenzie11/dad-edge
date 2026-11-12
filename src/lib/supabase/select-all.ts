/**
 * Every row a query matches, a page at a time.
 *
 * The database API hands back at most 1,000 rows per request and says
 * nothing when it stops there. A read across a whole community (90 days
 * of check-ins for 30 men is over 2,000 rows) silently got the first
 * 1,000 in no set order, so the Coaching page showed men who check in
 * daily as "No check-in for 9 days" (docs/failure-modes.md FM-18).
 *
 * `page(from, to)` builds the query and ends with `.range(from, to)`.
 * It must order by columns that make each row's place unique, or rows
 * can repeat or go missing between pages. Source guard: any read of
 * daily_checkins or missions filtered to a list of men goes through here
 * (src/source-guards.test.ts).
 */
export const PAGE_ROWS = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function selectAll<T>(
  page: (from: number, to: number) => Page<T>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return { data: rows, error: null };
  }
}
