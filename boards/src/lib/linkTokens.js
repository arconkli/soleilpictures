// linkTokens.js — a link's token never goes on an event.
//
// A share link (/share/<token>), a shared file (/f/<token>), a shared
// template (/t/<token>) and a draft's keep page (/keep/<token>, a cluster an
// AI made for someone without an account) open what they point at to anyone
// holding the token, so the token is a key, not a measurement. Events used to carry it anyway:
// the first- and latest-touch bags (share_token, and utm_campaign, which the
// link pages' sign-up links set to the token), landing_path and the row's own
// path, and a few events that passed it by hand. Nothing read it there — the
// sharer's credit reads profiles.first_source, which keeps it.
//
// buildRow runs every row through redactLinkTokens/redactLinkText, and the
// database does the same to every row on the way in (0474's triggers, with
// 0707's _redact_link_tokens), so a row from an older client is redacted too.
// The two must agree; linkTokens.test.mjs runs their proofs' samples through
// these.
//
// Pure — no imports — so it is node-testable and cheap to call on every row.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The token routes main.jsx serves: shareMatch, fileShareMatch, templateShareMatch, keepMatch.
const LINK_PATH = new RegExp(`(/(?:share|f|t|keep)/)${UUID}`, 'gi');
const ANY_UUID = new RegExp(UUID, 'gi');

const KEEP_PATH = new RegExp(`(/keep/)${UUID}`, 'gi');

export const LINK_TOKEN_KEYS = Object.freeze(['share_token', 'lt_share_token', 'file_token', 'lt_file_token']);
const CAMPAIGN_KEYS = new Set(['utm_campaign', 'lt_utm_campaign']);

// Every /share|f|t|keep/<uuid> in the text becomes /<route>/:token.
export function redactLinkText(s) {
  return typeof s === 'string' ? s.replace(LINK_PATH, '$1:token') : s;
}

// A draft's keep link is the one whose token isn't kept even in
// profiles.first_source: unlike a share link's it credits no one, and it opens
// the draft until someone keeps it. So the first-touch bag records the page
// as /keep/:token (analytics.js getFirstSource), and the channel reads that.
export function redactKeepLink(s) {
  return typeof s === 'string' ? s.replace(KEEP_PATH, '$1:token') : s;
}

// A copy of an event's props without a link token: the token keys dropped, a
// UUID in a campaign replaced, and every other top-level string's link paths
// redacted. Board ids and the other UUIDs that open nothing are left alone.
export function redactLinkTokens(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return props;
  const out = {};
  for (const k of Object.keys(props)) {
    if (LINK_TOKEN_KEYS.includes(k)) continue;
    const v = props[k];
    if (typeof v !== 'string') out[k] = v;
    else if (CAMPAIGN_KEYS.has(k)) out[k] = v.replace(ANY_UUID, ':token');
    else out[k] = redactLinkText(v);
  }
  return out;
}

// The query params that carry a token the app captures on landing: a share or
// file link's (shareReturn.js), a cluster or workspace invite link's (?join=,
// ?wsjoin=), an emailed invite's (?invite=), a remix source's, a shared file
// opened in the app (?shared=), and the resume link's single-use sign-in token
// (?rt=). linkTokens.test.mjs fails when a capture site reads a param that is
// neither here nor on its list of params that open nothing.
export const TOKEN_PARAMS = Object.freeze(['share_token', 'file_token', 'join', 'wsjoin', 'invite', 'remix', 'shared', 'rt']);

// True when an address carries a token — a link's own page (/share/, /f/, /t/, /keep/),
// the resume page, a token param above, or a token as the campaign (the link
// pages' sign-up links set it) — or /make, whose fragment is the board an AI
// wrote (MakePage.jsx), and the pixel reports an address's fragment too. Meta's pixel reports the full address of the
// page it runs on and the page before it, so it is not loaded when either one
// carries a token (index.html inlines this test) and fires no page view here.
export function urlCarriesLinkToken(loc) {
  try {
    const path = String(loc?.pathname || '');
    const search = String(loc?.search || '');
    return /^\/(?:share|f|t|keep)\/[0-9a-f]{8}-|^\/(?:resume|make)\/?$/i.test(path)
      || /[?&](?:share_token|file_token|join|wsjoin|invite|remix|shared|rt)=/i.test(search)
      || /[?&]utm_campaign=[^&#]*[0-9a-f]{8}-[0-9a-f]{4}-/i.test(search);
  } catch (_) {
    return false;
  }
}
