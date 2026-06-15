// MIME types used for drag-and-drop between Soleil surfaces. Used by the
// chat-attachment → canvas drop, by board-link drags from the sidebar,
// and by card transfers between panes.
export const INBOX_MIME          = 'application/x-soleil-inbox';
export const BOARD_REF_MIME      = 'application/x-soleil-board-ref';
// Multi-select board drag (sidebar / list). Payload is JSON string[] of board
// ids. Drop targets prefer this over BOARD_REF_MIME when present.
export const BOARD_REF_LIST_MIME = 'application/x-soleil-board-ref-list';
export const CARD_TRANSFER_MIME  = 'application/x-soleil-card';
// Universal entity-ref drags. Set by every <EntityLink>, every entity
// row in the picker, and every canvas chip card so any drop target can
// recognize "an entity is being dragged here." Payload is JSON.
// REF_MIME is a single ref; REF_LIST_MIME is the full array (for
// multi-target manual links so a drop preserves all targets).
export const ENTITY_REF_MIME      = 'application/vnd.soleil.entity-ref+json';
export const ENTITY_REF_LIST_MIME = 'application/vnd.soleil.entity-ref-list+json';

// Read board ids from a drag's DataTransfer: prefer the multi-select LIST
// payload, fall back to the single BOARD_REF payload. Returns string[].
export function readBoardRefIds(dt) {
  if (!dt) return [];
  try {
    const rawList = dt.getData(BOARD_REF_LIST_MIME);
    if (rawList) {
      const arr = JSON.parse(rawList);
      if (Array.isArray(arr)) {
        return arr.map(x => (typeof x === 'string' ? x : x?.boardId)).filter(Boolean);
      }
    }
  } catch (_) {}
  try {
    const rawOne = dt.getData(BOARD_REF_MIME);
    if (rawOne) {
      const o = JSON.parse(rawOne);
      if (o?.boardId) return [o.boardId];
    }
  } catch (_) {}
  return [];
}

// Convert a dragged payload (chat attachment, sidebar board link, etc) into
// a board-card object at canvas-space (x, y). Callers center if they want;
// this just sets the top-left corner. Returns null for kinds that don't
// resolve to a card.
export function inboxItemToCard(item, x, y) {
  const id = `dropped-${item.id || crypto.randomUUID()}-${Date.now()}`;
  if (item.kind === 'image') {
    return { id, kind: 'image', x, y,
             w: item.w || 240, h: item.h || 200,
             src: item.src,
             tone: item.tone || 'neutral',
             label: item.label || 'IMAGE',
             caption: item.caption };
  }
  if (item.kind === 'link') {
    const url = item.url || item.source || '';
    const title = item.title || 'Link';
    return { id, kind: 'note', x, y, w: 280, h: 170,
             html: `<div>${escapeHtml(title)}</div><div>${escapeHtml(url)}</div>` };
  }
  if (item.kind === 'pdf') {
    return { id, kind: 'pdf', x, y, w: item.w || 300, h: item.h || 388,
             pdfSrc: item.pdfSrc || item.src || null,
             src: item.thumbSrc || null,
             name: item.name || 'PDF',
             pageCount: item.pageCount || null };
  }
  if (item.kind === 'note') {
    return { id, kind: 'note', x, y, w: 240, h: 160,
             body: item.body || '' };
  }
  if (item.kind === 'doc') {
    return { id, kind: 'doc', x, y, w: 280, h: 280,
             title: item.title || 'Document',
             lines: (item.lines || []).map(l => ({
               h: l.kind === 'h' ? 1 : (l.h || undefined),
               bullet: l.kind === 'p' ? false : l.bullet,
               text: l.text,
             })),
             author: item.author || item.from || 'Unknown',
             date: item.date || item.when || '—' };
  }
  if (item.kind === 'boardRef' && item.boardId) {
    return { id, kind: 'board', x, y, w: 220, h: 140,
             boardId: item.boardId, name: item.name || 'Board' };
  }
  if (item.kind === 'docRef' && item.docCardId) {
    return { id, kind: 'doc-link', x, y, w: 220, h: 140,
             docCardId: item.docCardId, pageId: item.pageId };
  }
  return null;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}
