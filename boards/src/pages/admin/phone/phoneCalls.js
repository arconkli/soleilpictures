// phoneCalls.js — every read the phone admin panel makes, in one table
// (phoneData.js makes them, behind lib/phoneCache.js). Pure: no React, no
// Supabase, so lib/phoneCalls.test.mjs can read it. Team left out and verified
// only everywhere the RPC takes those flags; every flag is passed explicitly
// because the RPCs' defaults differ (datamap-pages.md, "Cross-cutting").
//
// The first wave (kpi … moneyPeople) is the top of Today; the second (growth …
// emails) starts once the first has settled; the rest are read by the page
// that shows them.
//
// key           rpc(args)                                       read by
// ------------  ----------------------------------------------  --------------------------------------------
// kpi           admin_kpi_summary(7)                            home headline, six week rows, measure sheets
// weeks         admin_weekly_series(26)                         home lead chart, usual day, week-row sparks
// active        admin_active_now(5 min)                         home "In the app now"
// stats         admin_stats(verified)                           home $ a month (Money page)
// signups       admin_recent_signups(50)                        home Signups today, Newest (masked on screen)
// approvals     admin_public_board_submission_counts()          home Needs a look
// boards        showcase_waiting()                              home Needs a look
// errors        admin_error_groups(2 days, limit 5) [totals]    home Needs a look, Inside
// moneyPeople   admin_money_people() [counts only]              home Paying, Needs a look, Money page
// growth        admin_growth_series(26)                         home Got started, Growth page, measure sheets
// search        admin_page_search_daily(null, 90, 'web')        home Search, Search page   [json array]
// ret           admin_return_fixed_horizon(since 2026-08-17)    home Coming back, Growth + Sources   (slow)
// sharing       admin_sharing_overview(30) [no top_sharers]     home Sharing, Sharing page            (slow)
// lifetime      admin_lifetime_totals()                         home Inside, Growth page header
// acq30         admin_acquisition_breakdown(30)                 home Sources, Sources page
// heatmap       admin_activity_heatmap(30, New York)            home Usage, Growth page               (slow)
// emails        admin_email_stats(7)                            home Inside, Emails page
// retention     admin_retention_curve(30)                       Growth page "Opened the app again on day N"
// acq7          admin_acquisition_breakdown(7)                  Sources page
// aiReferrals   admin_ai_referrals(30)                          Search page "AI assistants" (no team filter)
// crawlers      admin_crawler_hits(30)                          Search page "AI assistants"           (slow)
// moneyPath     admin_money_path()                              Money page ladder and reasons         (slow)
// trial         admin_trial_funnel()                            Money page trial
// referrals     admin_referral_stats(30) [no top_referrers]     Sharing page invites line
// contacts      admin_team_contacts(200) [count of new]         nothing yet (Talk-to-us requests)
// problems      admin_error_groups(7 days, limit 20) [totals]   Problems page
//
// `pick` runs at fetch time, so what the phone never shows and every personal
// field (emails, user ids, names, raw error text) is dropped before it is
// cached or put in state. The newest-signups emails are the one exception: the
// home masks them on screen.
//
// The last visit's numbers are also kept in this browser (lib/adminSnapshot.js,
// under 'phone:<key>') so the panel paints at once. Only what `pick` left, and
// never a call marked `snap: false`:
//   signups      rows are people: emails and user ids
//   aiReferrals  rows carry landing paths, which can hold a link's token
// snapOf() also refuses anything that still holds a personal field, so a
// report that grows one later stops being kept instead of leaking it.
import { RETURN_SINCE } from '../../../lib/phonePanel.js';

export const FILTERS = { p_exclude_internal: true, p_verified_only: true };

/** Slow calls keep their value this long across automatic refreshes. */
export const SLOW_TTL = 30 * 60 * 1000;

const without = (...drop) => (d) => {
  if (!d || typeof d !== 'object') return d;
  const out = { ...d };
  for (const k of drop) delete out[k];
  return out;
};
const totalsOnly = (d) => (d && typeof d === 'object' ? { days: d.days, since: d.since, totals: d.totals } : d);

export const CALLS = {
  // ── first wave: today's calls ──────────────────────────────────────────
  kpi: { rpc: 'admin_kpi_summary', args: { p_days: 7, ...FILTERS } },
  weeks: { rpc: 'admin_weekly_series', args: { p_weeks: 26, ...FILTERS } },
  active: { rpc: 'admin_active_now', args: { p_window_minutes: 5, p_exclude_internal: true } },
  stats: { rpc: 'admin_stats', args: { p_verified_only: true } },
  signups: { rpc: 'admin_recent_signups', args: { p_limit: 50, ...FILTERS }, snap: false },
  approvals: { rpc: 'admin_public_board_submission_counts', args: {} },
  boards: { rpc: 'showcase_waiting', args: {} },
  // Totals come from every kept group, not the limited list.
  errors: {
    rpc: 'admin_error_groups',
    args: { p_days: 2, p_lens: 'problems', p_status: 'open', p_env: 'prod', p_kind: null, p_exclude_internal: true, p_limit: 5 },
    pick: totalsOnly,
  },

  // The top row's Paying. Counts only: the trials and cap_hits rows carry
  // emails and user ids.
  moneyPeople: {
    rpc: 'admin_money_people',
    args: { ...FILTERS },
    pick: (d) => (d && typeof d === 'object' ? {
      near_cap: d.near_cap,
      paid_plan: d.paid_plan,
      paying: d.paying,
      past_due: d.past_due,
      comped: d.comped,
      paid_ever: d.paid_ever,
      trial_count: Array.isArray(d.trials) ? d.trials.length : 0,
      cap_hits: { since: d.cap_hits?.since ?? null, people: Array.isArray(d.cap_hits?.rows) ? d.cap_hits.rows.length : 0 },
    } : d),
  },

  // ── second wave ────────────────────────────────────────────────────────
  growth: { rpc: 'admin_growth_series', args: { p_weeks: 26, ...FILTERS } },
  search: { rpc: 'admin_page_search_daily', args: { p_path: null, p_days: 90, p_search_type: 'web' } },
  ret: {
    rpc: 'admin_return_fixed_horizon',
    args: { p_since: RETURN_SINCE, p_horizon_days: 7, ...FILTERS },
    slow: true,
  },
  sharing: {
    rpc: 'admin_sharing_overview',
    args: { p_days: 30, p_exclude_internal: true },
    slow: true,
    pick: without('top_sharers'),
  },
  lifetime: { rpc: 'admin_lifetime_totals', args: { ...FILTERS } },
  acq30: { rpc: 'admin_acquisition_breakdown', args: { p_days: 30, ...FILTERS } },
  heatmap: {
    rpc: 'admin_activity_heatmap',
    args: { p_days: 30, p_tz: 'America/New_York', p_exclude_internal: true },
    slow: true,
  },
  emails: { rpc: 'admin_email_stats', args: { p_days: 7, p_exclude_internal: true, p_include_foreign: false } },

  // ── page calls ─────────────────────────────────────────────────────────
  retention: {
    rpc: 'admin_retention_curve',
    args: { p_window_days: 30, ...FILTERS, p_require_work: false },
  },
  acq7: { rpc: 'admin_acquisition_breakdown', args: { p_days: 7, ...FILTERS } },
  // No team or verified filter exists on either of these two.
  aiReferrals: { rpc: 'admin_ai_referrals', args: { p_days: 30 }, snap: false },
  crawlers: { rpc: 'admin_crawler_hits', args: { p_days: 30 }, slow: true },
  moneyPath: { rpc: 'admin_money_path', args: { ...FILTERS }, slow: true },
  trial: { rpc: 'admin_trial_funnel', args: { ...FILTERS } },
  referrals: {
    rpc: 'admin_referral_stats',
    args: { p_days: 30, ...FILTERS },
    pick: without('top_referrers'),
  },
  // Name, email, company and message never leave this function.
  contacts: {
    rpc: 'admin_team_contacts',
    args: { p_limit: 200 },
    pick: (rows) => ({ new: Array.isArray(rows) ? rows.filter((r) => r && r.status === 'new').length : 0 }),
  },
  problems: {
    rpc: 'admin_error_groups',
    args: { p_days: 7, p_lens: 'problems', p_status: 'open', p_env: 'prod', p_kind: null, p_exclude_internal: true, p_limit: 20 },
    pick: totalsOnly,
  },
};

export const FIRST = ['kpi', 'weeks', 'active', 'stats', 'signups', 'approvals', 'boards', 'errors', 'moneyPeople'];
export const SECOND = ['growth', 'search', 'ret', 'sharing', 'lifetime', 'acq30', 'heatmap', 'emails'];
export const PAGE_CALLS = {
  growth: ['kpi', 'growth', 'lifetime', 'heatmap', 'ret', 'retention'],
  search: ['search', 'aiReferrals', 'crawlers'],
  sources: ['acq30', 'acq7', 'ret'],
  money: ['stats', 'moneyPeople', 'moneyPath', 'trial'],
  sharing: ['sharing', 'referrals'],
  problems: ['problems'],
  emails: ['emails'],
};

/** The name a call's last-visit numbers are kept under (lib/adminSnapshot.js). */
export const snapName = (key) => 'phone:' + key;

// Field names that mean a person, or words a person wrote.
const PERSONAL = new Set([
  'email', 'user_id', 'name', 'full_name', 'display_name', 'company', 'phone', 'message', 'recipient_email',
]);
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** True when `data` holds a personal field anywhere, or a string shaped like an email address. */
export function holdsPersonal(data, depth = 0) {
  if (data == null) return false;
  if (typeof data === 'string') return EMAIL_LIKE.test(data);
  if (typeof data !== 'object') return false;
  if (depth > 12) return true;
  if (Array.isArray(data)) return data.some((v) => holdsPersonal(v, depth + 1));
  for (const k of Object.keys(data)) {
    if (PERSONAL.has(k) || holdsPersonal(data[k], depth + 1)) return true;
  }
  return false;
}

/**
 * What a call keeps from this visit for the next one: `data` as `pick` left
 * it, or undefined for nothing (an unknown or `snap: false` call, an empty
 * answer, or anything still holding a personal field).
 */
export function snapOf(key, data) {
  const call = CALLS[key];
  if (!call || call.snap === false || data == null) return undefined;
  return holdsPersonal(data) ? undefined : data;
}

/** The calls whose last-visit numbers are kept. */
export const SNAP_KEYS = Object.keys(CALLS).filter((k) => CALLS[k].snap !== false);
