// Sidebar items, from either place a cluster's contents can come from.
//
// A closed cluster's contents arrive as card_index rows through the sidebar_*
// RPCs (supabase/migrations/0419_sidebar_files.sql); the open cluster's come
// from its live Y.Doc. Both become the same SidebarItem here so a row looks
// identical whichever side of the open/closed line a cluster is on, and
// itemFromCard goes through buildCardIndexRow for exactly that reason: it is
// the one projection both card_index writers already share.
//
// SidebarItem: { key, boardId, cardId, kind, shelf, name, snippet, meta,
//   createdAt, updatedAt, unplaced, sizeBytes, seq }

import { buildCardIndexRow } from './cardIndexRow.js';
import { shelfOf } from './sidebarShelves.js';

const SNIPPET_MAX = 160;
const NAME_MAX = 80;

const KIND_FALLBACK = {
  image: 'Photo', video: 'Video', audio: 'Audio', pdf: 'PDF',
  file: 'File', note: 'Note', doc: 'Untitled doc',
};

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function firstLine(snippet) {
  return String(snippet || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
}

function kindFallback(kind, meta) {
  if (kind === 'link') {
    try {
      const host = new URL(meta?.url).hostname.replace(/^www\./, '');
      if (host) return host;
    } catch { /* not a URL */ }
    return 'Link';
  }
  return KIND_FALLBACK[kind] || 'Item';
}

export function displayName({ kind, title, meta, snippet } = {}) {
  const m = meta || {};
  return (
    str(title)
    || str(m.fileName)
    || str(m.name)
    || firstLine(snippet).slice(0, NAME_MAX)
    || kindFallback(kind || 'note', m)
  );
}

// The key the SQL name sort uses (sidebar_cluster_items, 'name'): title, else
// meta.fileName, else meta.name, else the start of the body, else ''. It has NO
// kind fallback, so "Photo" never sorts among real names. A SidebarItem keeps
// only its display name, not the raw title, so with no `title` on the item the
// name stands in for it unless it is just a fallback or the snippet's first
// line, both of which the SQL chain would have skipped past.
export function nameSortKey(item) {
  const m = item.meta || {};
  const snippet = String(item.snippet || '');
  let title = str(item.title);
  if (item.title === undefined) {
    const name = str(item.name);
    const derived = name === kindFallback(item.kind || 'note', m)
      || name === firstLine(snippet).slice(0, NAME_MAX);
    title = derived ? '' : name;
  }
  return (title || str(m.fileName) || str(m.name) || snippet.slice(0, 120) || '')
    .trim().toLowerCase();
}

function ms(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function build({ boardId, cardId, kind, shelf, title, snippet, meta, createdAt, updatedAt, seq }) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const snip = String(snippet || '').slice(0, SNIPPET_MAX);
  const bytes = Number(m.sizeBytes);
  return {
    key: `${boardId}:${cardId}`,
    boardId,
    cardId,
    kind,
    shelf,
    // The raw title rides along so nameSortKey can mirror the SQL name sort
    // exactly; `name` is the label, which falls back to "Photo" and friends.
    title: String(title || '').trim(),
    name: displayName({ kind, title, meta: m, snippet: snip }),
    snippet: snip,
    meta: m,
    createdAt: ms(createdAt),
    updatedAt: ms(updatedAt),
    unplaced: m.unplaced === true,
    sizeBytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
    seq: typeof seq === 'number' && Number.isFinite(seq) ? seq : null,
  };
}

export function itemFromIndexRow(row, boardId) {
  if (!row) return null;
  const kind = row.kind || 'note';
  if (shelfOf(kind) === null) return null;
  return build({
    boardId: boardId ?? row.board_id,
    cardId: String(row.card_id),
    kind,
    shelf: row.shelf ?? shelfOf(kind),
    title: row.title,
    snippet: row.snippet,
    meta: row.meta,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    seq: row.seq,
  });
}

// `groupNameById` (a Map) names the live doc's canvas groups; without it every
// group is "Untitled group".
export function itemFromCard(card, { boardId, workspaceId, groupNameById = null } = {}) {
  if (!card) return null;
  const row = buildCardIndexRow({
    workspaceId, boardId, cardId: String(card.id), get: (k) => card[k], groupNameById,
  });
  if (!row) return null;
  const shelf = shelfOf(row.kind);
  if (shelf === null) return null;
  return build({
    boardId,
    cardId: row.card_id,
    kind: row.kind,
    shelf,
    title: row.title,
    snippet: row.body.slice(0, SNIPPET_MAX),
    meta: row.meta,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    seq: null,
  });
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CARD_META_KEYS = [
  'src', 'poster', 'pdfSrc', 'fileSrc', 'fileName', 'name', 'mime', 'ext',
  'duration', 'bpm', 'musicalKey', 'pageCount', 'w', 'h', 'alt', 'swatches',
  'shape', 'label',
];

// A card-like object for QuickLook and CardPreview. What they read off
// `item.card`: QuickLook — src (image, video, audio), poster, media, adjust, id,
// pdfSrc, url / link / source, image, favicon; CardPreview — peaks (audio
// tile), and the item's own sizeBytes / durationSec. media, adjust, image,
// favicon and peaks are not in card_index, so they stay undefined and the
// previews fall back to src alone.
export function cardFromItem(item) {
  const m = item.meta || {};
  const out = {
    id: item.cardId,
    kind: item.kind,
    title: item.name,
  };
  for (const k of CARD_META_KEYS) if (m[k] !== undefined && m[k] !== null) out[k] = m[k];
  if (m.url) { out.link = m.url; out.url = m.url; }
  if (item.sizeBytes !== null && item.sizeBytes !== undefined) out.sizeBytes = item.sizeBytes;
  if (item.unplaced) out.unplaced = true;
  if (m.pos) {
    for (const k of ['x', 'y', 'w', 'h']) {
      if (m.pos[k] !== undefined && m.pos[k] !== null && out[k] === undefined) out[k] = m.pos[k];
    }
  }
  if (item.kind === 'note') out.html = `<p>${escapeHtml(item.snippet || '')}</p>`;
  return out;
}
