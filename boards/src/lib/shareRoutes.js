// shareRoutes — the words the admin uses for sharing (the sharing insight).
//
// One vocabulary for the routes 0744's ledger files every share under, the
// outcomes it dates, and how an account was brought in, so the Users list, a
// profile's Sharing section and Analytics › Sharing say the same thing the
// same way. Text only: no React, no icons, so it is node-tested.

export const ROUTES = {
  view_link:      { label: 'View link',            short: 'view link' },
  edit_link:      { label: 'Edit link',            short: 'edit link' },
  email_invite:   { label: 'Emailed invitation',   short: 'emailed invitation' },
  direct_share:   { label: 'Shared directly',      short: 'shared directly' },
  workspace_link: { label: 'Workspace link',       short: 'workspace link' },
  workspace_add:  { label: 'Added to a workspace', short: 'added to a workspace' },
  file_share:     { label: 'File share',           short: 'file share' },
  explore:        { label: 'Explore',              short: 'on Explore' },
  referral_link:  { label: 'Referral link',        short: 'referral link' },
  team_invite:    { label: 'Team invitation',      short: 'team invitation' },
  team_link:      { label: 'Team link',            short: 'team link' },
};

// The order a cluster's routes are named in, and Analytics' ladders are laid.
export const ROUTE_ORDER = ['view_link', 'edit_link', 'email_invite', 'direct_share', 'workspace_link',
  'workspace_add', 'file_share', 'explore', 'referral_link', 'team_invite', 'team_link'];

export function routeLabel(route) {
  return ROUTES[route]?.label ?? (route ? String(route).replace(/_/g, ' ') : 'Unknown');
}

// The steps a share's outcomes climb, in order. Seen is devices, the rest are
// accounts.
export const LADDER = [
  { key: 'seen', label: 'Seen' },
  { key: 'signed_up', label: 'Signed up' },
  { key: 'made_something', label: 'Made something' },
  { key: 'got_in', label: 'Got in' },
  { key: 'co_creating', label: 'Co-creating' },
];

// Where nothing recorded them yet. Dates are UTC days; set at the promote that
// carries each capture fix (see the sharing insight's plan).
export const RECORDED_FROM = {
  workspace_add: '2026-10-28',
  remix: '2026-10-28',
  file_share_signup: '2026-10-28',
  link_kind: '2026-10-28',
};

// The Users list's Sharing filter and its sort (0746's p_sharing / 'reach').
export const SHARING_FILTERS = [
  { value: 'all', label: 'Sharing: all' },
  { value: 'shared', label: 'Shared something' },
  { value: 'brought', label: 'Brought people in' },
  { value: 'came', label: 'Came through a share' },
  { value: 'works_with', label: 'Works with others' },
];
export const REACH_SORT = { value: 'reach', label: 'Most people reached' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utc(iso) {
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "Oct 20", or "Oct 20, 2025" outside the current year.
export function shortDay(iso, now = new Date()) {
  const d = utc(iso);
  if (!d) return '';
  const y = d.getUTCFullYear();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${y !== now.getUTCFullYear() ? `, ${y}` : ''}`;
}

// "Oct 20", "Oct 16 – 19", "Sep 30 – Oct 2".
export function dayRange(from, to, now = new Date()) {
  const a = utc(from);
  const b = utc(to);
  if (!a) return b ? shortDay(to, now) : '';
  if (!b) return shortDay(from, now);
  const sameDay = a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  if (sameDay) return shortDay(from, now);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return `${shortDay(from, now)} – ${b.getUTCDate()}`;
  }
  return `${shortDay(from, now)} – ${shortDay(to, now)}`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

// A person as the admin names them: their name, else their address.
export function personLabel(p) {
  if (!p) return 'someone';
  return p.name || p.email || 'someone';
}

export function titleOf(o, kind = o?.kind) {
  const noun = kind === 'workspace' ? 'workspace' : kind === 'file' ? 'file' : 'cluster';
  if (!o) return `an unknown ${noun}`;
  if (o.deleted && !o.title) return `a deleted ${noun}`;
  const t = (o.title || '').trim();
  if (!t) return `an untitled ${noun}`;
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

// The line under a shared thing's title on a profile:
// "View link + edit link · copied 5× · Oct 16 – 19".
export function objectSub(o, now = new Date()) {
  const routes = Object.keys(o?.routes || {}).sort((a, b) => ROUTE_ORDER.indexOf(a) - ROUTE_ORDER.indexOf(b));
  const parts = [];
  if (routes.length) {
    const words = routes.map((r, i) => {
      const n = o.routes[r]?.shares || 0;
      const many = (r === 'email_invite' || r === 'direct_share' || r === 'file_share') && n > 1;
      const label = many ? `${n} × ${ROUTES[r]?.short ?? r}` : (ROUTES[r]?.short ?? r);
      return i === 0 ? label.charAt(0).toUpperCase() + label.slice(1) : label;
    });
    parts.push(words.join(' + '));
  }
  if (o?.copies > 0) parts.push(`copied ${o.copies}×`);
  if (o?.deleted) parts.push(`deleted`);
  const when = dayRange(o?.first_at, o?.last_at, now);
  if (when) parts.push(when);
  return parts.join(' · ');
}

// The five steps for one shared thing. Seen reads "—" where nothing it was
// shared through is a link anyone can open (an invitation, a direct share).
export function objectLadder(o) {
  const linked = Object.keys(o?.routes || {}).some((r) => r === 'view_link' || r === 'edit_link' || r === 'explore' || r === 'file_share');
  return LADDER.map((s) => {
    const n = Number(o?.[s.key] || 0);
    if (s.key === 'seen' && !linked && n === 0) return { ...s, n: '—', on: false };
    return { ...s, n, on: n > 0 && s.key !== 'seen' };
  });
}

// How someone was brought in, as a profile says it: { how, by, note }.
//   how   "through the view link to Pitch deck"
//   note  what to know about it ("the link no longer exists", ...)
export function broughtInWords(bi) {
  if (!bi || !bi.route) return null;
  const t = bi.via ? `“${titleOf(bi.via)}”` : null;
  const kindWord = bi.via?.kind === 'workspace' ? 'workspace' : bi.via?.kind === 'file' ? 'file' : 'cluster';
  const to = t ? ` to ${t}` : '';
  let how;
  switch (bi.route) {
    case 'view_link': how = `through the view link${to}`; break;
    case 'edit_link': how = `through the edit link${to}`; break;
    case 'explore': how = t ? `from ${t} on Explore` : 'from a page on Explore'; break;
    case 'referral_link': how = 'through a referral link'; break;
    case 'email_invite': how = `by an emailed invitation${to}`; break;
    case 'workspace_link': how = `through the workspace link${to}`; break;
    case 'workspace_add': how = t ? `added to ${t}` : 'added to a workspace'; break;
    case 'file_share': how = t ? `through the shared file ${t}` : 'through a shared file'; break;
    default: how = `by ${routeLabel(bi.route).toLowerCase()}${to}`;
  }
  const notes = [];
  if (bi.state === 'deleted') notes.push(bi.route === 'explore' ? 'that page no longer exists' : `that ${kindWord === 'file' ? 'share' : 'link'} no longer exists`);
  else if (bi.state === 'revoked') notes.push('since revoked');
  else if (bi.state === 'expired') notes.push('since expired');
  if (!bi.by) {
    notes.push(bi.route === 'workspace_add' || bi.evidence === 'not_recorded'
      ? 'who added them isn’t recorded'
      : 'who shared it isn’t known');
  }
  if (bi.evidence === 'matched_event') notes.push('matched by the adder’s share event');
  if (bi.same_share_brought > 1) notes.push(`it brought in ${plural(bi.same_share_brought - 1, 'other')}`);
  if (Array.isArray(bi.other_routes) && bi.other_routes.length) {
    notes.push(`also ${bi.other_routes.map((r) => ROUTES[r]?.short ?? r).join(', ')}`);
  }
  return { how, by: bi.by || null, note: notes.join(' · ') };
}

// One thing shared with this person, as the line under its title:
// "Emailed invitation from Sam · Oct 20 · invited".
const WITH_STATE = {
  member: 'in it', claimed: 'in it', joined: 'in it', live: '', pending: 'invited, not yet in',
  removed: 'since removed', revoked: 'since revoked', expired: 'since expired', deleted: 'since deleted',
};
export function withThemSub(w, now = new Date()) {
  let head = routeLabel(w?.route);
  if (w?.by) head += ` from ${personLabel(w.by)}`;
  else if (w?.recorded === false) head += ' · who added them isn’t recorded';
  const tail = withThemTail(w, now);
  return tail ? `${head} · ${tail}` : head;
}

// The same line after the route and who: "Oct 20 · invited, not yet in".
export function withThemTail(w, now = new Date()) {
  const parts = [];
  const when = shortDay(w?.at, now);
  if (when) parts.push(when);
  const st = WITH_STATE[w?.state];
  if (st) parts.push(st);
  return parts.join(' · ');
}

// The outcome words a person carries on a profile, most advanced last.
export function personFlags(p) {
  const out = [];
  if (p?.signed_up) out.push('signed up');
  if (p?.got_in) out.push('got in');
  if (p?.made_something) out.push('made something');
  if (p?.co_creating) out.push('co-creating');
  return out;
}

// Cards a person placed in what others shared with them (0748's
// admin_user_placements: one row per cluster in a workspace they don't own).
//   placedIn(list, { workspaceId })  every cluster in that workspace
//   placedIn(list, { clusterId })    that cluster and every cluster under it
// Returns { cards, clusters, lastAt }, or null while the read is missing.
export function placedIn(list, { workspaceId, clusterId } = {}) {
  if (!Array.isArray(list)) return null;
  let cards = 0;
  let clusters = 0;
  let lastAt = null;
  for (const p of list) {
    const hit = workspaceId ? p.workspace_id === workspaceId
      : clusterId ? (p.board_id === clusterId || (Array.isArray(p.ancestors) && p.ancestors.includes(clusterId)))
      : true;
    if (!hit) continue;
    cards += Number(p.placed || 0);
    clusters += 1;
    if (p.last_at && (!lastAt || p.last_at > lastAt)) lastAt = p.last_at;
  }
  return { cards, clusters, lastAt };
}
