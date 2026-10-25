import { supabase } from './supabase.js';
import { getSignedUrl } from './r2.js';
import { copyHint, extOfKey } from './playCopy.js';
import { copyCardPatch, findPlayCopy, requestPlayCopies, WAITING_STATES } from './playCopyClient.js';

// The play-copy hooks' work, loaded the first time one needs it. Most files
// play as they are, so the app's first download carries only the part that
// notices one didn't (hooks/usePlayCopy.js) and the editor's backfill's
// bookkeeping (hooks/usePlayCopyBackfill.js); finding a copy, asking for one,
// waiting on it and writing it onto cards arrive here (LAZY_IN_APP in
// scripts/bundleBudget.mjs keeps it out of the first download).

// The signed-in member's token for the Worker, or null.
export async function getSessionToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch (_) {
    return null;
  }
}

async function readCopyState(key) {
  try {
    const { data, error } = await supabase.from('media_copies').select('state').eq('storage_path', key).maybeSingle();
    return error ? null : (data?.state || null);
  } catch (_) {
    return null;
  }
}

// How often the record is read while the converter works: soon at first (a
// short clip takes seconds), then easing off; given up after an hour.
const pollDelay = (elapsedMs) => (elapsedMs < 60_000 ? 4000 : elapsedMs < 5 * 60_000 ? 10_000 : 30_000);
const POLL_GIVE_UP_MS = 60 * 60_000;

// One step of usePlayCopy's walk for `key`, from `phase` (looking, asking or
// preparing). `to(next)` moves the walk on; `run.off` turns true when the hook
// has left the step, and `run.timer` is the wait it clears then.
export function runPhase(phase, key, { copyBroken, to, run }) {
  const play = async () => {
    const copy = await findPlayCopy(key, { sign: getSignedUrl, force: true });
    return copy ? { phase: 'copy', copy, copyBroken: false } : null;
  };
  if (phase === 'looking') {
    findPlayCopy(key, { sign: getSignedUrl }).then((copy) => to(copy ? { phase: 'copy', copy } : { phase: 'asking' }));
    return;
  }
  if (phase === 'asking') {
    requestPlayCopies([key], { getToken: getSessionToken }).then(async (states) => {
      const state = states[key];
      if (WAITING_STATES.has(state)) return to({ phase: 'preparing' });
      // Made, and its object is there (the Worker checked): unless that is the
      // copy that just failed, play it.
      if (state === 'done' && !copyBroken) return to((await play()) || { phase: 'none' });
      return to({ phase: 'none' });
    });
    return;
  }
  const began = Date.now();
  const tick = async () => {
    const state = await readCopyState(key);
    if (run.off) return;
    if (state === 'done') {
      const next = await play();
      if (run.off) return;
      if (next) { to(next); return; }
    } else if (state === 'skip' || state === 'failed') {
      to({ phase: 'none' });
      return;
    }
    const elapsed = Date.now() - began;
    if (elapsed > POLL_GIVE_UP_MS) { to({ phase: 'none' }); return; }
    run.timer = setTimeout(tick, pollDelay(elapsed));
  };
  run.timer = setTimeout(tick, pollDelay(0));
}

const PASS_KEYS = 60;

// One pass of usePlayCopyBackfill over `targets`, the board's video and audio
// cards with no copy of their own yet. A finished copy is written onto every
// card that holds its file as the board is now (`cardsNow`, `write`); a file
// that may need one and was never asked about is asked about, `perPass` at
// most. `settled` and `asked` are the hook's, kept across passes. True while
// copies on this board are still to come, so the hook looks again.
export async function backfillPass({ targets, cardsNow, write, settled, asked, perPass, cancelled }) {
  const keys = [...new Set(targets.map((c) => c.src.slice(3)))].slice(0, PASS_KEYS);
  const { data, error } = await supabase.from('media_copies')
    .select('storage_path,state,copy_path,poster_path,copy_w,copy_h,duration_sec')
    .in('storage_path', keys);
  if (error || cancelled()) return false;
  let waiting = false;
  const rows = new Map((data || []).map((r) => [r.storage_path, r]));
  const toAsk = [];
  for (const key of keys) {
    const row = rows.get(key);
    if (row?.state === 'done') {
      for (const c of cardsNow() || []) {
        if (c.src !== `r2:${key}`) continue;
        const patch = copyCardPatch(c, row);
        if (Object.keys(patch).length) write(c.id, patch);
      }
      settled.add(key);
    } else if (row && WAITING_STATES.has(row.state)) {
      waiting = true;
    } else if (row) {
      settled.add(key);
    } else if (!asked.has(key)) {
      const card = targets.find((c) => c.src === `r2:${key}`);
      if (copyHint({ kind: card?.kind, ext: extOfKey(key), media: card?.media || null })) toAsk.push(key);
      else settled.add(key);
    }
  }
  const ask = toAsk.slice(0, perPass);
  if (ask.length && !cancelled()) {
    for (const k of ask) asked.add(k);
    const states = await requestPlayCopies(ask, { getToken: getSessionToken });
    if (Object.values(states).some((st) => WAITING_STATES.has(st) || st === 'done')) waiting = true;
  }
  return waiting || toAsk.length > ask.length;
}
