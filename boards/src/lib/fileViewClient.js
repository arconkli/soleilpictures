// Asking for a photo's, a document's or a design file's view, and what a
// made one gives its file's image meta and its card (lib/fileView.js; the
// Worker's half is worker-playCopy.js).
//
// No Supabase client here (lib/fileViewWork.js reads the session and the
// records), so node can test it. Never throws: an answer it couldn't get is
// an empty one.

import {
  viewKindOfKey, isCardViewKind, turnsIntoPicture, docDropSize, fileDropSize, extOfKey, DOC_DROP_PAGE, DOC_DROP_SLIDE,
  DESIGN_DROP,
} from './fileView.js';
import { askConverter, REQUEST_MAX_KEYS } from './playCopyClient.js';

// { [key]: state } for the originals among `keys` that get views: 'queued' |
// 'working' while it is made, 'done', 'has_preview' when a browser made a
// preview of it already, 'skip' | 'failed' | 'not_found' otherwise. {} when it
// couldn't ask (signed out, the cooldown, the network).
export function requestFileViews(keys, opts) {
  return askConverter([...new Set((keys || []).filter((k) => viewKindOfKey(k)))].slice(0, REQUEST_MAX_KEYS), opts);
}

// The file_views columns the app reads.
export const VIEW_COLS = 'storage_path,state,reason,view_path,view_w,view_h,view_sm_path,view_sm_w,view_sm_h,width,height,page_count';

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
// (CanvasSurface's drop), a file card 240 wide, and the canvas's paste window
// is 80 to 1200.
const PLACEHOLDER_RATIO = 240 / 320;
const FILE_CARD_W = 240;
const FILE_CARD_H = 150;
const MIN_SIDE = 80;
const MAX_SIDE = 1200;

// The photo's size a finished view's row gives: the original's, else the view's.
export function viewSize(row) {
  return { w: num(row?.width) || num(row?.view_w), h: num(row?.height) || num(row?.view_h) };
}

// A `w`×`h` photo's shape at width `cw`, inside the paste window.
function shapeAt(cw, w, h) {
  const nw = cw;
  const nh = cw * (h / w);
  const long = Math.max(nw, nh);
  const short = Math.min(nw, nh);
  const k = long > MAX_SIDE ? MAX_SIDE / long : short < MIN_SIDE ? MIN_SIDE / short : 1;
  return { w: Math.round(nw * k), h: Math.round(nh * k) };
}

// What a finished view writes onto its card (editors' backfill, silently): a
// card still at the placeholder's 4:3 takes the photo's own shape, keeping
// its width where it can. A card someone resized to any other shape keeps it,
// and so does a photo that is 4:3 itself. A row that isn't this card's file
// writes nothing.
export function viewCardPatch(card, row) {
  if (!card || card.kind !== 'image' || !row || row.state !== 'done') return {};
  const key = typeof card.src === 'string' && card.src.startsWith('r2:') ? card.src.slice(3) : '';
  if (!key || row.storage_path !== key) return {};
  const { w, h } = viewSize(row);
  if (!w || !h || !(card.w > 0) || !(card.h > 0)) return {};
  if (Math.abs(card.h / card.w - PLACEHOLDER_RATIO) >= 0.01) return {};
  const next = shapeAt(card.w, w, h);
  if (Math.abs(next.w - card.w) <= card.w * 0.02 && Math.abs(next.h - card.h) <= card.h * 0.02) return {};
  return next;
}

// The file a file card holds whose picture the card shows (fileView.js
// CARD_VIEW_KINDS: a document's first page, a design file's own picture):
// { key, kind }, or null.
function cardViewOf(card) {
  if (!card || card.kind !== 'file' || card.pending || typeof card.fileSrc !== 'string' || !card.fileSrc.startsWith('r2:')) return null;
  const key = card.fileSrc.slice(3);
  const kind = viewKindOfKey(key);
  return isCardViewKind(kind) ? { key, kind } : null;
}
const atSize = (card, s) => Math.abs((Number(card.w) || 0) - s.w) <= 1 && Math.abs((Number(card.h) || 0) - s.h) <= 1;

// What a document's first page writes onto its file card: the PDF's number
// of pages (`pages`), which its strip shows, and, while the card is still the
// size it landed at (fileView.js docDropSize), the page's shape: 300 wide
// standing up, as a PDF card, 400 lying down, as a slide. A card placed
// before pages showed (a file card's 240×150) or resized keeps its size, and
// the page fills it from the top.
function docCardPatch(card, key, size, pages) {
  const patch = {};
  if (pages > 0 && card.pageCount !== pages) patch.pageCount = pages;
  const drop = docDropSize(extOfKey(key));
  const w = num(size?.w);
  const h = num(size?.h);
  if (drop && atSize(card, drop) && w && h) {
    const next = shapeAt(w >= h ? DOC_DROP_SLIDE.w : DOC_DROP_PAGE.w, w, h);
    if (Math.abs(next.w - card.w) > 2 || Math.abs(next.h - card.h) > 2) Object.assign(patch, next);
  }
  return patch;
}

// The narrowest a design file's card gets, and how much smaller than its
// picture it may be (InDesign keeps only a thumbnail, a few hundred pixels).
const DESIGN_MIN_W = 160;
const DESIGN_SHRINK = 1.6;

// What a design file's picture writes onto its file card: while the card is
// still the size it landed at (fileView.js DESIGN_DROP), the picture's shape
// at that width, or narrower for a small picture, never more than
// DESIGN_SHRINK times smaller than the picture itself nor under DESIGN_MIN_W,
// and never taller than the canvas's paste window (a tall picture is cropped
// to it). A card resized, or placed before pictures came, keeps its size, and
// the picture covers it.
function designCardPatch(card, size) {
  const w = num(size?.w);
  const h = num(size?.h);
  if (!w || !h || !atSize(card, DESIGN_DROP)) return {};
  const cw = Math.min(DESIGN_DROP.w, Math.max(DESIGN_MIN_W, Math.round(w / DESIGN_SHRINK)));
  const next = { w: cw, h: Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(cw * (h / w)))) };
  return Math.abs(next.w - card.w) > 1 || Math.abs(next.h - card.h) > 1 ? next : {};
}

// What a photo's picture, once there is one, writes onto a file card holding
// the photo (a raw or a .psd dropped before views, a photo some system gave no
// type): the card turns into the picture card a drop makes now. The same file
// is its `src`; it takes the photo's shape (`size`, {w, h}) at its own width,
// and keeps its name, type, size and title. `fileSrc` is cleared, so nothing
// that looks for a file card's file finds this one once the picture's file is
// replaced. {} for a card that stays a file card (fileView.js
// turnsIntoPicture), except a document's, which takes its first page's shape
// while it is still at its drop size, and its page count (docCardPatch), and
// a design file's, which takes its picture's (designCardPatch).
export function viewFileCardPatch(card, size, pages = 0) {
  const view = cardViewOf(card);
  if (view?.kind === 'doc') return docCardPatch(card, view.key, size, pages);
  if (view?.kind === 'design') return designCardPatch(card, size);
  if (!turnsIntoPicture(card)) return {};
  const w = num(size?.w);
  const h = num(size?.h);
  if (!w || !h) return {};
  return { kind: 'image', src: card.fileSrc, ...shapeAt(card.w > 0 ? card.w : FILE_CARD_W, w, h), fileSrc: null };
}

// A document that won't get a first page (a password, damage, too big), or
// a design file with no picture inside it: a card still the size it landed
// at (fileView.js fileDropSize) goes back to a file card's.
export function noPageCardPatch(card) {
  const view = cardViewOf(card);
  const drop = view ? fileDropSize(extOfKey(view.key)) : null;
  return drop && atSize(card, drop) ? { w: FILE_CARD_W, h: FILE_CARD_H } : {};
}

export { REQUEST_MAX_KEYS };
