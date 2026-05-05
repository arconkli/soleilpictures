// MIME types used for drag-and-drop between Soleil surfaces. Used by the
// chat-attachment → canvas drop, by board-link drags from the sidebar,
// and by card transfers between panes.
export const INBOX_MIME         = 'application/x-soleil-inbox';
export const BOARD_REF_MIME     = 'application/x-soleil-board-ref';
export const CARD_TRANSFER_MIME = 'application/x-soleil-card';

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
