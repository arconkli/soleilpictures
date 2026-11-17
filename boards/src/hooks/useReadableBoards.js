// useReadableBoards — can the reader open the clusters a thread's sent cards
// point at? One batched read of `boards` (id, deleted_at) under the reader's
// own RLS: a row that comes back with no deleted_at is readable; no row, or a
// trashed one, is not. Not useMessagesBoard: that only knows the current
// workspace, so a cluster from another workspace would look locked.
//
// Answers are cached for the session (module Map). Every card in a thread asks
// on mount, so the asks of one render pass coalesce into one request; an
// answer older than a minute is asked again when a thread opens, so a cluster
// shared since (or trashed since) is noticed. Unknown reads as readable: the
// locked state never flashes before the answer.

import { useEffect, useMemo, useReducer } from 'react';
import { supabase } from '../lib/supabase.js';

const STALE_MS = 60 * 1000;
const STALE_NO_MS = 5 * 1000; // a "can't open" is asked again soon: access may have just been given
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

const cache = new Map(); // boardId -> { ok: boolean, at: number }
const inflight = new Set();
const queue = new Set();
const listeners = new Set();
let timer = null;

function notify() { for (const fn of [...listeners]) fn(); }

async function run(ids) {
  try {
    const { data, error } = await supabase.from('boards').select('id, deleted_at').in('id', ids);
    if (error) return;
    const seen = new Map((data || []).map((r) => [r.id, r.deleted_at]));
    const at = Date.now();
    let changed = false;
    for (const id of ids) {
      const ok = seen.has(id) && seen.get(id) == null;
      if (cache.get(id)?.ok !== ok) changed = true;
      cache.set(id, { ok, at });
    }
    if (changed) notify();
  } catch (_) { /* unknown stays readable */ } finally {
    for (const id of ids) inflight.delete(id);
  }
}

function flush() {
  timer = null;
  const ids = [...queue];
  queue.clear();
  for (let i = 0; i < ids.length; i += CHUNK) run(ids.slice(i, i + CHUNK));
}

function ask(id) {
  if (!id || inflight.has(id) || queue.has(id)) return;
  if (!UUID.test(id)) { // never queried: one odd id would fail its whole batch
    if (cache.get(id)?.ok !== false) { cache.set(id, { ok: false, at: Date.now() }); notify(); }
    return;
  }
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.ok ? STALE_MS : STALE_NO_MS)) return;
  inflight.add(id);
  queue.add(id);
  if (!timer) timer = setTimeout(flush, 0);
}

// boardIds: the clusters the thread's sent things live in. Returns
// isReadable(boardId).
export function useReadableBoards(boardIds) {
  const [, bump] = useReducer((n) => (n + 1) | 0, 0);
  const key = (Array.isArray(boardIds) ? boardIds : []).filter(Boolean).join(',');
  const ids = useMemo(() => (key ? key.split(',') : []), [key]);
  useEffect(() => {
    listeners.add(bump);
    return () => { listeners.delete(bump); };
  }, []);
  useEffect(() => { ids.forEach(ask); }, [ids]);
  return (id) => cache.get(id)?.ok !== false;
}

// For tests and the QA harness.
export function resetReadableBoards() { cache.clear(); inflight.clear(); queue.clear(); }
