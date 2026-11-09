// layoutOutlines — the consent half of "layout outlines".
//
// An outline is a drawing of plain boxes (where each card sits, how big, what
// kind), kept only for people who said yes. The answer lives in
// profiles.settings.layout_outlines = { ok, at }, written ONLY by the RPC
// set_layout_outlines (the server stamps `at`); a missing key means "not
// answered", which is NOT a yes. How often we ask lives beside it in
// settings.layout_outlines_asks = { n, last }, written by the client with
// updateOwnSettings (merge_profile_settings replaces a key whole, so always
// pass both fields).
//
// Pure helpers plus one RPC call, so the pacing rules are testable under node
// (supabase.js reads import.meta.env, so it is imported inside the one function
// that needs it).

// Where "Learn more" and "What's kept" lead.
export const LAYOUT_OUTLINES_DOC = '/docs/account/data-and-privacy#layout-outlines';

// Window event after any answer, so the ask hides and Settings follows.
export const LAYOUT_OUTLINES_EVENT = 'soleil:layout-outlines';

// At most this many asks, on different days.
export const MAX_ASKS = 3;

// Asks once the person has placed this many cards.
export const MIN_CARDS = 3;

// Failing 3 cards, the ask comes a day after sign-up, as it always did. The
// card count covers only workspaces the person made, so a teammate invited into
// someone else's workspace would otherwise never be asked.
export const MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

// The version of the words the person answered. 2 = the words that include the
// first-week note (migration 0882 stores it; a yes given under terms 1 is never
// linked).
export const LAYOUT_OUTLINES_TERMS = 2;

// true = said yes, false = said no, null = never answered.
export function layoutOutlinesAnswer(settings) {
  const ok = settings?.layout_outlines?.ok;
  return typeof ok === 'boolean' ? ok : null;
}

// The local calendar date, YYYY-MM-DD. The pacing is "different days" as the
// person lives them, so local rather than UTC.
export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function layoutOutlinesAsks(settings) {
  const a = settings?.layout_outlines_asks;
  const n = Number(a?.n);
  return {
    n: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    last: typeof a?.last === 'string' ? a.last : null,
  };
}

// Should the question be put to this person now? Not until they have placed
// MIN_CARDS cards or, failing that, the account is a day old. An unreadable
// count AND an unreadable age never asks (failing closed costs one ask, failing
// open asks someone with an empty cluster).
export function shouldAskLayoutOutlines({ settings, today, cards, accountCreatedAt, now = Date.now() } = {}) {
  if (layoutOutlinesAnswer(settings) !== null) return false;
  const { n, last } = layoutOutlinesAsks(settings);
  if (n >= MAX_ASKS) return false;
  if (last && last === today) return false;
  if (Number.isFinite(cards) && cards >= MIN_CARDS) return true;
  const born = accountCreatedAt ? new Date(accountCreatedAt).getTime() : NaN;
  const at = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(born) && Number.isFinite(at) && at - born >= MIN_ACCOUNT_AGE_MS;
}

// Record the answer. The supabase-js builder resolves with { data, error } and
// does not throw, so the error is read here and thrown for the caller. Never
// .catch() the builder itself.
export async function setLayoutOutlines(ok) {
  const { supabase } = await import('./supabase.js');
  const { data, error } = await supabase.rpc('set_layout_outlines', { p_ok: !!ok, p_terms: LAYOUT_OUTLINES_TERMS });
  if (error) throw error;
  try {
    window.dispatchEvent(new CustomEvent(LAYOUT_OUTLINES_EVENT, { detail: { ok: !!ok } }));
  } catch (_) { /* no window under node */ }
  return data;
}
