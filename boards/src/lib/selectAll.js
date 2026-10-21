// selectAll — every row of a PostgREST select, a page at a time.
//
// PostgREST answers at most its row cap per request (1000 here) and says
// nothing when it stops there, so one select of a growing table quietly turns
// into a sample of it. This reads page after page until a short one. The page
// is well under the cap, so a short page always means the end.
//
// `build` returns a fresh query each time, ordered by a unique key: without a
// stable order, rows can repeat or go missing between pages.
export const SELECT_ALL_PAGE = 500;

export async function selectAll(build, pageSize = SELECT_ALL_PAGE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const r = await build().range(from, from + pageSize - 1);
    if (r.error) return { data: null, error: r.error };
    const page = r.data || [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
