// feedbackContext — what an answer was given in, attached automatically and
// SHOWN to the person before it is sent.
//
// Every surface that asks people something — the return banner, "What's holding
// you back?", Send feedback — attaches the same small record: where they were,
// how much they had built, which plan, which device, which build. Without it a
// report of a broken drop on a phone reads exactly like one on a desktop, and an
// answer about price cannot be read against how far its author had got.
//
// Two rules:
//   1. Only the keys the server keeps. public._feedback_context (0348) drops
//      anything else, so FEEDBACK_CONTEXT_KEYS is its client twin, and
//      feedbackContract.test.mjs keeps the two lists identical.
//   2. Nothing anyone typed, ever. No card text, no search terms, and no query
//      string: the path is the pathname alone, because a query string can carry
//      a share token or an email address.
//
// Pure — the browser environment comes in as an argument (feedbackEnv.js reads
// it), so node can test every rule here.

export const FEEDBACK_CONTEXT_KEYS = Object.freeze([
  'surface', 'offer', 'via', 'method', 'trial_offered', 'dwell_ms',
  'cards', 'server_cards', 'cap', 'tier',
  'device', 'os', 'browser', 'build', 'path', 'board_id',
]);

// The server caps strings at 80 too; matching it means what the person is
// shown is exactly what is stored.
const MAX_STR = 80;

function scalar(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    return s ? s.slice(0, MAX_STR) : undefined;
  }
  return undefined;
}

// `input` is what the asking surface knows (offer, cards, …); `env` is the
// ambient record from feedbackEnv(). Input wins where both say something.
export function buildFeedbackContext(input = {}, env = {}) {
  const src = { ...(env || {}), ...(input || {}) };
  const out = {};
  for (const k of FEEDBACK_CONTEXT_KEYS) {
    let v = scalar(src[k]);
    if (k === 'path' && typeof v === 'string') v = v.split(/[?#]/)[0] || undefined;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const SURFACE_NAMES = Object.freeze({
  canvas: 'canvas', list: 'list view', doc: 'document', universe: 'home',
  tag: 'tag page', settings: 'settings', public: 'public page',
});
const TIER_NAMES = Object.freeze({ demo: 'Free', paid: 'Creator', admin: 'Admin' });

// The line printed under every ask — "canvas · 34 cards · Free · desktop" — so
// nothing is attached without the person seeing it. Shows what is there and
// skips what is not; an empty context prints nothing at all.
export function describeFeedbackContext(ctx = {}) {
  const parts = [];
  if (ctx.surface) parts.push(SURFACE_NAMES[ctx.surface] || ctx.surface);
  if (Number.isFinite(ctx.cards)) parts.push(`${ctx.cards} card${ctx.cards === 1 ? '' : 's'}`);
  if (ctx.tier) parts.push(TIER_NAMES[ctx.tier] || ctx.tier);
  if (ctx.device) parts.push(ctx.device);
  return parts.join(' · ');
}
