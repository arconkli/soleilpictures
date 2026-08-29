// shareAccess — reduce a board's live /share links to ONE answer: who can open
// this cluster?
//
// Why this exists: the share panel used to render the two link kinds as two
// independent sections with two create flows, because that is how they are
// stored. But "anonymous view-only link" and "sign-in-then-join-as-editor link"
// are not two features to a person deciding what to send someone — they are one
// question with two answers. The panel now asks it once, and this module is the
// derivation that lets it, so the mapping from rows to a mode is testable
// without React, Supabase or a rendered dialog.
//
// The house precedent is the reason it is a module and not four lines inside
// JSX: the near-cap warning lived as an inline equality test against a counter
// that moves in jumps, and fired twice in ninety days before anyone noticed.
//
// Pure and dependency-free — see the sibling .test.mjs.

// The three states the picker offers. 'view' leads because that is the measured
// demand: 29 of the first 32 links ever made on this product were view links.
export const ACCESS_MODES = ['view', 'edit', 'off'];

// Row kinds as stored by list_public_links. Rows written before 0189 predate
// the column, so an absent kind means 'view' everywhere it is read.
export const linkKind = (l) => ((l && l.kind) || 'view');

// A link is live iff it was never revoked and either never expires or expires
// in the future. Both halves matter: the panel lists links to Copy and Revoke,
// and offering either on a dead token is a lie the server then refuses.
export function activeLinks(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const t = Number(now);
  const at = Number.isFinite(t) ? t : Date.now();
  return rows.filter((l) => {
    if (!l || !l.token) return false;
    if (l.revoked_at) return false;
    if (!l.expires_at) return true;
    const exp = new Date(l.expires_at).getTime();
    // An unparseable expiry is NaN, and every comparison against NaN is false.
    // Treat it as expired rather than eternal — the safe direction for a
    // control whose whole job is saying who can get in.
    return Number.isFinite(exp) && exp > at;
  });
}

// Which live link would this user's Copy button hand out, in a given mode?
//
// For 'edit' that is deliberately restricted to invite links THIS user created:
// create_collab_link reuses per board+role+creator, so pressing Copy on someone
// else's link would hand out a token they can revoke out from under you, and
// the button would silently start pointing somewhere new when they did.
export function linkForMode(rows, mode, opts) {
  const { selfUserId = null, includeSubboards = true, now = Date.now() } = opts || {};
  const live = activeLinks(rows, now);
  if (mode === 'edit') {
    return live.find((l) => linkKind(l) === 'invite'
      && l.role === 'editor'
      && l.created_by === selfUserId) || null;
  }
  if (mode === 'view') {
    // Scope is part of a view link's identity — ensurePublicLink matches on it,
    // so a same-scope link is THIS board's link and a different-scope one is a
    // different link that happens to also be live.
    return live.find((l) => linkKind(l) === 'view'
      && !!l.include_subboards === !!includeSubboards) || null;
  }
  return null;
}

// The mode the panel should open on: what is already true, falling back to the
// common intent when nothing is true yet.
//
// 'edit' outranks 'view' when both are live because it is the stronger grant —
// the status line then names the view link as also live, so nothing is hidden.
// Nothing-live resolves to 'view' rather than 'off': 'off' is the accurate
// description of an unshared board, but it makes the panel open on the one
// state whose Copy button does nothing, for a control whose entire purpose is
// producing a link.
export function deriveAccessMode(rows, opts) {
  const { selfUserId = null, now = Date.now() } = opts || {};
  const live = activeLinks(rows, now);
  if (live.some((l) => linkKind(l) === 'invite' && l.created_by === selfUserId)) return 'edit';
  if (live.some((l) => linkKind(l) === 'view')) return 'view';
  return 'view';
}

// Live links the chosen mode does NOT hand out — a stale-scope view link, an
// invite link somebody else minted, the view link still sitting there after you
// switched to 'edit'. The panel names the count so switching the picker never
// implies the other link died. It hasn't; revoking is only ever explicit.
export function otherModeLinks(rows, mode, opts) {
  const live = activeLinks(rows, (opts || {}).now);
  const mine = linkForMode(rows, mode, opts);
  return live.filter((l) => l !== mine);
}
