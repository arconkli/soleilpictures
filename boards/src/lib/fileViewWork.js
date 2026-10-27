import { supabase } from './supabase.js';
import { getMeta, setMetaLocal } from './imageMeta.js';
import { viewKindOfKey, viewKeyOfCard } from './fileView.js';
import {
  requestFileViews, viewMeta, viewCardPatch, viewFileCardPatch, viewSize, VIEW_COLS, REQUEST_MAX_KEYS,
} from './fileViewClient.js';
import { WAITING_STATES } from './playCopyClient.js';

// Photos' views, the work loaded the first time one is needed: a picture the
// browser couldn't draw waiting on its view (components/R2Image.jsx), and the
// editors' pass over a board (hooks/useFileViewBackfill.js). LAZY_IN_APP in
// scripts/bundleBudget.mjs keeps it out of the app's first download.

async function sessionToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch (_) {
    return null;
  }
}

// A finished view, into the image meta every surface reads its previews from:
// R2Image switches to it as the meta's subscribers hear of it.
function applyView(row) {
  const meta = viewMeta(row);
  if (meta) setMetaLocal(row.storage_path, meta);
  return !!meta;
}

const META_COLS = 'storage_path,preview_path,preview_w,preview_h,preview_sm_path,preview_sm_w,preview_sm_h,width,height';

// A file a browser made a preview of since its meta was read ('has_preview'):
// read the preview in. True when one is there.
async function refreshMeta(key) {
  try {
    const { data, error } = await supabase.from('images').select(META_COLS).eq('storage_path', key).maybeSingle();
    if (error || !data?.preview_path) return false;
    setMetaLocal(key, {
      previewKey: data.preview_path, previewW: data.preview_w ?? null, previewH: data.preview_h ?? null,
      previewSmKey: data.preview_sm_path || null, previewSmW: data.preview_sm_w ?? null, previewSmH: data.preview_sm_h ?? null,
      ...(data.width > 0 && data.height > 0 ? { w: data.width, h: data.height } : {}),
      checked: true,
    });
    return true;
  } catch (_) {
    return false;
  }
}

// ── One picture waiting on its view ───────────────────────────────────────
//
// Every picture of a file the browser couldn't draw, on every surface, waits
// here: one ask for the keys that arrive together, one read a beat for every
// key still being made. Resolves 'ready' once the view is in the meta, 'none'
// when there won't be one (or no answer came, or an hour passed).

const waiters = new Map();   // key → [resolve]
const asking = new Set();
let askTimer = null;
const polling = new Map();   // key → when it started waiting
let pollTimer = null;
const POLL_GIVE_UP_MS = 60 * 60_000;
// Soon at first (a photo takes seconds once the converter is up, and waking it
// takes a few more), then easing off.
const pollDelay = (elapsedMs) => (elapsedMs < 60_000 ? 3000 : elapsedMs < 5 * 60_000 ? 10_000 : 30_000);

function settle(key, result) {
  const list = waiters.get(key) || [];
  waiters.delete(key);
  polling.delete(key);
  for (const resolve of list) resolve(result);
}

export function awaitView(key) {
  return new Promise((resolve) => {
    if (!viewKindOfKey(key)) { resolve('none'); return; }
    const list = waiters.get(key);
    if (list) { list.push(resolve); return; }
    waiters.set(key, [resolve]);
    asking.add(key);
    if (!askTimer) askTimer = setTimeout(flushAsks, 50);
  });
}

async function flushAsks() {
  askTimer = null;
  const keys = [...asking];
  asking.clear();
  let now = false;
  for (let i = 0; i < keys.length; i += REQUEST_MAX_KEYS) {
    const batch = keys.slice(i, i + REQUEST_MAX_KEYS);
    const states = await requestFileViews(batch, { getToken: sessionToken });
    for (const key of batch) {
      const state = states[key];
      if (state === 'has_preview') settle(key, (await refreshMeta(key)) ? 'ready' : 'none');
      else if (state === 'done' || WAITING_STATES.has(state)) {
        polling.set(key, Date.now());
        if (state === 'done') now = true;
      } else settle(key, 'none');
    }
  }
  schedulePoll(now ? 0 : null);
}

function schedulePoll(delay = null) {
  if (pollTimer || !polling.size) return;
  const youngest = Math.max(...polling.values());
  pollTimer = setTimeout(poll, delay ?? pollDelay(Date.now() - youngest));
}

async function poll() {
  pollTimer = null;
  const keys = [...polling.keys()].slice(0, 200);
  try {
    const { data, error } = await supabase.from('file_views').select(VIEW_COLS).in('storage_path', keys);
    if (!error) {
      for (const row of data || []) {
        if (row.state === 'done') settle(row.storage_path, applyView(row) ? 'ready' : 'none');
        else if (row.state === 'skip' && row.reason === 'has_preview') {
          settle(row.storage_path, (await refreshMeta(row.storage_path)) ? 'ready' : 'none');
        } else if (!WAITING_STATES.has(row.state)) settle(row.storage_path, 'none');
      }
    }
  } catch (_) { /* read again next beat */ }
  const now = Date.now();
  for (const [key, since] of polling) if (now - since > POLL_GIVE_UP_MS) settle(key, 'none');
  schedulePoll();
}

// ── The editors' pass over a board ────────────────────────────────────────

const PASS_KEYS = 60;

// The photo's size as its meta has it: its own, else its preview's.
function metaSize(key) {
  const m = getMeta(key);
  return m?.w > 0 && m?.h > 0 ? { w: m.w, h: m.h } : { w: m?.previewW, h: m?.previewH };
}

// One pass of useFileViewBackfill over `targets`, the board's image cards of
// files that get views and have no preview yet, and its file cards holding
// one (fileView.js viewKeyOfCard). A finished view goes into the meta and
// onto every card that holds its file as the board is now (`cardsNow`,
// `write`): an image card still at the drop's 4:3 takes the photo's shape, a
// file card turns into its picture card. A file never asked about is asked
// about, `perPass` at most. `settled` and `asked` are the hook's, kept across
// passes. True while views on this board are still to come, so the hook
// looks again.
export async function viewPass({ targets, cardsNow, write, settled, asked, perPass, cancelled }) {
  const keys = [...new Set(targets.map(viewKeyOfCard).filter(Boolean))].slice(0, PASS_KEYS);
  const { data, error } = await supabase.from('file_views').select(VIEW_COLS).in('storage_path', keys);
  if (error || cancelled()) return false;
  let waiting = false;
  const rows = new Map((data || []).map((r) => [r.storage_path, r]));
  // `row` is the view's when it made one, null for a browser's preview.
  const writeCards = (key, row) => {
    const ref = `r2:${key}`;
    const size = row ? viewSize(row) : metaSize(key);
    for (const c of cardsNow() || []) {
      const patch = c.kind === 'image' && c.src === ref ? (row ? viewCardPatch(c, row) : {})
        : c.kind === 'file' && c.fileSrc === ref ? viewFileCardPatch(c, size)
          : {};
      if (Object.keys(patch).length) write(c.id, patch);
    }
  };
  const toAsk = [];
  for (const key of keys) {
    const row = rows.get(key);
    if (row?.state === 'done') {
      if (applyView(row)) writeCards(key, row);
      settled.add(key);
    } else if (row && WAITING_STATES.has(row.state)) {
      waiting = true;
    } else if (row) {
      if (row.reason === 'has_preview' && await refreshMeta(key)) writeCards(key, null);
      settled.add(key);
    } else if (!asked.has(key)) {
      toAsk.push(key);
    } else {
      // Asked this session and still no record: a browser's preview, or a
      // file that has gone. Either way nothing to wait for.
      settled.add(key);
    }
  }
  const ask = toAsk.slice(0, perPass);
  if (ask.length && !cancelled()) {
    for (const k of ask) asked.add(k);
    const states = await requestFileViews(ask, { getToken: sessionToken });
    for (const k of ask) {
      if (states[k] === 'has_preview') {
        if (await refreshMeta(k)) writeCards(k, null);
        settled.add(k);
      }
      else if (WAITING_STATES.has(states[k]) || states[k] === 'done') waiting = true;
    }
  }
  return waiting || toAsk.length > ask.length;
}
