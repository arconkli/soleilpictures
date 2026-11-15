// adminReport.js — the heaviest admin reports go through one database function,
// admin_report, which keeps each result for 10 minutes and shares it between the
// owner's phone and computer. A manual refresh passes fresh to compute a new one.
// Until admin_report is live in the database the call falls back to the report's
// own function, and stays direct for the rest of the page's life. Pure and
// node-testable: the client is passed in.
//
//   const { data, error, at } = await adminReport(supabase, 'admin_tests_read', args, { fresh });

export const SHARED_REPORTS = Object.freeze([
  'admin_return_fixed_horizon',
  'admin_built_return',
  'admin_second_sitting',
  'admin_return_by_mode',
  'admin_activity_heatmap',
  'admin_sharing_overview',
  'admin_tests_read',
]);

let direct = false;

async function callDirect(client, fn, args) {
  try {
    const { data, error } = await client.rpc(fn, args);
    return { data: error ? null : (data ?? null), error: error || null, at: null };
  } catch (e) {
    return { data: null, error: e, at: null };
  }
}

export async function adminReport(client, fn, args = {}, { fresh = false } = {}) {
  if (direct || !SHARED_REPORTS.includes(fn)) return callDirect(client, fn, args);
  let res;
  try {
    res = await client.rpc('admin_report', { p_fn: fn, p_args: args ?? {}, p_fresh: !!fresh });
  } catch (e) {
    return { data: null, error: e, at: null };
  }
  const { data, error } = res;
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') {
      direct = true;
      return callDirect(client, fn, args);
    }
    return { data: null, error, at: null };
  }
  return {
    data: data && typeof data === 'object' && 'data' in data ? data.data : null,
    error: null,
    at: data?.at ?? null,
  };
}

export function _resetAdminReportForTests() { direct = false; }
