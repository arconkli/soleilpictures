// coverMosaic — the cover of a cluster with nothing on its board.
//
// A cluster's stored cover is a miniature of its board (lib/renderThumbnail.js).
// A cluster whose files are all in Files (lib/placement.js) — every folder a
// bulk import makes — has an empty board, and its miniature would be an empty
// frame. Its cover is its first pictures instead (the bulk-import mockup's
// landing row): one large and two small. When nothing in it has a picture, a
// few of its files as plain labelled tiles.
//
// Pure: which cards, and where each goes in the frame. renderThumbnail.js
// draws it.
//
// Covers are stored and every viewer sees a stored cover, so until bulk import
// ships this is OFF unless App turns it on (setCoverMosaics(bulkImportAllowed())
// at boot): the renderer and the stored-cover paths (lib/yboard.js) read the
// switch here rather than the host, which keeps them loadable under node.

export const MOSAIC_PICS = 3;

let mosaicsOn = false;
export function setCoverMosaics(on) { mosaicsOn = !!on; }
export function coverMosaicsOn() { return mosaicsOn; }

// The cover's material, from a cluster's cards in order: { pics: [{ id, src }] }
// — finished pictures (an image's own file, a video's poster) — else
// { docs: [label] } for files with no picture, else null. Only cards in Files
// count: anything on the board means the board is the cover.
export function mosaicPicks(cards) {
  const pics = [];
  const docs = [];
  for (const c of cards || []) {
    if (c?.unplaced !== true || c.pending) continue;
    const src = c.kind === 'image' ? c.src : c.kind === 'video' ? c.poster : null;
    if (typeof src === 'string' && src) pics.push({ id: c.id, src });
    else if (docs.length < MOSAIC_PICS) docs.push(docLabel(c));
    if (pics.length === MOSAIC_PICS) break;
  }
  if (pics.length) return { pics };
  return docs.length ? { docs } : null;
}

// What a plain tile says: the file's extension, or what it is.
export function docLabel(c) {
  if (c?.kind === 'pdf') return 'PDF';
  const m = /\.([a-z0-9]{1,4})$/i.exec(String(c?.fileName || c?.name || ''));
  const ext = String(c?.ext || (m && m[1]) || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (ext && ext.length <= 4) return ext;
  return { audio: 'AUDIO', note: 'NOTE', link: 'LINK', doc: 'DOC' }[c?.kind] || 'FILE';
}

// Where each of n pictures goes in a w×h frame, as [x, y, w, h]: one fills
// it; two split it two thirds to one; three put the first on the left two
// thirds and stack the others on the right (the mockup's 2fr | 1fr grid).
export function mosaicCells(n, w, h, gap) {
  if (n <= 1) return [[0, 0, w, h]];
  const left = Math.round(((w - gap) * 2) / 3);
  const rx = left + gap;
  if (n === 2) return [[0, 0, left, h], [rx, 0, w - rx, h]];
  const top = Math.round((h - gap) / 2);
  return [[0, 0, left, h], [rx, 0, w - rx, top], [rx, top + gap, w - rx, h - top - gap]];
}

// Is there anything to draw a cover from? The board's own content, or — with
// mosaics on — the files waiting in its Files. What the stored-cover paths
// ask before rendering.
export function hasCoverContent(cards, strokes, { mosaic = mosaicsOn } = {}) {
  if ((cards || []).some((c) => c?.unplaced !== true) || (strokes || []).length > 0) return true;
  return mosaic && !!mosaicPicks(cards);
}
