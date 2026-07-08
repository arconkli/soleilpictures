// Pure normalization + sort/filter/search for the cluster browser (Table +
// Gallery). Turns a raw card into a uniform ListItem so both views render from
// ONE shape, and exposes pure sortItems/filterItems/matchItems — unit-testable
// like gridLayout.js (no React, no Yjs).
//
// This EXTENDS the older describeListItem (cards.jsx) so EVERY kind produces an
// item — including the newer file/video/audio/pdf/grid that used to fall through
// to a generic "·" glyph — and carries the columns the browser needs (size,
// created/updated, z, a preview descriptor consumed by CardPreview).

import { computeCellRects } from './gridLayout.js';

// Cap the grid schematic: past this many cells the subdivision is unreadable at
// thumb size and re-tiling wastes work, so we draw the raw box instead.
const GRID_RECT_CAP = 64;

export const TYPE_LABELS = {
  image: 'Image', pdf: 'PDF', video: 'Video', audio: 'Audio', file: 'File',
  note: 'Note', link: 'Link', doc: 'Doc', palette: 'Palette', schedule: 'Schedule',
  shape: 'Shape', grid: 'Grid', board: 'Cluster', boardlink: 'Link',
};

// Coarse buckets for the type filter. Several kinds collapse (board+boardlink →
// 'cluster'); 'other' catches shape/schedule/grid/unknown.
export function typeBucket(kind) {
  switch (kind) {
    case 'image': return 'image';
    case 'pdf': return 'pdf';
    case 'video': return 'video';
    case 'audio': return 'audio';
    case 'file': return 'file';
    case 'note': return 'note';
    case 'link': return 'link';
    case 'doc': return 'doc';
    case 'palette': return 'palette';
    case 'board': case 'boardlink': return 'cluster';
    default: return 'other';
  }
}

// Strip HTML → text WITHOUT a DOM so this stays dependency-free (testable in
// node). Good enough for deriving a note's display name from its first words.
function stripTags(html, max = 90) {
  if (!html) return '';
  const txt = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return txt.length > max ? txt.slice(0, max - 1) + '…' : txt;
}

// Resolve a media card's byte size from the primed image metadata (media bytes
// live in the images table, not the Y.Doc; file cards carry sizeBytes directly).
function mediaSizeFrom(getMeta, src) {
  if (!getMeta || !src) return null;
  const key = String(src).replace(/^r2:/, '');
  const m = getMeta(key);
  return m?.sizeBytes ?? m?.size_bytes ?? null;
}

// Build the grid preview descriptor: resolve the layout (own `layout`, or the
// shared template's when linked), tile it into normalized rects, and tint each
// by its cell's content type. Mirrors readGridModel's layout resolution
// (gridState.js) without a Yjs read — cells come from card.cells when present.
function gridPreview(card, gridTemplates) {
  const layout = card?.layout || (card?.templateId ? gridTemplates?.[card.templateId]?.layout : null) || null;
  if (!layout) return { mode: 'icon', kind: 'grid' };
  const rects = computeCellRects(layout, { x: 0, y: 0, w: 1, h: 1 });
  if (!rects.length || rects.length > GRID_RECT_CAP) return { mode: 'grid', rects: rects.slice(0, GRID_RECT_CAP), cells: null };
  const cells = card?.cells && typeof card.cells === 'object' ? card.cells : null;
  return { mode: 'grid', rects, cells };
}

// Normalize a card into a ListItem.
//   opts.boards        — board map, for cluster/link names
//   opts.getMeta       — imageMeta.getMeta(key) → { sizeBytes?, ... } for media size
//   opts.boardId       — the cluster this card lives on (informational)
//   opts.gridTemplates — shared gridTemplates snapshot (id → { layout }) for linked grids
export function toListItem(card, { boards = {}, getMeta = null, boardId = null, gridTemplates = {} } = {}) {
  if (!card || !card.id) return null;
  const kind = card.kind;
  const item = {
    id: card.id, card, boardId: boardId || card.boardId || null, kind,
    typeLabel: TYPE_LABELS[kind] || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Item'),
    typeBucket: typeBucket(kind),
    name: '', sub: '',
    preview: { mode: 'icon', kind },
    sizeBytes: null,
    createdAt: card.createdAt || null,
    updatedAt: card.updatedAt || card.createdAt || null,
    z: card.z || 0,
    pending: !!card.pending,
  };

  switch (kind) {
    case 'image':
      item.name = card.title || card.label || 'Image';
      item.sub = card.caption || '';
      item.preview = card.src ? { mode: 'r2', src: card.src, kind } : { mode: 'placeholder', tone: card.tone, kind };
      item.sizeBytes = mediaSizeFrom(getMeta, card.src);
      break;
    case 'pdf':
      item.name = card.name || card.title || 'PDF';
      item.sub = Number.isFinite(card.pageCount) && card.pageCount > 0
        ? `${card.pageCount} ${card.pageCount === 1 ? 'page' : 'pages'}` : '';
      item.preview = card.src ? { mode: 'r2', src: card.src, kind } : { mode: 'icon', kind };
      item.sizeBytes = mediaSizeFrom(getMeta, card.pdfSrc || card.src);
      break;
    case 'video':
      item.name = card.title || card.fileName || 'Video';
      item.preview = card.poster ? { mode: 'r2', src: card.poster, kind } : { mode: 'icon', kind };
      item.sizeBytes = mediaSizeFrom(getMeta, card.src);
      break;
    case 'audio':
      item.name = card.title || card.fileName || 'Audio';
      item.preview = card.cover ? { mode: 'r2', src: card.cover, kind } : { mode: 'icon', kind };
      item.sizeBytes = mediaSizeFrom(getMeta, card.src);
      break;
    case 'file':
      item.name = card.fileName || card.title || 'File';
      item.sub = card.ext ? String(card.ext).toUpperCase() : (card.mime || '');
      item.preview = { mode: 'file', ext: card.ext, mime: card.mime, kind };
      item.sizeBytes = card.sizeBytes ?? null;
      break;
    case 'note': {
      const noteText = stripTags(card.html, 120) || String(card.body || '').slice(0, 120);
      item.name = noteText.slice(0, 90) || 'Empty note';
      // Show the real text on the tint — far more readable than a glyph.
      item.preview = { mode: 'note', text: noteText, tone: card.bgColor, kind };
      break;
    }
    case 'link':
      item.name = card.title || card.source || card.link || 'Link';
      item.sub = card.source || card.link || '';
      item.preview = card.image
        ? { mode: 'r2', src: card.image, kind }
        : { mode: 'link', favicon: card.favicon || null, source: card.source || card.link || '', kind };
      break;
    case 'doc':
      item.name = card.title || 'Doc';
      item.sub = Array.isArray(card.lines) ? `${card.lines.length} lines` : '';
      item.preview = {
        mode: 'doc',
        title: card.title || '',
        lines: (Array.isArray(card.lines) ? card.lines : []).slice(0, 6)
          .map(l => ({ heading: !!(l && l.h), bullet: !!(l && l.bullet), empty: !((l && (l.t || l.text)) || '').trim() })),
        kind,
      };
      break;
    case 'palette':
      item.name = card.title || 'Palette';
      item.sub = `${(card.swatches || []).length} colors`;
      item.preview = { mode: 'swatches', swatches: (card.swatches || []).map(s => s.hex).filter(Boolean), kind };
      break;
    case 'schedule':
      item.name = card.title || 'Schedule';
      item.sub = `${(card.rows || []).length} rows`;
      item.preview = {
        mode: 'schedule',
        rows: (Array.isArray(card.rows) ? card.rows : []).slice(0, 4)
          .map(r => ({ when: String((r && (r.day ?? r.when)) || '').slice(0, 10) })),
        kind,
      };
      break;
    case 'shape':
      item.name = card.label || card.title || `Shape (${card.shape || 'rect'})`;
      item.preview = { mode: 'shape', shape: card.shape || 'rect', fill: card.fill, stroke: card.stroke, dash: card.dash, kind };
      break;
    case 'grid':
      item.name = card.title || 'Grid';
      item.preview = gridPreview(card, gridTemplates);
      break;
    case 'board':
      item.name = boards[card.id]?.name || card.name || 'Cluster';
      break;
    case 'boardlink':
      item.name = boards[card.target]?.name || card.name || 'Linked cluster';
      break;
    default:
      item.name = card.title || kind || 'Item';
  }
  return item;
}

// ── sort / filter / search (pure) ──────────────────────────────────────────
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// key ∈ 'name'|'type'|'size'|'created'|'updated'. dir ∈ 'asc'|'desc'.
// Missing size/date always sort LAST (regardless of dir), then fall back to
// z-order so undated legacy cards keep a stable place. Returns a NEW array.
export function sortItems(items, key = 'updated', dir = 'desc') {
  const arr = [...(items || [])];
  const sign = dir === 'asc' ? 1 : -1;
  const zcmp = (a, b) => (a.z || 0) - (b.z || 0);
  const missLast = (av, bv, cmp) => {
    const am = av == null || av === '';
    const bm = bv == null || bv === '';
    if (am && bm) return 0;
    if (am) return 1;   // missing → last, independent of sort direction
    if (bm) return -1;
    return cmp();
  };
  arr.sort((a, b) => {
    let c = 0;
    if (key === 'name') c = collator.compare(a.name || '', b.name || '') * sign;
    else if (key === 'type') c = (collator.compare(a.typeLabel || '', b.typeLabel || '') || zcmp(a, b)) * sign;
    else if (key === 'size') c = missLast(a.sizeBytes, b.sizeBytes, () => ((a.sizeBytes - b.sizeBytes) * sign));
    else if (key === 'created') c = missLast(a.createdAt, b.createdAt, () => (String(a.createdAt) < String(b.createdAt) ? -1 : 1) * sign);
    else c = missLast(a.updatedAt, b.updatedAt, () => (String(a.updatedAt) < String(b.updatedAt) ? -1 : 1) * sign);
    return c || zcmp(a, b);
  });
  return arr;
}

// buckets: Set/array of active typeBucket keys. Empty → no filtering.
export function filterItems(items, buckets) {
  const set = buckets instanceof Set ? buckets : new Set(buckets || []);
  if (!set.size) return items || [];
  return (items || []).filter(it => set.has(it.typeBucket));
}

// Case-insensitive substring match over name + sub + typeLabel + ext.
export function matchItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter(it => {
    const hay = `${it.name || ''} ${it.sub || ''} ${it.typeLabel || ''} ${it.preview?.ext || ''}`.toLowerCase();
    return hay.includes(q);
  });
}
