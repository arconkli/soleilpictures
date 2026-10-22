// The browser side of /api/clusters/* (worker-clusters.js): what the sidebar
// does to clusters that aren't open — move, copy, put back, remove.
//
// Every call answers { ok: true, ...body } or { ok: false, error, message,
// retry? }; nothing here throws, so a caller's toast can say what happened.
// `room_unavailable` (503, retry: true) means a cluster's room couldn't be
// reached and NOTHING was changed — safe to try again.

import { supabase } from './supabase.js';

async function sessionToken() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch (_) { return null; }
}

async function post(path, body) {
  const token = await sessionToken();
  if (!token) return { ok: false, error: 'unauthorized', message: 'Sign in again to move files.' };
  try {
    const res = await fetch(`/api/clusters/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...json } : { ok: false, status: res.status, ...json };
  } catch (e) {
    return { ok: false, error: 'network', message: 'No connection, so nothing moved.', retry: true };
  }
}

// { from, to, cardIds, mode: 'move'|'copy', at?: {x,y}, restore?: [{id,x,y,unplaced}] }
// → { moved, pairs, originals, kept } for a move, { copied, cards, skipped } for a copy.
export const moveFiles = (body) => post('move', body);
// { boardId, cards } → { cards: [{ id }] } — cards an Undo puts back.
export const appendCards = (body) => post('append', body);
// { boardId, cardIds } → { removed: [card, ...] }, whole, for the Undo.
export const removeCards = (body) => post('remove', body);
// { boardId, patches: [{ id, fields }] } → { updated } — only PATCHABLE fields.
export const patchCards = (body) => post('patch', body);

// The words a failed call leaves in a toast.
export function failureMessage(r, verb = 'move') {
  if (!r || r.ok) return '';
  if (r.error === 'limit_reached') return 'That would go past the card limit.';
  if (r.error === 'cross_workspace') return 'Files move between clusters in the same workspace.';
  if (r.error === 'forbidden') return 'You can’t edit that cluster.';
  if (r.error === 'room_unavailable') return `Couldn’t reach that cluster, so nothing was ${verb === 'remove' ? 'removed' : verb === 'copy' ? 'copied' : 'moved'}. Try again.`;
  return r.message || `Couldn’t ${verb} those files.`;
}
