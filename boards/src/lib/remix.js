// remix.js — carry a "remix this public board" intent across the signup
// roundtrip. The /share & /c viewers stash the source (a share token or a
// published slug); the authenticated app clones it into a fresh board on the
// next load. Mirrors the PENDING_INVITE_KEY rails in AuthGate so it survives an
// OTP magic-link hop (new tab / cross-device) as well as same-tab signup.

const REMIX_KEY = 'soleil.boards.pending.remix';

// URL param <-> {kind:'token'|'slug'|'template', value}. Prefixed (t_/s_/g_) so
// a uuid-shaped slug can never be mistaken for a token — and so a grid-template
// token, which is also a uuid, can never be mistaken for a board share token.
//
// 'template' rides these same rails rather than getting its own because the
// valuable part here is not the encoding, it is stashRemix surviving the OTP
// magic-link hop (new tab, or a different device entirely). What it means to
// CONSUME one differs — a board remix clones a whole board, a template claim
// inserts one row — so the consumer branches; the transport does not.
export function encodeRemixParam({ kind, value } = {}) {
  if (!kind || !value) return '';
  const tag = kind === 'slug' ? 's' : kind === 'template' ? 'g' : 't';
  return `${tag}_${value}`;
}

export function parseRemixParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const i = raw.indexOf('_');
  if (i <= 0) return null;
  const tag = raw.slice(0, i);
  const value = raw.slice(i + 1);
  if (!value) return null;
  if (tag === 's') return { kind: 'slug', value };
  if (tag === 't') return { kind: 'token', value };
  if (tag === 'g') return { kind: 'template', value };
  return null;
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
