// Asking for a photo's view, and what a made one gives its file's image meta
// and its card (lib/fileView.js; the Worker's half is worker-playCopy.js).
//
// No Supabase client here (lib/fileViewWork.js reads the session and the
// records), so node can test it. Never throws: an answer it couldn't get is
// an empty one.

import { viewKindOfKey } from './fileView.js';
import { askConverter, REQUEST_MAX_KEYS } from './playCopyClient.js';

// { [key]: state } for the originals among `keys` that get views: 'queued' |
// 'working' while it is made, 'done', 'has_preview' when a browser made a
// preview of it already, 'skip' | 'failed' | 'not_found' otherwise. {} when it
// couldn't ask (signed out, the cooldown, the network).
export function requestFileViews(keys, opts) {
  return askConverter([...new Set((keys || []).filter((k) => viewKindOfKey(k)))].slice(0, REQUEST_MAX_KEYS), opts);
}

// The file_views columns the app reads.
export const VIEW_COLS = 'storage_path,state,reason,view_path,view_w,view_h,view_sm_path,view_sm_w,view_sm_h,width,height';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// The image meta (lib/imageMeta.js setMetaLocal) a finished view gives its
// original: the view as its preview, the small one as its small preview, and
// its size when the browser couldn't read it. null for a row that made none.
export function viewMeta(row) {
  if (!row || row.state !== 'done' || !row.view_path) return null;
  const meta = {
    previewKey: row.view_path, previewW: num(row.view_w), previewH: num(row.view_h),
    previewSmKey: row.view_sm_path || null, previewSmW: num(row.view_sm_w), previewSmH: num(row.view_sm_h),
    checked: true,
  };
  if (num(row.width) && num(row.height)) {
    meta.w = num(row.width);
    meta.h = num(row.height);
  }
  return meta;
}

// An image card dropped as a file the browser couldn't draw gets 320×240
// (CanvasSurface's drop), and the canvas's paste window is 80 to 1200.
const PLACEHOLDER_RATIO = 240 / 320;
const MIN_SIDE = 80;
const MAX_SIDE = 1200;

// What a finished view writes onto its card (editors' backfill, silently): a
// card still at the placeholder's 4:3 takes the photo's own shape, keeping
// its width where it can. A card someone resized to any other shape keeps it,
// and so does a photo that is 4:3 itself. A row that isn't this card's file
// writes nothing.
export function viewCardPatch(card, row) {
  if (!card || card.kind !== 'image' || !row || row.state !== 'done') return {};
  const key = typeof card.src === 'string' && card.src.startsWith('r2:') ? card.src.slice(3) : '';
  if (!key || row.storage_path !== key) return {};
  const w = num(row.width) || num(row.view_w);
  const h = num(row.height) || num(row.view_h);
  if (!w || !h || !(card.w > 0) || !(card.h > 0)) return {};
  if (Math.abs(card.h / card.w - PLACEHOLDER_RATIO) >= 0.01) return {};
  let nw = card.w;
  let nh = card.w * (h / w);
  const long = Math.max(nw, nh);
  const short = Math.min(nw, nh);
  const k = long > MAX_SIDE ? MAX_SIDE / long : short < MIN_SIDE ? MIN_SIDE / short : 1;
  nw = Math.round(nw * k);
  nh = Math.round(nh * k);
  if (Math.abs(nw - card.w) <= card.w * 0.02 && Math.abs(nh - card.h) <= card.h * 0.02) return {};
  return { w: nw, h: nh };
}

export { REQUEST_MAX_KEYS };
