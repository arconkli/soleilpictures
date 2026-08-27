// remix.js — carry a "remix this public board" intent across the signup
// roundtrip. The /share & /c viewers stash the source (a share token or a
// published slug); the authenticated app clones it into a fresh board on the
// next load. Mirrors the PENDING_INVITE_KEY rails in AuthGate so it survives an
// OTP magic-link hop (new tab / cross-device) as well as same-tab signup.

const REMIX_KEY = 'soleil.boards.pending.remix';

// URL param <-> {kind, value}, one single-letter tag each, so a uuid-shaped slug
// can never be mistaken for a token — and so a grid-template token, which is
// also a uuid, can never be mistaken for a board share token.
//
//   t_  token     a board share token          → clone the board
//   s_  slug      a published /c/<slug> board   → clone the board
//   g_  template  a grid-template SHARE token   → copy one row into your library
//   p_  gallery   a PUBLISHED template's slug   → copy one row into your library
//   k_  curated   a /templates/<slug> page      → save that shipped shape
//
// Everything rides these same rails rather than getting its own because the
// valuable part is not the encoding, it is stashRemix surviving the OTP
// magic-link hop (new tab, or a different device entirely). What it means to
// CONSUME one differs — a board remix clones a whole board, a template claim
// inserts one row — so the consumer branches; the transport does not.
//
// Note g_ and p_ are BOTH grid templates and are deliberately distinct: a share
// token is private and unguessable, a gallery slug is public and readable, and
// they are claimed by different RPCs with different authorization. Collapsing
// them would mean guessing which one a value is.
// k_ resolves entirely in the bundle (gridTemplateIndex.js), so it is the one
// kind that needs no network call and works on a brand-new empty account.
const TAGS = { token: 't', slug: 's', template: 'g', gallery: 'p', curated: 'k' };
const KINDS = Object.fromEntries(Object.entries(TAGS).map(([k, t]) => [t, k]));

export function encodeRemixParam({ kind, value } = {}) {
  // An unknown kind returns '' rather than falling through to a default tag.
  // The old ternary defaulted to 't', so a typo'd kind minted a board-share
  // link that would fail much later, somewhere else.
  if (!kind || !value || !TAGS[kind]) return '';
  return `${TAGS[kind]}_${value}`;
}

export function parseRemixParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const i = raw.indexOf('_');
  if (i <= 0) return null;
  const tag = raw.slice(0, i);
  const value = raw.slice(i + 1);
  if (!value) return null;
  return KINDS[tag] ? { kind: KINDS[tag], value } : null;
}

export function stashRemix(src) {
  if (!src?.kind || !src?.value) return;
  try { localStorage.setItem(REMIX_KEY, JSON.stringify({ kind: src.kind, value: src.value })); } catch (_) {}
}

export function readRemix() {
  try {
    const raw = localStorage.getItem(REMIX_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o?.kind && o?.value) ? { kind: o.kind, value: o.value } : null;
  } catch (_) { return null; }
}

export function clearRemix() {
  try { localStorage.removeItem(REMIX_KEY); } catch (_) {}
}
