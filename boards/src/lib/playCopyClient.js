// Asking for, and finding, the playable copy of a video or audio file, and
// what a made one writes onto its card (lib/playCopy.js; the Worker's half is
// worker-playCopy.js). Photos' views ask through the same route
// (askConverter, lib/fileViewClient.js).
//
// Never throws: an answer it couldn't get is an empty one, and the player then
// says what it said before there were copies. The callers hand over getToken
// and the signer (lib/playCopyWork.js reads the session), which keeps this
// module free of the Supabase client and testable under node.

import { copyKeyFor, mediaKindOfKey } from './playCopy.js';

const PATH = '/api/media/copy/request';
// The Worker takes this many keys a request.
export const REQUEST_MAX_KEYS = 20;
// A route that is not there (a dev server with no Worker) or one failing for
// everybody (a 5xx, a 429) is not asked again for a minute.
const COOLDOWN_MS = 60_000;
let cooldownUntil = 0;

// The states a copy waits in; 'done' | 'skip' | 'failed' are where it ends.
export const WAITING_STATES = new Set(['queued', 'working']);

// { [key]: state } for the media originals among `keys` — {} when it couldn't
// ask (signed out, the cooldown, the network).
export function requestPlayCopies(keys, opts) {
  return askConverter([...new Set((keys || []).filter((k) => mediaKindOfKey(k)))].slice(0, REQUEST_MAX_KEYS), opts);
}

// The ask itself, for `list` (at most REQUEST_MAX_KEYS keys the converter
// takes): photos' views ask the same route (lib/fileViewClient.js), and share
// its cooldown.
export async function askConverter(list, {
  getToken = null, fetchImpl = (...a) => fetch(...a), now = () => Date.now(),
} = {}) {
  if (!list?.length || now() < cooldownUntil) return {};
  try {
    const token = getToken ? await getToken() : null;
    if (!token) return {};
    const r = await fetchImpl(PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ keys: list }),
    });
    const isJson = /application\/json/i.test(r.headers.get('content-type') || '');
    if (!isJson || r.status === 429 || r.status >= 500) cooldownUntil = now() + COOLDOWN_MS;
    const data = isJson ? await r.json().catch(() => null) : null;
    return r.ok && data?.states && typeof data.states === 'object' ? data.states : {};
  } catch (_) {
    return {};
  }
}

// The copy's key for an original's key, by the key's own kind (the
// converter's: an audio-only .mp4 still gets a .play.mp4).
export function copyKeyOf(key) {
  const kind = mediaKindOfKey(key);
  return kind ? copyKeyFor(key, kind) : null;
}

// 'r2:<copy key>' when this viewer can be handed the copy (it exists and they
// may read it), else null. `sign` is r2.js getSignedUrl.
export async function findPlayCopy(key, { sign = null, force = false } = {}) {
  const copy = copyKeyOf(key);
  if (!copy || !sign) return null;
  try {
    return (await sign(copy, { force })) ? `r2:${copy}` : null;
  } catch (_) {
    return null;
  }
}

const PLACEHOLDER_RATIO = 202 / 360;
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// What a finished copy writes onto its card (editors' backfill, silently).
// `row` is the card's media_copies row. playSrc is how every surface finds the
// copy without probing the original first; the poster, length and shape fill in
// only what the browser couldn't read at upload — a card someone resized keeps
// its size unless it is still the 16:9 placeholder an unreadable video gets.
// A row that isn't this card's file, or a copy not named after it, writes
// nothing: a card's playSrc is only ever its own src's copy.
export function copyCardPatch(card, row) {
  if (!card || !row || row.state !== 'done') return {};
  const key = typeof card.src === 'string' && card.src.startsWith('r2:') ? card.src.slice(3) : '';
  if (!key || (row.storage_path && row.storage_path !== key)) return {};
  if (!row.copy_path || row.copy_path !== copyKeyFor(key, mediaKindOfKey(key))) return {};
  const patch = {};
  if (card.playSrc !== `r2:${row.copy_path}`) patch.playSrc = `r2:${row.copy_path}`;
  if (row.poster_path && !card.poster && card.kind === 'video') patch.poster = `r2:${row.poster_path}`;
  const dur = num(row.duration_sec);
  if (dur > 0 && !(card.duration > 0)) patch.duration = Math.round(dur * 1000) / 1000;
  const w = num(row.copy_w);
  const h = num(row.copy_h);
  if (card.kind === 'video' && w > 0 && h > 0 && card.w > 0 && card.h > 0) {
    const placeholder = Math.abs(card.h / card.w - PLACEHOLDER_RATIO) < 0.01;
    const want = Math.max(80, Math.round(card.w * (h / w)));
    if (placeholder && Math.abs(want - card.h) > card.h * 0.02) patch.h = want;
  }
  return patch;
}

// Tests only.
export function _resetPlayCopyCooldown() { cooldownUntil = 0; }
