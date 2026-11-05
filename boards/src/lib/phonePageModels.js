// phonePageModels.js — what the phone admin's Sources, Money, Sharing, Problems
// and Emails pages say, as pure functions of the RPCs' rows (see phoneData.js
// for the calls and datamap-pages.md §2-§6 for every field and caveat).
//
// Pure: no React, DOM, supabase or import.meta, so node --test can load it. Every
// number on those pages is made here; the JSX only places it. A missing value is
// a dash ('–' from formatCount, '—' in a table cell), never 0; a real 0 stays 0.
// Counts under SMALL_N (15) are shown as counts ("9 of 12"), never as percentages.
// Dates are UTC (the RPCs' weeks and days are).
//
// Exports
//   RETURN_SINCE                       '2026-08-17', the cohort floor phoneData.js passes to admin_return_fixed_horizon
//   sourcesWindow(acq, days, label)    null | { items, total, pctTotal, readout, empty, label, dek }
//   sourceReturn(ret, since?)          null | { items: [{key,label,n,returned,text,sub,frac}], caption, label }
//   moneyTiles({stats, moneyPeople, moneyPath})
//                                      { tiles: [{value,label,sub?}], comped, mrrNote }
//   moneyLadder(path)                  null | { steps: [{label,n}], dek, caption, label }
//   moneyReasons(path)                 null | { items, total, dek, caption, label }
//   trialModel(rows)                   null | { items: [{key,label,n}], dek, caption, label }
//   capModel(moneyPeople)              null | { parts, dek, caption, label }
//   shareTiles(sharing)                [{value,label,sub?}]
//   shareChart(sharing, now)           null | shareModel + { xl, readout }
//   shareRouteRows(sharing)            [{ key, label, shared, opened, signedUp }]  (strings; opened '—' for a route that can't have it)
//   inviteLine(referrals)              '' | 'Invitations sent in the last 30 days: 52, by 16 people. Of the 21 sent to someone without an account, 12 led to one. The table counts …'
//   problemsModel(problems)            null | { tiles, people, crash, crowd: {mode:'dots'|'split', dots?, parts?}|null, dek, caption, label }
//   emailName(template)                friendly name, else the id with underscores as spaces and a capital first letter
//   emailsModel(rows)                  null | { tiles, rows: [{key,name,sent,sentText,frac,line}], dek, caption }
import { formatCount, RETURN_SINCE } from './phonePanel.js';
import { SMALL_N } from './growthSeries.js';
import { shareModel } from './phoneInsights.js';
import { routeLabel, ROUTE_ORDER } from './shareRoutes.js';

export { RETURN_SINCE };
/** Dots drawn for "who was affected" before it turns into a split bar. */
export const CROWD_MAX = 100;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (v) => (v == null || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const nf = (v) => (num(v) == null ? '' : formatCount(v));
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${nf(n)} ${n === 1 ? one : many}`;
const sum = (a) => a.reduce((s, v) => s + (num(v) || 0), 0);
const arr = (v) => (Array.isArray(v) ? v : []);

// 'Aug 12' from an ISO date or timestamp, in UTC; '' when it isn't one.
function dayText(s) {
  const t = Date.parse(String(s ?? ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function dayTextLong(s) {
  const t = Date.parse(String(s ?? ''));
  return Number.isFinite(t) ? `${dayText(s)}, ${new Date(t).getUTCFullYear()}` : '';
}

// ── Sources ──────────────────────────────────────────────────────────────────

const SOURCE_RETURN_LABELS = {
  chatgpt: 'ChatGPT', share: 'Shared link', seo: 'SEO pages', google: 'Google', reddit: 'Reddit', direct: 'Direct', other: 'Other',
};

/**
 * Figure 1: the first source of each new person in a `days` window. `label` is
 * channelLabel. Under 15 signups the bars show counts only (pctTotal null).
 * @returns {null | {items:Array, total:number, pctTotal:number|null, readout:{value:string,label:string}, empty:string, label:string, dek:string}}
 */
export function sourcesWindow(acq, days, label = (t) => t) {
  if (!Array.isArray(acq)) return null;
  const rows = acq
    .filter((r) => r && num(r.signups) != null)
    .map((r) => ({ source: r.source, n: num(r.signups) }))
    .sort((a, b) => b.n - a.n || (String(a.source) < String(b.source) ? -1 : 1));
  const total = sum(rows.map((r) => r.n));
  const items = rows.slice(0, 7).map((r) => ({ key: String(r.source ?? ''), label: label(r.source) || 'Direct', n: r.n }));
  const rest = rows.slice(7);
  if (rest.length) items.push({ key: '_rest', label: `${rest.length} smaller sources`, n: sum(rest.map((r) => r.n)) });
  const win = `${days} days`;
  return {
    items,
    total,
    pctTotal: total >= SMALL_N ? total : null,
    readout: { value: nf(total), label: `${total === 1 ? 'signup' : 'signups'} in ${win}` },
    empty: `No one signed up in the last ${win}.`,
    label: total > 0 ? `Where ${nf(total)} signups came from in the last ${win}, the biggest sources first.` : '',
    dek: total >= SMALL_N ? 'Counted when they sign up. Share of all signups in the window.' : 'Counted when they sign up. Too few for percentages.',
  };
}

/**
 * Figure 2: who comes back, by source. `ret` is admin_return_fixed_horizon's rows;
 * only dim 'source:*' counts. Group size under 15: "9 of 12", otherwise the rate
 * with the size beside it. A group with nobody in it has a dash.
 */
export function sourceReturn(ret, since = RETURN_SINCE) {
  if (!Array.isArray(ret)) return null;
  const rows = ret
    .filter((r) => r && typeof r.dim === 'string' && r.dim.startsWith('source:'))
    .map((r) => {
      const key = r.dim.slice('source:'.length);
      return { key, label: SOURCE_RETURN_LABELS[key] || (key ? key.replace(/_/g, ' ') : 'Other'), n: num(r.n), returned: num(r.returned) };
    })
    .filter((r) => r.n != null)
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  if (!rows.length) return { items: [], caption: '', label: '' };
  const rate = (r) => (r.n > 0 && r.returned != null ? r.returned / r.n : null);
  // Like Growth's Figure 7: a group under SMALL_N shows a count and draws no
  // bar, and the bars are scaled to the groups big enough for a rate.
  const top = Math.max(0.0001, ...rows.filter((r) => r.n >= SMALL_N).map((r) => rate(r) ?? 0));
  const items = rows.map((r) => {
    const q = rate(r);
    let text = '–';
    let sub = '';
    if (q != null) {
      if (r.n >= SMALL_N) { text = pct(q); sub = `of ${nf(r.n)}`; } else { text = `${nf(r.returned)} of ${nf(r.n)}`; }
    }
    return { ...r, text, sub, frac: q == null || r.n < SMALL_N ? 0 : q / top };
  });
  const sinceText = dayTextLong(since);
  return {
    items,
    caption: `Opened the app again within 7 days of joining. A different group from Figure 1: people whose first visit is at least 7 days old${sinceText ? `, since ${sinceText}` : ''}, so the counts here are not signups. Under 15 people, counts.`,
    label: `Share of people who opened the app again within 7 days, by where they came from: ${items.map((i) => `${i.label} ${i.text}${i.sub ? ` ${i.sub}` : ''}`).join(', ')}.`,
  };
}

// ── Money ────────────────────────────────────────────────────────────────────

const dollars = (cents) => {
  const c = num(cents);
  return c == null ? '' : `$${Math.round(c / 100).toLocaleString('en-US')}`;
};

/**
 * The four tiles, the "paid features for free" line and the footnote on the $
 * figure (admin_stats' mrr_cents counts every active subscription, team included,
 * so it never claims "team left out"). Each tile is a dash until its call lands.
 */
export function moneyTiles({ stats, moneyPeople, moneyPath } = {}) {
  const mrr = dollars(stats?.mrr_cents);
  const paying = num(moneyPeople?.paying);
  const trials = num(moneyPeople?.trial_count);
  const failing = num(moneyPeople?.past_due);
  const first = dayText(moneyPath?.steps?.first_paid);
  const comped = num(moneyPeople?.comped);
  return {
    tiles: [
      { value: mrr || '–', label: 'a month' },
      { value: paying == null ? '–' : nf(paying), label: 'paying', sub: first ? `first paid ${first}` : '' },
      { value: trials == null ? '–' : nf(trials), label: 'on a trial' },
      { value: failing == null ? '–' : nf(failing), label: 'payments failing' },
    ],
    comped: comped != null && comped > 0 ? `${nf(comped)} more ${comped === 1 ? 'account has' : 'accounts have'} paid features for free.` : '',
    mrrNote: 'A month counts every active subscription, team accounts included.',
  };
}

const LADDER = [['saw', 'Saw an offer'], ['pressed', 'Pressed a plan button'], ['checkout', 'Opened checkout'], ['started', 'Started a plan or trial'], ['paid', 'Paid']];

/** Figure 1: the five nested steps of admin_money_path, as counts the Ladder turns into step rates at 15+. */
export function moneyLadder(path) {
  const s = path?.steps;
  if (!s || typeof s !== 'object') return null;
  const steps = LADDER.map(([k, label]) => ({ label, n: num(s[k]) })).filter((x) => x.n != null);
  if (!steps.length) return null;
  const since = dayText(path.since);
  return {
    steps,
    dek: 'Each step, as people who reached it.',
    caption: `${since ? `Everyone since ${since}. ` : ''}Under 15 people, a step shows counts, not a percentage.`,
    label: `From offer to paying: ${steps.map((x) => `${nf(x.n)} ${x.label.toLowerCase()}`).join(', ')}.`,
  };
}

// The same short answers the desktop Money view uses (lib/moneyView.js WHY_SHORT).
const WHY_SHORT = {
  enough_room: 'Enough room', price: 'The price', no_card: 'No card', unsure_value: 'Unsure it is worth it', just_trying: 'Just trying', other: 'Other',
};

/** Figure 2: why people said not yet. Under 15 answers: counts, no percentages. */
export function moneyReasons(path) {
  const r = path?.offer?.reasons;
  const choices = arr(r?.choices).filter((c) => c && num(c.n) != null);
  if (!r || !choices.length) return null;
  const items = choices
    .map((c) => ({ key: String(c.choice ?? c.label), label: WHY_SHORT[c.choice] || c.label || String(c.choice ?? 'Other'), n: num(c.n) }))
    .sort((a, b) => b.n - a.n);
  const answered = num(r.answered) ?? sum(items.map((i) => i.n));
  const offer = path.offer;
  const closed = num(offer?.outcomes?.dismiss?.people);
  const people = num(offer?.people);
  const times = num(offer?.times);
  const parts = [];
  const offerSince = dayText(offer?.since);
  if (people != null && times != null) {
    parts.push(`${offerSince ? `Since ${offerSince}, ` : ''}${plural(people, 'person', 'people')} saw an offer ${plural(times, 'time')}${closed != null ? `; ${nf(closed)} closed it` : ''}.`);
  }
  const since = dayText(r.since);
  parts.push(`Answers only exist since ${since || 'the question was added'}, a shorter window than the steps above.`);
  return {
    items,
    total: answered >= SMALL_N ? answered : null,
    dek: answered >= SMALL_N ? `${plural(answered, 'answer')}.` : `${plural(answered, 'answer')}, too few for percentages.`,
    caption: parts.join(' '),
    label: `Why people said not yet, ${plural(answered, 'answer')}: ${items.map((i) => `${i.label} ${i.n}`).join(', ')}.`,
  };
}

const TRIAL_STAGES = [[1, 'Could try it today'], [2, 'Asked for a trial'], [3, 'Started one'], [5, 'Went on to pay']];

/** Figure 3: admin_trial_funnel stages 1, 2, 3 and 5, as counts only (the stages are not nested). */
export function trialModel(rows) {
  if (!Array.isArray(rows)) return null;
  const items = [];
  for (const [order, label] of TRIAL_STAGES) {
    const row = rows.find((r) => r && num(r.sort_order) === order);
    const n = num(row?.people);
    if (n != null) items.push({ key: `s${order}`, label, n });
  }
  if (!items.length) return null;
  return {
    items,
    dek: 'From the offer to a finished trial.',
    caption: 'Counts, not steps: the first is only accounts that could start a trial today, the others are everyone who ever did, so a later number can be larger.',
    label: `The trial: ${items.map((i) => `${i.label} ${i.n}`).join(', ')}.`,
  };
}

/** Figure 4: of the free accounts near their card limit, how many were here in the last 7 days. */
export function capModel(moneyPeople) {
  const cap = moneyPeople?.near_cap;
  const people = num(cap?.people);
  const active = num(cap?.active_7d);
  if (people == null || active == null || active > people) return null;
  const hits = num(moneyPeople?.cap_hits?.people);
  const since = dayText(moneyPeople?.cap_hits?.since);
  const caption = [
    hits != null ? `${plural(hits, 'person', 'people')} ${hits === 1 ? 'has' : 'have'} hit the limit${since ? ` since ${since}` : ''}.` : '',
    `Bar: part of ${nf(people)} free accounts holding at least 80% of their card limit.`,
  ].filter(Boolean).join(' ');
  return {
    parts: [
      { label: 'here in the last 7 days', n: active, on: true },
      { label: 'not', n: people - active, on: false },
    ],
    dek: `${nf(active)} of ${nf(people)} people near it were here in the last 7 days.`,
    caption,
    label: 'Near the card limit',
  };
}

// ── Sharing ──────────────────────────────────────────────────────────────────

/** The five 30-day totals as four tiles (people sharing rides under the shares). */
export function shareTiles(sharing) {
  const t = sharing?.totals;
  if (!t || typeof t !== 'object') return [];
  const v = (x) => (num(x) == null ? '–' : nf(x));
  const sharers = num(t.sharers);
  return [
    { value: v(t.shares), label: 'shares', sub: sharers == null ? '' : `by ${plural(sharers, 'person', 'people')}` },
    { value: v(t.seen), label: 'devices opened a shared link' },
    { value: v(t.signed_up), label: 'signed up through a share' },
    { value: v(t.made_something), label: 'made something' },
  ];
}

const shortDate = (key) => dayText(`${String(key).slice(0, 10)}T00:00:00Z`);

/** Figure 1: signups from shares by week (shareModel's bars, with their x labels and readout). */
export function shareChart(sharing, now) {
  const m = shareModel(sharing, now);
  if (!m.bars.length) return null;
  const open = m.openCount;
  return {
    ...m,
    xl: m.bars.map((b, i) => ({ i, text: shortDate(b.key) })),
    readout: { value: open == null ? '–' : nf(open), label: 'this week so far' },
  };
}

// Routes a viewer can open (SharingView.jsx SEEN_ROUTES): every other route has no "opened" step.
const SEEN_ROUTES = new Set(['view_link', 'edit_link', 'explore', 'file_share', 'workspace_link', 'referral_link']);

/** Figure 2: one row per kind of share. Strings are the cells; a real 0 is '0', a step the route can't have is '—'. */
export function shareRouteRows(sharing) {
  const order = (r) => { const i = ROUTE_ORDER.indexOf(r); return i < 0 ? 99 : i; };
  return arr(sharing?.routes)
    .filter((r) => r && r.route)
    .map((r) => ({ r, shared: num(r.shared) }))
    .sort((a, b) => (b.shared ?? -1) - (a.shared ?? -1) || order(a.r.route) - order(b.r.route))
    .map(({ r }) => ({
      key: r.route,
      label: routeLabel(r.route),
      shared: num(r.shared) == null ? '—' : nf(r.shared),
      opened: !SEEN_ROUTES.has(r.route) ? '—' : num(r.seen) == null ? '—' : nf(r.seen),
      signedUp: num(r.signed_up) == null ? '—' : nf(r.signed_up),
    }));
}

/**
 * The invitations line under the table. It reads admin_referral_stats, which
 * counts invitations by when they were sent (sent_total = pending_signup, emailed
 * to someone without an account, + direct_grants, people with an account added
 * directly; signed_up = how many pending_signup invitations someone signed up
 * with). The table above counts signups by the share they came through, whenever
 * that share was sent, so the two numbers differ and the line says why.
 */
export function inviteLine(referrals) {
  const i = referrals?.invites;
  const sent = num(i?.sent_total);
  if (sent == null) return '';
  const by = num(i?.inviting_users);
  const pending = num(i?.pending_signup);
  const su = num(i?.signed_up);
  let line = `Invitations sent in the last 30 days: ${nf(sent)}${by != null ? `, by ${plural(by, 'person', 'people')}` : ''}.`;
  if (pending != null && su != null) {
    line += ` Of the ${nf(pending)} sent to someone without an account, ${nf(su)} led to one.`;
    line += ' The table counts signups by the share they came through, whenever it was sent.';
  }
  return line;
}

// ── Problems ─────────────────────────────────────────────────────────────────

/**
 * admin_error_groups' totals (7 days, open, production, team left out). The
 * RPC's "people" are browser sessions, so they are called browsers. Up to 100
 * browsers: one dot each, crash ones first; more: a split bar instead.
 */
export function problemsModel(problems) {
  const t = problems?.totals;
  if (!t || typeof t !== 'object') return null;
  const v = (x) => (num(x) == null ? '–' : nf(x));
  const days = num(problems.days) ?? 7;
  const people = num(t.people);
  const crash = num(t.crash_people);
  const newer = num(t.new);
  let crowd = null;
  let dek = '';
  if (people != null && crash != null && crash <= people) {
    dek = `${nf(crash)} of ${plural(people, 'browser')} hit a crash.`;
    if (people > CROWD_MAX) {
      crowd = { mode: 'split', parts: [{ label: 'hit a crash', n: crash, on: true }, { label: 'did not', n: people - crash, on: false }] };
    } else {
      crowd = { mode: 'dots', dots: Array.from({ length: people }, (_, i) => i < crash) };
    }
  } else if (people != null) {
    dek = `${plural(people, 'browser')} affected.`;
  }
  return {
    tiles: [
      { value: v(t.new), label: 'new problems', sub: 'first seen in the last 48 hours', tone: newer != null && newer > 0 ? 'bad' : undefined },
      { value: v(t.problems), label: 'open problems', sub: `seen in the last ${days} days` },
      { value: v(t.occurrences), label: 'times they happened' },
      { value: v(t.people), label: 'browsers affected' },
    ],
    people,
    crash,
    crowd,
    dek,
    caption: people != null && people > CROWD_MAX
      ? `A browser is one session, not one person. Last ${days} days, open problems. Bar: part of ${nf(people)} browsers.`
      : `One dot is one browser (a session, not a person), last ${days} days, open problems. Filled: hit a crash.`,
    label: people == null ? '' : `${crash == null ? '' : `${nf(crash)} of `}${plural(people, 'browser')}${crash == null ? ' affected' : ' hit a crash'}.`,
  };
}

// ── Emails ───────────────────────────────────────────────────────────────────

// The template ids send-transactional-email accepts (supabase/functions/_shared/email/templates.ts).
const EMAIL_NAMES = {
  waitlist_submitted: 'Waitlist confirmation',
  waitlist_accepted: 'Waitlist invitation',
  workspace_invite: 'Workspace invite',
  board_shared: 'Cluster shared',
  invite_accepted: 'Invite accepted',
  invite_reward: 'Invite reward',
  edit_request: 'Edit request',
  edit_granted: 'Edit access granted',
  pending_invite: 'Pending invite',
  team_invite: 'Team invite',
  mention_email: 'Mention',
  comment_reply_email: 'Comment reply',
  activate_nudge_1: 'Getting started, first nudge',
  activate_nudge_2: 'Getting started, second nudge',
  reengage_1: 'Win-back',
  welcome_board: 'Welcome',
  board_waiting: 'Cluster waiting',
  nudge_dormant_early: 'Early comeback nudge',
  whats_new: 'What’s new',
  product_update: 'Product update',
  schedule_update: 'Call sheet',
  share_activity: 'Share activity',
  file_shared: 'File shared',
  file_commented: 'File comment',
  ops_alert: 'Ops alert',
  trial_ending: 'Trial ending',
  // Stub rows the email webhook files for mail send-transactional-email didn't pre-log,
  // mostly the sign-in code mail (0175_email_tracking.sql ~line 90; header of 0212_email_sending_domain.sql).
  unknown: 'Sign-in codes and other untagged mail',
};

export function emailName(template) {
  const id = String(template ?? '').trim();
  if (!id) return 'Unknown';
  if (EMAIL_NAMES[id]) return EMAIL_NAMES[id];
  const t = id.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// What a template's opened column says. A rate needs 15 delivered; 0 opens is
// "no opens recorded" (the RPC cannot tell an ignored email from one without tracking).
function openedText(delivered, opened) {
  if (delivered == null || delivered <= 0) return '';
  if (opened == null) return '';
  if (opened === 0) return 'no opens recorded';
  return delivered >= SMALL_N ? `${pct(opened / delivered)} opened` : `${nf(opened)} of ${nf(delivered)} opened`;
}

/** admin_email_stats rows (7 days) as the tiles and one row per template. Rows of one template are added together. */
export function emailsModel(rows) {
  if (!Array.isArray(rows)) return null;
  const byId = new Map();
  for (const r of rows) {
    if (!r || !r.template) continue;
    const cur = byId.get(r.template) || { sent: 0, delivered: 0, opened: 0, bounced: 0, seen: { sent: false, delivered: false, opened: false, bounced: false } };
    for (const k of ['sent', 'delivered', 'opened', 'bounced']) {
      const x = num(r[k]);
      if (x != null) { cur[k] += x; cur.seen[k] = true; }
    }
    byId.set(r.template, cur);
  }
  const list = [...byId.entries()]
    .map(([id, c]) => ({ id, ...c }))
    .sort((a, b) => b.sent - a.sent || (a.id < b.id ? -1 : 1));
  const top = Math.max(1, ...list.map((c) => c.sent));
  const out = list.map((c) => {
    const delivered = c.seen.delivered ? c.delivered : null;
    const opened = c.seen.opened ? c.opened : null;
    const line = [
      delivered == null ? '' : `${nf(delivered)} delivered`,
      openedText(delivered, opened),
      c.seen.bounced ? `${nf(c.bounced)} bounced` : '',
    ].filter(Boolean).join(' · ');
    return {
      key: c.id,
      name: emailName(c.id),
      sent: c.sent,
      sentText: c.seen.sent ? nf(c.sent) : '–',
      frac: c.sent / top,
      line,
    };
  });
  const anySent = list.some((c) => c.seen.sent);
  const anyBounced = list.some((c) => c.seen.bounced);
  return {
    tiles: [
      { value: anySent ? nf(sum(list.map((c) => c.sent))) : '–', label: 'sent' },
      { value: anyBounced ? nf(sum(list.map((c) => c.bounced))) : '–', label: 'bounced' },
    ],
    rows: out,
    dek: out.length ? `${plural(out.length, 'kind')} of email.` : 'Nothing was sent.',
    caption: 'Last 7 days, team accounts left out. Opens are counted from delivered email; under 15 delivered shows counts, not percentages.',
  };
}
