// PostgREST caps a single .select() at db-max-rows (1000 by default on
// Supabase) with no error — just a silently truncated result. Any table
// that can plausibly grow past that (recipe_tags now sits at several
// thousand rows once book tags are included) needs to page through with
// .range() instead of a bare .select(). Pass a callback so the caller can
// still attach its own filters/order — this only owns the pagination.
const PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}
